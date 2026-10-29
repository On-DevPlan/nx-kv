// 参考仓库（type=ref）service：克隆、登记、绑定、同步、检查。
//
// **定位**：mmx-research-gitclone 的整体吸纳（2026-10-27）。以前参考仓库散落在各项目的
// `.claude/repo/` 下、用文本清单（.claude/www/git.remote）登记——副本分散、换机同步麻烦、
// 与分组毫无关联。现在参考仓库与开发仓库同住中心清单（type 区分），clone 落到用户自设的
// gitRepoRoot（**刻意不默认任何路径**——用户必须显式指一个非 C 盘目录），绑定关系挂在
// linked 上（指向开发仓库或看板），导出导入走 transfer.js 的 v2 布局（remote 为 key）。
//
// 本文件不含传输层概念；git 的实际调用都在 git.js。
import { basename, join, resolve } from 'node:path';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadConfig } from '../../core/config.js';
import { badInput, notFound, conflict } from '../../core/errors.js';
import * as service from './service.js';
import { gitClone, gitPull, gitOrigin, hasGit } from './git.js';

const isRemoteUrl = (u) => /^(git@|https?:\/\/|ssh:\/\/|file:\/\/)/i.test(String(u || '').trim());

/** 参考仓库存储根（config.gitRepoRoot）；未设置 = 显式报错，绝不默默落进 homedir。 */
export async function requireRepoRoot() {
  const cfg = await loadConfig();
  const root = String(cfg.gitRepoRoot || '').trim();
  if (!root) {
    throw badInput(
      '参考仓库存储根未设置 —— 先给一个非 C 盘目录: nx-kv setting set --gitRepoRoot <目录>'
    );
  }
  return resolve(root);
}

/**
 * clone 目标目录：URL 基名；已存在且 origin key 不同 → 追加 -<hash6> 保证确定性不撞车。
 * 同名同源（目录已在，origin key 相同）→ null：调用方按「已 clone 过」处理。
 */
async function destFor(root, url) {
  const base = service.dirnameFromRemote(url);
  const key = service.normalizeRemoteKey(url);
  let dest = join(root, base);
  if (!(await exists(dest))) return dest;
  if (service.normalizeRemoteKey(await gitOrigin(dest)) === key) return null; // 已 clone 过同源
  dest = join(root, base + '-' + createHash('sha256').update(key).digest('hex').slice(0, 6));
  if (await exists(dest)) throw conflict('目标目录已存在且无法确定来源: ' + dest);
  return dest;
}

async function exists(p) {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

// 定位 ref：id / key / 名称 / remoteKey 都能认（agent 场景常直接给 URL 或名字）。
async function findRef(idOrNameOrUrl) {
  const raw = String(idOrNameOrUrl || '').trim();
  if (!raw) throw badInput('缺少参考仓库标识（id / key / 名称 / 远程地址）');
  const s = await service.loadStore();
  let r = s.repos.find((x) => x.id === raw);
  if (!r) {
    const k = service.normalizeKey(raw);
    if (k) r = s.repos.find((x) => service.deriveKey(x) === k);
  }
  if (!r) r = s.repos.find((x) => (x.remote && service.normalizeRemoteKey(x.remote)) === service.normalizeRemoteKey(raw));
  if (!r) r = await service.findRepoByName(raw);
  if (!r) throw notFound('参考仓库不存在: ' + raw);
  return r;
}

async function loadRef(id) {
  const r = await findRef(id);
  if ((r.type || 'dev') !== 'ref') throw conflict(`「${r.name}」不是参考仓库（type=dev）——绑定/同步只对 ref 有意义`);
  return r;
}

/**
 * 克隆并登记参考仓库。
 *   url     远程地址（唯一 key）
 *   board   看板 id（可同时给多个，数组）——顺手挂归属
 *   bind    绑定的开发仓库（id/路径/名称，可多个，数组）
 *   noBind  关掉 autoBind（CLI 上在开发仓库目录里跑时默认绑当前目录的仓库）
 */
export async function cloneRef({ url, name, desc, notes, board, bind, depth = 1, noBind } = {}) {
  const remote = String(url || '').trim();
  if (!isRemoteUrl(remote)) throw badInput('请给远程 git 地址（git@… / https://…）: ' + remote);
  const root = await requireRepoRoot();
  await fsp.mkdir(root, { recursive: true });

  // 已登记同源 → 不重复 clone，直接说明
  const s0 = await service.loadStore();
  const rkey = service.normalizeRemoteKey(remote);
  const known = s0.repos.find((x) => service.normalizeRemoteKey(x.remote || '') === rkey);
  if (known) {
    throw conflict(`该远程地址已登记为「${known.name}」(${known.id}) —— 无需重复 clone，可用 repo ref sync 更新`);
  }

  const dest = await destFor(root, remote);
  if (!dest) throw conflict(`gitRepoRoot 下已存在同源目录: ${join(root, service.dirnameFromRemote(remote))} —— 请用 repo ref add 登记`);

  const usedUrl = await gitClone(remote, dest, { depth });
  const repo = await service.addRepo({
    path: dest,
    name: (name || '').trim() || basename(dest),
    desc,
    notes,
    type: 'ref',
    remote: usedUrl, // 登记实际成功的那条 URL（SSH 挂了回退 HTTPS 时以 HTTPS 为准）
  });

  // 绑定：显式 --board / --bind，加上 autoBind（当前目录命中的开发仓库）
  // 目标一律按 **key** 传给 bindTarget（它内部会再解析一次，id/路径/名称都认）
  const targets = [];
  const boardIds = Array.isArray(board) ? board : board ? [board] : [];
  for (const b of boardIds) targets.push({ kind: 'board', id: String(b).trim() });
  const bindIds = Array.isArray(bind) ? bind : bind ? [bind] : [];
  for (const b of bindIds) targets.push({ kind: 'repo', id: String(b).trim() });
  if (!noBind) {
    const ctx = await service.contextForPath(process.cwd());
    if (ctx && ctx.key !== service.deriveKey(repo)) targets.push({ kind: 'repo', id: ctx.key });
  }
  const linked = [];
  for (const t of targets) {
    const arg = t.kind === 'board' ? { board: t.id } : { repo: t.id };
    const r = await bindTarget({ id: repo.id, ...arg }).catch(() => null); // 单个目标失效不拖垮整体
    if (r) linked.push(t);
  }
  return { ...repo, linked, cloned: true, url: usedUrl, dest };
}

/** 登记一个已存在的 checkout 为参考仓库（不 clone）。remote 缺省时读目录 origin。 */
export async function registerRef({ path, remote, name, desc, notes } = {}) {
  const abs = resolve(String(path || ''));
  if (!(await hasGit(abs))) throw badInput('该目录不是 git 仓库（没有 .git）: ' + abs);
  const url = String(remote || '').trim() || (await gitOrigin(abs));
  if (!url) throw badInput('目录没有 origin，且未给 --remote —— 参考仓库必须带远程地址（它是唯一 key）');
  return service.addRepo({ path: abs, name, desc, notes, type: 'ref', remote: url });
}

// mutateStore 的 fn 是同步的——所以绑定里的目标解析用同步变体（store 已在手）。
// 目标一律解析成 **key**（身份），不再用随机 id。
function repoKeyInside(s, idOrKey) {
  const raw = String(idOrKey || '').trim();
  if (!raw) return null;
  let r = s.repos.find((x) => x.id === raw);
  if (!r) {
    const k = service.normalizeKey(raw);
    if (k) r = s.repos.find((x) => service.deriveKey(x) === k);
  }
  if (!r) {
    const p = resolve(raw);
    r = s.repos.find((x) => x.path.toLowerCase() === p.toLowerCase());
  }
  if (!r) r = s.repos.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  return r ? service.deriveKey(r) : null;
}

function boardKeyInside(s, idOrKey) {
  const raw = String(idOrKey || '').trim();
  if (!raw) return null;
  let b = s.boards.find((x) => x.id === raw);
  if (!b) {
    const k = service.normalizeKey(raw);
    if (k) b = s.boards.find((x) => service.boardKeyOf(x.name) === k);
  }
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  return b ? service.boardKeyOf(b.name) : null;
}

/**
 * 绑定/摘除：ref → {repo…, board…}。一个 ref 可绑多个目标；一个目标可被多个 ref 绑。
 * 绑定**双向记录**：ref 侧写 {kind:'repo'|'board', id}，dev 侧写 {kind:'ref', id}。
 * 两侧各存一份 note（同一内容）——描述是「这条绑定」的属性，两边读都拿得到。
 * note（绑定描述）跟某一条绑定走：repo/board 传对象 {id, note} 可在绑定时一并写描述。
 * 摘除用 remove + 想摘的维度（--remove --repo x 只摘 x；都不带 = 清空全部绑定）。
 */
export async function bindTarget({ id, key, repo, board, remove } = {}) {
  const ref = await loadRef(id || key);
  // 归一输入：字符串数组 → [{id}]；{id, note} 对象数组原样收
  const normTargets = (v) =>
    (Array.isArray(v) ? v : v ? [v] : [])
      .map((t) => (typeof t === 'object' && t !== null ? { id: String(t.id || '').trim(), note: String(t.note || '').trim() } : { id: String(t || '').trim(), note: '' }))
      .filter((t) => t.id);
  return service.mutateStore((s) => {
    const r = s.repos.find((x) => x.id === ref.id);
    if (!Array.isArray(r.linked)) r.linked = [];
    const repos = normTargets(repo);
    const boards = normTargets(board);
    const refKey = service.deriveKey(r);

    // 反向引用维护：dev 侧 {kind:'ref', id:refKey, note}
    const mirror = (devKey, note, on) => {
      const d = s.repos.find((x) => service.deriveKey(x) === devKey);
      if (!d) return;
      if (!Array.isArray(d.linked)) d.linked = [];
      const hit = d.linked.find((l) => l.kind === 'ref' && l.id === refKey);
      if (on) {
        if (!hit) d.linked.push(note ? { kind: 'ref', id: refKey, note } : { kind: 'ref', id: refKey });
        else if (note) hit.note = note;
      } else if (hit) {
        d.linked = d.linked.filter((l) => !(l.kind === 'ref' && l.id === refKey));
      }
    };

    if (remove) {
      let n = 0;
      if (repos.length) {
        for (const one of repos) {
          const rkey = repoKeyInside(s, one.id);
          const before = r.linked.length;
          r.linked = r.linked.filter((l) => !(l.kind === 'repo' && (rkey ? l.id === rkey : true)));
          if (rkey) mirror(rkey, '', false);
          n += before - r.linked.length;
        }
      } else if (boards.length) {
        for (const one of boards) {
          const bkey = boardKeyInside(s, one.id);
          const before = r.linked.length;
          r.linked = r.linked.filter((l) => !(l.kind === 'board' && l.id === bkey));
          n += before - r.linked.length;
        }
      } else {
        // 清空全部：连带把 dev 侧的反向引用也摘掉
        for (const l of r.linked.slice()) {
          if (l.kind === 'repo') mirror(l.id, '', false);
        }
        n = r.linked.length;
        r.linked = [];
      }
      return { key: refKey, name: r.name, removed: true, count: n, linked: r.linked.slice() };
    }

    const added = [];
    for (const one of repos) {
      const rkey = repoKeyInside(s, one.id);
      if (!rkey) throw notFound('绑定的开发仓库不存在: ' + one.id);
      const hit = r.linked.find((l) => l.kind === 'repo' && l.id === rkey);
      if (!hit) {
        r.linked.push(one.note ? { kind: 'repo', id: rkey, note: one.note } : { kind: 'repo', id: rkey });
        added.push(rkey);
      } else if (one.note) {
        hit.note = one.note; // 已绑定：补写描述
      }
      mirror(rkey, hit ? hit.note : one.note, true);
    }
    for (const one of boards) {
      const bkey = boardKeyInside(s, one.id);
      if (!bkey) throw notFound('看板不存在: ' + one.id);
      const hit = r.linked.find((l) => l.kind === 'board' && l.id === bkey);
      if (!hit) {
        r.linked.push(one.note ? { kind: 'board', id: bkey, note: one.note } : { kind: 'board', id: bkey });
        added.push(bkey);
      } else if (one.note) {
        hit.note = one.note;
      }
    }
    if (!repos.length && !boards.length) throw badInput('请给 --repo <开发仓库> 或 --board <看板id>（或 --remove 摘除）');
    return { key: refKey, name: r.name, removed: false, added, linked: r.linked.slice() };
  });
}

/**
 * 绑定描述：单条绑定的「它在这个仓库/看板里参考什么」。
 * note 留空 = 清除。repo 用 id/key/路径/名称，board 用看板 id/key/名称。
 */
export async function setLinkNote({ id, key, repo, board, note } = {}) {
  const ref = await loadRef(id || key);
  if (!repo && !board) throw badInput('请给 --repo <开发仓库> 或 --board <看板id>');
  if (repo && board) throw badInput('--repo 与 --board 只能选一个（一条绑定一条描述）');
  const text = String(note || '').trim();
  return service.mutateStore((s) => {
    const r = s.repos.find((x) => x.id === ref.id);
    if (!Array.isArray(r.linked)) r.linked = [];
    const refKey = service.deriveKey(r);
    let link;
    if (repo) {
      const rkey = repoKeyInside(s, repo);
      if (!rkey) throw notFound('绑定的开发仓库不存在: ' + repo);
      link = r.linked.find((l) => l.kind === 'repo' && l.id === rkey);
      if (!link) throw conflict(`「${ref.name}」未绑定到该仓库 —— 先 repo bind ${ref.id} --repo ${repo}`);
      // dev 侧的反向引用同步改（两侧各存一份同一描述）
      const d = s.repos.find((x) => service.deriveKey(x) === rkey);
      if (d && Array.isArray(d.linked)) {
        const back = d.linked.find((l) => l.kind === 'ref' && l.id === refKey);
        if (back) {
          if (text) back.note = text;
          else delete back.note;
        }
      }
    } else {
      const bkey = boardKeyInside(s, board);
      if (!bkey) throw notFound('看板不存在: ' + board);
      link = r.linked.find((l) => l.kind === 'board' && l.id === bkey);
      if (!link) throw conflict(`「${ref.name}」未绑定到该看板 —— 先 repo bind ${ref.id} --board ${bkey}`);
    }
    if (text) link.note = text;
    else delete link.note;
    return { key: refKey, name: r.name, kind: link.kind, target: link.id, note: text };
  });
}

/**
 * 分层查询「这个本地仓库有哪些参考」：
 *   第一层 = 直接绑定到该仓库的 ref（它自己的参考）；
 *   第二层 = 绑定到它所在的**看板**（命名空间）上的 ref——按看板分组给出，
 *            同一个 ref 出现在多个组就多次列出（它确实从多条路都能够到）。
 * 返回 { repo, direct: [...], boards: [{id, name, desc, refs: [...]}] }
 */
export async function refsForRepo(idOrPathOrName) {
  const s = await service.loadStore();
  const raw = String(idOrPathOrName || '').trim();
  if (!raw) throw badInput('缺少仓库标识（id / key / 绝对路径 / 名称）');
  let repo = s.repos.find((x) => x.id === raw);
  if (!repo) {
    const k = service.normalizeKey(raw);
    if (k) repo = s.repos.find((x) => service.deriveKey(x) === k);
  }
  if (!repo) {
    const p = resolve(raw);
    repo = s.repos.find((x) => x.path.toLowerCase() === p.toLowerCase());
  }
  if (!repo) repo = s.repos.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!repo) throw notFound('repo 不存在: ' + raw);

  const repoKey = service.deriveKey(repo);
  const refByKey = new Map(
    s.repos.filter((r) => (r.type || 'dev') === 'ref').map((r) => [service.deriveKey(r), r])
  );
  const project = (r) => ({
    id: r.id,
    key: service.deriveKey(r),
    name: r.name,
    desc: r.desc || '',
    remote: r.remote || '',
    path: r.path,
    note: '',
  });

  // 第一层：直接绑到该仓库的 ref。
  // 数据面优先读 **dev 侧的反向引用**（{kind:'ref'}）——绑定是双向记录的，dev 自己
  // 就带着它的参考列表；老数据（只有 ref 侧）再回退扫一遍 ref 全表。
  const directRefs = [];
  const seen = new Set();
  for (const l of repo.linked || []) {
    if (l.kind !== 'ref') continue;
    const r = refByKey.get(l.id);
    if (!r) continue;
    seen.add(l.id);
    directRefs.push({ ...project(r), note: l.note || '' });
  }
  for (const r of refByKey.values()) {
    const rk = service.deriveKey(r);
    if (seen.has(rk)) continue;
    const l = (r.linked || []).find((x) => x.kind === 'repo' && x.id === repoKey);
    if (l) directRefs.push({ ...project(r), note: l.note || '' });
  }

  // 第二层：按看板命名空间分组
  const boardsOut = [];
  for (const b of s.boards) {
    if (!service.boardRepoKeys(b, s).includes(repoKey)) continue;
    const bkey = service.boardKeyOf(b.name);
    const refs = [];
    for (const r of refByKey.values()) {
      const l = (r.linked || []).find((x) => x.kind === 'board' && x.id === bkey);
      if (l) refs.push({ ...project(r), note: l.note || '' });
    }
    boardsOut.push({ id: b.id, key: bkey, name: b.name, desc: b.desc || '', refs });
  }

  return {
    repo: { id: repo.id, key: repoKey, name: repo.name, path: repo.path, desc: repo.desc || '' },
    direct: directRefs,
    boards: boardsOut,
  };
}

/** 同步单个 ref（git pull --ff-only）；不存在的目录如实报告，不静默。 */
export async function syncRef(id) {
  const ref = await loadRef(id);
  if (!(await exists(ref.path))) {
    return { id: ref.id, name: ref.name, status: 'missing', output: '本地目录不存在: ' + ref.path };
  }
  const { status, output } = await gitPull(ref.path);
  return { id: ref.id, name: ref.name, status, output };
}

/** 同步全部参考仓库（逐条给结果，单条失败不断链）。 */
export async function syncAllRefs() {
  const s = await service.loadStore();
  const refs = s.repos.filter((r) => (r.type || 'dev') === 'ref');
  const results = [];
  for (const r of refs) {
    results.push(await syncRef(r.id).catch((err) => ({ id: r.id, name: r.name, status: 'error', output: String(err.message || err) })));
  }
  return { synced: results.length, results };
}

/**
 * 完整性检查（零副作用）：ref 的本地目录 / .git / origin 与登记的 remote 一致性，
 * 加每条 linked 的目标是否存在（死链要显式露出来，而不是等用的时候才炸）。
 */
export async function checkRefs() {
  const s = await service.loadStore();
  // 死链判定按 **key**（关系引用一律用 key）
  const repoKeys = new Set(s.repos.map((r) => service.deriveKey(r)));
  const boardKeys = new Set(s.boards.map((b) => service.boardKeyOf(b.name)));
  const refs = s.repos.filter((r) => (r.type || 'dev') === 'ref');
  const out = [];
  for (const r of refs) {
    const issues = [];
    const dirExists = await exists(r.path);
    if (!dirExists) issues.push('本地目录不存在: ' + r.path);
    else if (!(await hasGit(r.path))) issues.push('目录不是 git 仓库（没有 .git）');
    else {
      const origin = await gitOrigin(r.path);
      if (!origin) issues.push('没有 origin —— 无法同步（可 repo remote 重设）');
      else if (service.normalizeRemoteKey(origin) !== service.normalizeRemoteKey(r.remote || '')) {
        issues.push(`origin 与登记不一致: origin=${origin} 登记=${r.remote}`);
      }
    }
    // 死链：ref 侧的 {repo|board} 目标没了，或 dev 侧的 {ref} 反向引用目标没了
    const dead = (r.linked || []).filter((l) => {
      if (l.kind === 'repo') return !repoKeys.has(l.id);
      if (l.kind === 'board') return !boardKeys.has(l.id);
      if (l.kind === 'ref') return !repoKeys.has(l.id);
      return false;
    });
    if (dead.length) issues.push(`绑定目标已不存在 ×${dead.length}（摘除: repo bind ${r.id} --remove）`);
    out.push({ id: r.id, name: r.name, path: r.path, remote: r.remote || '', ok: issues.length === 0, issues, deadLinks: dead });
  }
  // dev 侧的反向引用死链（ref 没了但 dev 还挂着它）
  for (const d of s.repos.filter((r) => (r.type || 'dev') !== 'ref')) {
    const dead = (d.linked || []).filter((l) => l.kind === 'ref' && !repoKeys.has(l.id));
    if (dead.length) {
      const hit = out.find((x) => x.id === d.id);
      if (hit) hit.issues.push(`反向引用已失效 ×${dead.length}（开发仓库侧）`);
    }
  }
  return { refs: out, total: refs.length, problems: out.filter((x) => !x.ok).length };
}

/** 看板 → 绑定在该看板（或其成员开发仓库）上的参考仓库清单。面板「挂载给项目组」用。 */
export async function refsForBoard(boardIdOrKey) {
  const s = await service.loadStore();
  const raw = String(boardIdOrKey || '').trim();
  let b = s.boards.find((x) => x.id === raw);
  if (!b) b = s.boards.find((x) => service.boardKeyOf(x.name) === service.normalizeKey(raw));
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!b) throw notFound('看板不存在: ' + raw);
  const bkey = service.boardKeyOf(b.name);
  const memberKeys = new Set(service.boardRepoKeys(b, s));
  const hit = (l) => (l.kind === 'board' && l.id === bkey) || (l.kind === 'repo' && memberKeys.has(l.id));
  const refs = s.repos.filter((r) => (r.type || 'dev') === 'ref' && (r.linked || []).some(hit));
  const nameOf = (l) => {
    if (l.kind === 'board') return '看板「' + b.name + '」';
    const r = s.repos.find((x) => service.deriveKey(x) === l.id);
    return r ? '仓库「' + r.name + '」' : l.id;
  };
  return {
    board: { id: b.id, key: bkey, name: b.name },
    refs: refs.map((r) => {
      const mine = (r.linked || []).filter(hit);
      // 绑定到看板本体的那条描述优先（它是命名空间索引的正文）
      const boardLink = mine.find((l) => l.kind === 'board');
      return {
        id: r.id,
        key: service.deriveKey(r),
        name: r.name,
        desc: r.desc || '',
        remote: r.remote || '',
        path: r.path,
        note: boardLink?.note || '',
        via: mine.map(nameOf),
      };
    }),
  };
}
