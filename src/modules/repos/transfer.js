// 布局导入导出（v2）：仓库 + 分组 + 参考关系，一次搬走。
//
// **设计原则**：导出物里**绝不出现本地路径**——本地路径是机器事实，换机必失效；
// 唯一的稳定 key 是远程 git 地址（normalizeRemoteKey 归一）。dev 无 remote 的导不出
// 可克隆的形态，如实进 warnings（按名字导出、导入端标"需手工处理"）。
//
// 导入是两段式：`plan:true` 零副作用算计划（登记什么/克隆什么/建什么组/连什么关系），
// UI 与 CLI --plan 都先给人看；确认后按 clone 模式（all|dev|ref|none）+ only 白名单执行。
import { join, resolve } from 'node:path';
import { loadConfig } from '../../core/config.js';
import { badInput } from '../../core/errors.js';
import * as service from './service.js';
import * as boards from './boards.js';
import { gitClone, hasGit } from './git.js';

const clean = (v) => String(v || '').trim();

// ─── 导出 ─────────────────────────────────────────────────────────────

export async function repoExport() {
  const s = await service.loadStore();
  const warnings = [];
  const byId = new Map(s.repos.map((r) => [r.id, r]));

  // repo 条目：remote 优先；dev 无 remote 只能按名字导（导入端无法 clone，进 warnings）
  const repos = [];
  const remoteOf = new Map(); // repoId -> remoteKey（关系引用用）
  for (const r of s.repos) {
    const rkey = service.normalizeRemoteKey(r.remote || '');
    if (rkey) remoteOf.set(r.id, r.remote.trim());
    repos.push(
      rkey
        ? { remote: r.remote.trim(), name: r.name, desc: r.desc || '', type: r.type || 'dev' }
        : (() => {
            warnings.push(`仓库「${r.name}」没有远程地址 —— 按名字导出，导入端只能登记、无法克隆`);
            return { name: r.name, desc: r.desc || '', type: r.type || 'dev' };
          })()
    );
  }

  // 看板成员引用一律写 remote（优先）/ name——不写 path
  const refsOf = (b) =>
    (b.repoIds || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((r) => {
        const entry = remoteOf.has(r.id)
          ? { remote: remoteOf.get(r.id), name: r.name }
          : { name: r.name };
        const note = (b.repoNotes || {})[r.id] || '';
        return note ? { ...entry, note } : entry;
      });

  const boardsOut = s.boards.map((b) => ({ name: b.name, desc: b.desc || '', repos: refsOf(b) }));

  // 参考关系：ref → 绑定目标的 remote/name（note = 绑定描述，随关系走）。
  // 数据面以 ref 侧为准（它是关系的权威记录）；dev 侧的反向引用是同一关系的镜像。
  const links = [];
  for (const r of s.repos) {
    if ((r.type || 'dev') !== 'ref' || !(r.linked || []).length) continue;
    if (!remoteOf.has(r.id)) continue; // ref 自身没 remote 就没有重建依据
    const to = [];
    for (const l of r.linked) {
      if (l.kind === 'repo' && remoteOf.has(l.id)) to.push(l.note ? { repo: remoteOf.get(l.id), note: l.note } : { repo: remoteOf.get(l.id) });
      else if (l.kind === 'board') {
        const b = s.boards.find((x) => x.id === l.id);
        if (b) to.push(l.note ? { board: b.name, note: l.note } : { board: b.name });
      }
    }
    if (to.length) links.push({ ref: remoteOf.get(r.id), to });
  }

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    repos,
    boards: boardsOut,
    links,
    warnings,
  };
}

// ─── 导入 ─────────────────────────────────────────────────────────────

function parseLayout(json) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw badInput('布局 JSON 解析失败（请粘 repo export 的完整输出）');
  }
  const incoming = Array.isArray(data?.repos) ? data.repos : null;
  if (!incoming) throw badInput('JSON 里没有 repos 数组 —— 布局导入认 repo export 的 v2 格式（看板单独导入用 board import）');
  return data;
}

// 只处理 --only 指定的条目（按 remoteKey 匹配；无 remote 的按名字。only 的值也归一，
// 用户给 git@… 或 https://… 或裸 key 都能对上）
function wanted(entry, onlySet) {
  if (!onlySet.size) return true;
  const rk = service.normalizeRemoteKey(entry.remote || '');
  const nm = clean(entry.name).toLowerCase();
  for (const o of onlySet) {
    if (rk && service.normalizeRemoteKey(o) === rk) return true;
    if (nm && o === nm) return true;
  }
  return false;
}

function cloneModeFor(type, clone) {
  if (clone === 'all') return true;
  if (clone === 'dev') return type === 'dev';
  if (clone === 'ref') return type === 'ref';
  return false; // none
}

/**
 * 计划/执行一体：plan=true 时除「登记/克隆/建组」外的解析全部照跑，但不落盘、不触网。
 * 返回统一的形状：{ plan:bool, repos:[…], boards:[…], links:[…], warnings:[…], result:{…}|null }
 */
export async function repoImport({ json, plan = false, clone = 'none', only } = {}) {
  const data = parseLayout(json);
  const incoming = data.repos;
  const onlySet = new Set((Array.isArray(only) ? only : []).map((x) => clean(x).toLowerCase()).filter(Boolean));

  const cfg = await loadConfig();
  const gitRepoRoot = clean(cfg.gitRepoRoot);
  const gitDevRoot = clean(cfg.gitDevRoot);
  const warnings = [];

  const cur = await service.loadStore();
  const byRemote = new Map(
    cur.repos
      .map((r) => [service.normalizeRemoteKey(r.remote || ''), r])
      .filter(([k]) => k)
  );
  const byName = new Map(cur.repos.map((r) => [clean(r.name).toLowerCase(), r]));

  // ---- 逐 repo：登记什么、克隆到哪 ----
  const repoPlans = [];
  for (const raw of incoming) {
    const name = clean(raw.name);
    const remote = clean(raw.remote);
    const type = raw.type === 'ref' ? 'ref' : 'dev';
    const rkey = service.normalizeRemoteKey(remote);
    if (!name && !rkey) continue;
    if (!wanted({ remote, name }, onlySet)) continue;

    const known = (rkey && byRemote.get(rkey)) || byName.get(name.toLowerCase()) || null;
    const item = { remote, name, desc: clean(raw.desc), type, rkey, known: !!known };

    if (known) {
      item.action = '已登记';
      // 已登记的 ref 若目录已丢，导入时克隆模式可以补目录（origin 一致才动手）
      const dirOk = await hasGit(known.path);
      item.disk = dirOk ? '已存在' : '目录缺失';
      item.cloneWanted = !dirOk && rkey && cloneModeFor(type, clone);
    } else {
      item.action = '需登记';
      // 磁盘上可能已经有了（换机手工搬过/以前 clone 过）：登记就行，不必再 clone
      if (rkey) {
        const root = type === 'ref' ? gitRepoRoot : gitDevRoot;
        if (root) {
          const guess = resolve(join(resolve(root), service.dirnameFromRemote(remote)));
          if (await hasGit(guess)) {
            // 有目录但没有登记：视作待登记（remote 一致性留给 register 逻辑校验 origin）
            item.disk = '目录已存在（将直接登记）';
            item.dest = guess;
          }
        }
      }
      item.cloneWanted = !!rkey && !item.dest && cloneModeFor(type, clone);
      if (item.cloneWanted && type === 'ref' && !gitRepoRoot) {
        item.cloneWanted = false;
        item.blocked = 'gitRepoRoot 未设置 —— 只登记不克隆';
        warnings.push(`「${name || rkey}」需要克隆但 gitRepoRoot 未设置: nx-kv setting set --gitRepoRoot <目录>`);
      }
      if (item.cloneWanted && type === 'dev' && !gitDevRoot) {
        item.cloneWanted = false;
        item.blocked = 'gitDevRoot 未设置 —— 只登记不克隆';
      }
      if (!rkey) item.blocked = '无远程地址 —— 只按名字登记，克隆需手工';
    }
    repoPlans.push(item);
  }

  // ---- 看板：合并还是新建 ----
  const boardPlans = (Array.isArray(data.boards) ? data.boards : []).map((b) => {
    const nm = clean(b?.name);
    if (!nm) return null;
    const existing = cur.boards.find((x) => x.name === nm);
    const members = (Array.isArray(b.repos) ? b.repos : []).map((e) => {
      const entry = typeof e === 'string' ? { name: e } : e;
      const ek = service.normalizeRemoteKey(entry.remote || '');
      return { remote: clean(entry.remote), name: clean(entry.name), note: clean(entry.note), rkey: ek };
    });
    return { name: nm, desc: clean(b.desc), existing: !!existing, action: existing ? '合并' : '新建', members };
  }).filter(Boolean);

  // ---- 参考关系：ref → 目标（repo 按 remoteKey/name，board 按名字；note 随关系走） ----
  const linkPlans = (Array.isArray(data.links) ? data.links : [])
    .map((l) => {
      const rk = service.normalizeRemoteKey(l?.ref);
      if (!rk) return null;
      const to = (Array.isArray(l.to) ? l.to : []).map((t) => ({
        repo: clean(t?.repo),
        board: clean(t?.board),
        note: clean(t?.note),
      })).filter((t) => t.repo || t.board);
      return to.length ? { ref: clean(l.ref), rkey: rk, to } : null;
    })
    .filter(Boolean);

  // 根目录提醒
  if (repoPlans.some((x) => x.cloneWanted && x.type === 'ref') && !gitRepoRoot) {
    warnings.push('gitRepoRoot 未设置 —— 参考仓库将只登记不克隆');
  }

  if (plan) {
    return {
      plan: true,
      clone,
      repos: repoPlans,
      boards: boardPlans,
      links: linkPlans,
      warnings,
      roots: { gitRepoRoot, gitDevRoot },
    };
  }

  // ---- 执行：登记 → 克隆 → 建组 → 连关系 ----
  const cloned = [];
  const skipped = [];
  let created = 0;
  const unmatched = [];

  // remoteKey -> repoId 的对照表随登记动态补
  const idByRemote = new Map(
    cur.repos
      .map((r) => [service.normalizeRemoteKey(r.remote || ''), r.id])
      .filter(([k]) => k)
  );

  for (const item of repoPlans) {
    try {
      if (item.known) {
        if (item.cloneWanted && item.rkey) {
          // 登记在但目录丢了：重新补目录
          const root = item.type === 'ref' ? gitRepoRoot : gitDevRoot;
          const dest = join(resolve(root), service.dirnameFromRemote(item.remote));
          const used = await gitClone(item.remote, dest, { depth: 1 });
          await service.updateRepo(item.known.id, { path: dest, remote: used });
          cloned.push({ name: item.name, remote: item.remote, dest, kind: 'refill' });
          idByRemote.set(item.rkey, item.known.id);
        } else {
          skipped.push({ name: item.name, remote: item.remote, why: item.disk === '目录缺失' ? '目录缺失（未选克隆）' : '已在册' });
        }
        continue;
      }
      if (item.disk === '目录已存在（将直接登记）') {
        const r = await service.addRepo({
          path: item.dest,
          name: item.name || undefined,
          desc: item.desc || undefined,
          type: item.type,
          remote: item.remote,
        });
        created += 1;
        idByRemote.set(item.rkey, r.id);
        continue;
      }
      if (item.cloneWanted && item.rkey) {
        const root = item.type === 'ref' ? gitRepoRoot : gitDevRoot;
        const dest = join(resolve(root), service.dirnameFromRemote(item.remote));
        const used = await gitClone(item.remote, dest, { depth: 1 });
        const r = await service.addRepo({
          path: dest,
          name: item.name || undefined,
          desc: item.desc || undefined,
          type: item.type,
          remote: used,
        });
        created += 1;
        cloned.push({ name: r.name, remote: used, dest, kind: 'clone' });
        idByRemote.set(item.rkey, r.id);
        continue;
      }
      // 只登记（无 remote 或未选克隆）：remote 仍记录（它是关系的重建依据）；
      // 路径只是占位（目录还不存在，等真正 clone 后 update --path 纠正），
      // 没有任何可用标识时跳过——造一条纯占位登记只会污染清单。
      if (!item.rkey && !item.name) continue;
      const root = resolve(item.type === 'ref' ? gitRepoRoot || '.' : gitDevRoot || '.');
      const placeholder = item.dest || join(root, service.dirnameFromRemote(item.remote || item.name || 'repo'));
      const r = await service.addRepo({
        path: placeholder,
        name: item.name || undefined,
        type: item.type,
        remote: item.remote || undefined,
      });
      created += 1;
      if (item.rkey) idByRemote.set(item.rkey, r.id);
    } catch (err) {
      const msg = String(err && err.message || err);
      if (/已登记|已存在/.test(msg)) skipped.push({ name: item.name, remote: item.remote, why: msg });
      else warnings.push(`「${item.name || item.remote}」导入失败: ${msg}`);
    }
  }

  // 看板成员重建：remoteKey 优先，名字兜底（unmatched 如实报告）
  let merged = 0;
  let boardsCreated = 0;
  const s2 = await service.loadStore();
  for (const bp of boardPlans) {
    let b = s2.boards.find((x) => x.name === bp.name);
    if (!b) {
      await boards.createBoard({ name: bp.name, desc: bp.desc });
      boardsCreated += 1;
      b = (await service.loadStore()).boards.find((x) => x.name === bp.name);
    } else {
      merged += 1;
      if (bp.desc) await boards.updateBoard(b.id, { desc: bp.desc });
    }
    for (const m of bp.members) {
      const mk = service.normalizeRemoteKey(m.remote);
      const hit =
        (mk && idByRemote.get(mk)) ||
        (m.name && (s2.repos.find((x) => clean(x.name).toLowerCase() === m.name.toLowerCase()) || {}).id) ||
        null;
      if (!hit) {
        unmatched.push({ board: bp.name, entry: m.remote || m.name });
        continue;
      }
      await boards.assignRepo({ id: hit, board: b.id }).catch(() => {});
      if (m.note) await boards.setBoardRepoNote({ id: hit, board: b.id, note: m.note }).catch(() => {});
    }
  }

  // 参考关系重建
  let linksDone = 0;
  for (const lp of linkPlans) {
    const rid = idByRemote.get(lp.rkey);
    if (!rid) {
      unmatched.push({ board: '(参考关系)', entry: lp.ref });
      continue;
    }
    for (const t of lp.to) {
      try {
        if (t.repo) {
          const tk = service.normalizeRemoteKey(t.repo);
          const tid = (tk && idByRemote.get(tk)) || null;
          if (!tid) {
            unmatched.push({ board: `(参考关系 ${lp.ref})`, entry: t.repo });
            continue;
          }
          await refBind(rid, tid, null, t.note);
        } else if (t.board) {
          const bs = (await service.loadStore()).boards.find((x) => x.name === t.board);
          if (!bs) {
            unmatched.push({ board: `(参考关系 ${lp.ref})`, entry: '看板「' + t.board + '」' });
            continue;
          }
          await refBind(rid, null, bs.id, t.note);
        }
        linksDone += 1;
      } catch (err) {
        warnings.push(`参考关系 ${lp.ref} → ${t.repo || t.board} 失败: ${String(err && err.message || err)}`);
      }
    }
  }

  return {
    plan: false,
    created,
    boardsCreated,
    merged,
    cloned,
    skipped,
    unmatched,
    warnings,
    links: linksDone,
  };
}

// 关系重建里的绑定直写（绕过 ref.bindTarget 的 loadRef——导入时 type 可能还没带 remote key 命中）。
// 双向记录：ref 侧写 {repo|board}，dev 侧写反向的 {ref}。
async function refBind(refId, repoId, boardId, note) {
  return service.mutateStore((s) => {
    const r = s.repos.find((x) => x.id === refId);
    if (!r) throw badInput('参考仓库不存在: ' + refId);
    if (!Array.isArray(r.linked)) r.linked = [];
    const key = boardId ? 'board:' + boardId : 'repo:' + repoId;
    const hit = r.linked.find((l) => l.kind + ':' + l.id === key);
    if (!hit) {
      r.linked.push(
        note
          ? boardId ? { kind: 'board', id: boardId, note } : { kind: 'repo', id: repoId, note }
          : boardId ? { kind: 'board', id: boardId } : { kind: 'repo', id: repoId }
      );
    } else if (note) {
      hit.note = note;
    }
    // dev 侧反向引用
    if (repoId) {
      const d = s.repos.find((x) => x.id === repoId);
      if (d) {
        if (!Array.isArray(d.linked)) d.linked = [];
        const back = d.linked.find((l) => l.kind === 'ref' && l.id === refId);
        if (!back) d.linked.push(note ? { kind: 'ref', id: refId, note } : { kind: 'ref', id: refId });
        else if (note) back.note = note;
      }
    }
    return r.linked.slice();
  });
}

// ─── 人读渲染（CLI 用；面板直接消费 JSON）────────────────────────────────

export function renderPlan(d) {
  const lines = [`导入计划（${d.clone} 模式，未执行任何变更）:`];
  if (d.roots && !d.roots.gitRepoRoot) lines.push('  ⚠ gitRepoRoot 未设置 —— 参考仓库只能登记');
  if (d.roots && !d.roots.gitDevRoot) lines.push('  ⚠ gitDevRoot 未设置 —— 开发仓库只能登记');
  for (const r of d.repos) {
    const tag = r.type === 'ref' ? ' [参考]' : '';
    const cl = r.cloneWanted ? ' → 克隆' : r.blocked ? ` → ${r.blocked}` : '';
    lines.push(`  ${r.action}${tag}  ${r.name || r.remote}${cl}`);
  }
  for (const b of d.boards) lines.push(`  看板${b.action}  ${b.name}（${b.members.length} 个成员）`);
  for (const l of d.links) {
    const targets = l.to.map((t) => {
      const label = t.repo || `看板「${t.board}」`;
      return t.note ? `${label}（${t.note.split('\n')[0]}）` : label;
    });
    lines.push(`  关系  ${l.ref} → ${targets.join('、')}`);
  }
  for (const w of d.warnings) lines.push(`  ⚠ ${w}`);
  return lines.join('\n');
}

export function renderResult(d) {
  const lines = [`新建 ${d.created} 个登记，合并 ${d.merged} 个看板，重建 ${d.links} 条参考关系`];
  if (d.cloned.length) {
    lines.push('克隆:');
    for (const c of d.cloned) lines.push(`  ${c.name}  →  ${c.dest}`);
  }
  if (d.skipped.length) {
    lines.push('跳过:');
    for (const c of d.skipped) lines.push(`  ${c.name}（${c.why}）`);
  }
  if (d.unmatched.length) {
    lines.push('未匹配（登记/克隆都找不到，关系未连）:');
    for (const u of d.unmatched) lines.push(`  [${u.board}] ${u.entry}`);
  }
  for (const w of d.warnings) lines.push(`⚠ ${w}`);
  return lines.join('\n');
}
