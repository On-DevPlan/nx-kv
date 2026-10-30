// 布局导入导出（v3）：仓库 + 分组 + 参考关系，以**全局唯一 key** 为身份映射。
//
// **为什么 v3**：v2 用远程地址当身份，但同一个仓库的 SSH/HTTPS 写法不同就会被当成
// 两个仓库；开发仓库没有远程地址时只能按名字匹配，重名即歧义。v3 给每个仓库一个
// key（归一化远程地址派生，或用户自定义），导出物里**不出现任何本地路径**。
//
// 导入是三步：`diffImport` 算差异（零副作用）→ 用户在面板里逐条勾选/选策略 →
// `repoImport` 执行。CLI 侧每一步都有同构命令。
import { join, resolve } from 'node:path';
import fsp from 'node:fs/promises';
import { loadConfig } from '../../core/config.js';
import { badInput } from '../../core/errors.js';
import { makeZip } from '../../core/zip.js';
import * as service from './service.js';
import * as boards from './boards.js';
import { gitClone, hasGit } from './git.js';

const clean = (v) => String(v || '').trim();
const boardKey = (name) => service.boardKeyOf(name);
// 仓库的 key（自定义 > remote 派生 > local 兜底）
const deriveKeyOf = (r) => service.deriveKey(r);

// ─── 导出 ─────────────────────────────────────────────────────────────

/**
 * 导出布局。
 *   repoKeys / boardKeys  只导出这些 key（空 = 全部）
 *   includeUnassigned     是否带上不属于任何看板的仓库（默认 true）
 *   boardSelection        只导出这些看板的成员关系（与 boardKeys 同义，保留旧名）
 */
export async function repoExport({ repoKeys, boardKeys, includeUnassigned = true } = {}) {
  const s = await service.loadStore();
  const warnings = [];
  const keyOf = new Map(s.repos.map((r) => [r.id, service.deriveKey(r)]));
  const boardKeyOf = new Map(s.boards.map((b) => [b.id, boardKey(b.name)]));

  const wantRepo = (k) => !repoKeys?.length || repoKeys.includes(k);
  const wantBoard = (k) => !boardKeys?.length || boardKeys.includes(k);

  // 成员按 key 存（board.repoKeys）——与仓库登记同一套身份
  const memberKeysOf = (b) => service.boardRepoKeys(b, s);
  const inAnyBoard = new Set(s.boards.flatMap(memberKeysOf));
  const selectedBoards = s.boards.filter((b) => wantBoard(boardKeyOf.get(b.id)));
  // 选中的仓库 = 直接指定的 + 选中看板的成员 + （可选）未分组仓库
  const selectedIds = new Set();
  for (const r of s.repos) {
    if (!wantRepo(keyOf.get(r.id))) continue;
    if (repoKeys?.length) selectedIds.add(r.id);
  }
  for (const b of selectedBoards) {
    for (const k of memberKeysOf(b)) {
      const hit = s.repos.find((r) => deriveKeyOf(r) === k);
      if (hit) selectedIds.add(hit.id);
    }
  }
  if (includeUnassigned && !repoKeys?.length && !boardKeys?.length) {
    for (const r of s.repos) if (!inAnyBoard.has(deriveKeyOf(r))) selectedIds.add(r.id);
  }

  const repos = [];
  for (const r of s.repos) {
    if (!selectedIds.has(r.id)) continue;
    // **冻结的仓库不导出**：没有身份（无远程地址、也没自定义 key），它的 key 只是
    // 本机的 local/<名称> 锚点——导出去对方也映射不到同一个仓库，纯噪音。
    if (service.isFrozen(r)) {
      warnings.push(`仓库「${r.name}」没有 key（无远程地址、也未自定义）—— 已跳过：导出导入要靠 key 映射，它没有身份（补 remote 或 repo key set 后即可导出）`);
      continue;
    }
    const k = keyOf.get(r.id);
    if (!k) {
      warnings.push(`仓库「${r.name}」没有可用的 key —— 已跳过（先 repo key refresh 或 repo key set）`);
      continue;
    }
    const entry = {
      key: k,
      keyCustom: !!r.keyCustom,
      name: r.name,
      desc: r.desc || '',
      type: r.type || 'dev',
    };
    if (r.remote) entry.remote = r.remote;
    if (Array.isArray(r.remotes) && r.remotes.length) entry.remotes = r.remotes.slice();
    if (r.notes) entry.notes = r.notes;
    if (!r.remote && (r.type || 'dev') === 'dev') {
      warnings.push(`开发仓库「${r.name}」没有远程地址 —— 导入端只能按 key 登记，无法 clone`);
    }
    repos.push(entry);
  }

  // 冻结成员（local/<名称>）不是身份：别人那边映射不到任何东西，留在成员表里
  // 只会让导入端多出一条「本地未拥有」的幽灵。剔除并如实告警。
  const frozenKeys = new Set(
    s.repos.filter((r) => service.isFrozen(r)).map((r) => service.deriveKey(r))
  );
  const boardsOut = selectedBoards.map((b) => {
    const members = [];
    for (const k of service.boardRepoKeys(b, s)) {
      if (frozenKeys.has(k)) {
        const nm = s.repos.find((r) => service.deriveKey(r) === k)?.name || k;
        warnings.push(`项目组「${b.name}」的成员「${nm}」没有 key（冻结）—— 已从导出里剔除（补 remote 或自定义 key 后才会带上）`);
        continue;
      }
      const note = (b.repoNotes || {})[k] || '';
      members.push(note ? { key: k, note } : { key: k });
    }
    return { key: boardKeyOf.get(b.id), name: b.name, desc: b.desc || '', repos: members };
  });

  // 参考关系：ref → 目标（repo key / board key），note 随关系走
  const selectedKeySet = new Set(repos.map((r) => r.key));
  const links = [];
  for (const r of s.repos) {
    if ((r.type || 'dev') !== 'ref' || !(r.linked || []).length) continue;
    const k = keyOf.get(r.id);
    if (!k || !selectedKeySet.has(k)) continue;
    const to = [];
    for (const l of r.linked) {
      // 关系引用已经是 key（迁移后），直接用
      if (l.kind === 'repo') {
        if (selectedKeySet.has(l.id)) to.push(l.note ? { repo: l.id, note: l.note } : { repo: l.id });
      } else if (l.kind === 'board') {
        if (wantBoard(l.id)) to.push(l.note ? { board: l.id, note: l.note } : { board: l.id });
      }
    }
    if (to.length) links.push({ ref: k, to });
  }

  // 看板关系里可能引用了没被选中的仓库 —— 如实报告，导入端会标「本地未拥有」
  for (const b of boardsOut) {
    for (const m of b.repos) {
      if (!selectedKeySet.has(m.key)) {
        warnings.push(`看板「${b.name}」的成员 ${m.key} 不在导出范围内 —— 导入端会显示为「本地未拥有」`);
      }
    }
  }

  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    repos,
    boards: boardsOut,
    links,
    warnings,
  };
}

/** 导出为 zip：layout.json + README.txt。返回 Buffer。 */
export async function repoExportZip(options = {}) {
  const layout = await repoExport(options);
  const readme = [
    'nx-kv 仓库布局导出',
    `导出时间: ${layout.exportedAt}`,
    `格式版本: ${layout.version}`,
    '',
    '导入方法:',
    '  nx-kv repo import layout.json --diff      # 先看差异',
    '  nx-kv repo import layout.json             # 执行导入',
    '  面板: 仓库页 →「导入导出」→ 选择 layout.json',
    '',
    '说明:',
    '  - 每个仓库以全局唯一 key 标识（来自远程地址或自定义）',
    '  - 不包含任何本地路径，换机导入后需 clone 或手工登记',
    '  - 看板以 board/<名称> 为 key；关系与组内描述都在 layout.json 里',
    '',
    `仓库 ${layout.repos.length} 个 / 看板 ${layout.boards.length} 个 / 关系 ${layout.links.length} 条`,
  ].join('\n');
  return makeZip([
    { name: 'layout.json', data: JSON.stringify(layout, null, 2) },
    { name: 'README.txt', data: readme },
  ]);
}

// ─── 解析（兼容 v2）─────────────────────────────────────────────────────

function parseLayout(json) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw badInput('布局 JSON 解析失败（请给 repo export 的完整输出）');
  }
  const incoming = Array.isArray(data?.repos) ? data.repos : null;
  if (!incoming) throw badInput('JSON 里没有 repos 数组 —— 认 repo export 的 v3 / v2 格式');
  return normalizeLayout(data);
}

// v2 → v3：没有 key 的条目用 remote/name 现算，让老导出文件也能导入。
function normalizeLayout(data) {
  const repos = (data.repos || []).map((r) => {
    const remote = clean(r.remote);
    const name = clean(r.name);
    const key = clean(r.key) || service.deriveKey({ name, remote }) || service.localKeyOf(name);
    const out = {
      key,
      keyCustom: r.keyCustom === true,
      name,
      desc: clean(r.desc),
      type: r.type === 'ref' ? 'ref' : 'dev',
    };
    if (remote) out.remote = remote;
    if (Array.isArray(r.remotes)) out.remotes = r.remotes.map(clean).filter(Boolean);
    if (r.notes) out.notes = clean(r.notes);
    return out;
  });

  const boardsIn = (data.boards || []).map((b) => {
    const name = clean(b?.name);
    return {
      key: clean(b?.key) || boardKey(name),
      name,
      desc: clean(b?.desc),
      repos: (Array.isArray(b?.repos) ? b.repos : [])
        .map((e) => {
          const entry = typeof e === 'string' ? { key: clean(e) } : e;
          const key = clean(entry?.key) || clean(entry?.remote)
            ? (clean(entry?.key) || service.deriveKey({ name: clean(entry?.name), remote: clean(entry?.remote) }))
            : service.localKeyOf(clean(entry?.name));
          return key ? { key, note: clean(entry?.note) } : null;
        })
        .filter(Boolean),
    };
  }).filter((b) => b.name);

  // 关系：v2 用 remote 引用，v3 用 key
  const keyByRemote = new Map(repos.filter((r) => r.remote).map((r) => [service.keyFromRemote(r.remote), r.key]));
  const resolveRef = (v) => {
    const s = clean(v);
    if (!s) return '';
    const byKey = repos.find((r) => r.key === service.normalizeKey(s));
    if (byKey) return byKey.key;
    const rk = service.keyFromRemote(s);
    if (rk && keyByRemote.has(rk)) return keyByRemote.get(rk);
    return service.normalizeKey(s);
  };
  const boardKeyByName = new Map((data.boards || []).map((b) => [clean(b?.name), clean(b?.key) || boardKey(clean(b?.name))]));

  const links = (Array.isArray(data.links) ? data.links : []).map((l) => {
    const ref = resolveRef(l?.ref);
    if (!ref) return null;
    const to = (Array.isArray(l.to) ? l.to : []).map((t) => {
      if (t?.repo) return t.note ? { repo: resolveRef(t.repo), note: clean(t.note) } : { repo: resolveRef(t.repo) };
      if (t?.board) {
        const bk = boardKeyByName.get(clean(t.board)) || clean(t.board);
        return t.note ? { board: bk, note: clean(t.note) } : { board: bk };
      }
      return null;
    }).filter(Boolean);
    return to.length ? { ref, to } : null;
  }).filter(Boolean);

  return { ...data, repos, boards: boardsIn, links };
}

// ─── 差异检查 ───────────────────────────────────────────────────────────

const COMPARE_FIELDS = ['name', 'desc', 'notes', 'type', 'remote'];

/**
 * 导入差异：逐条给出 status 与字段级差异。**零副作用**（不落盘、不触网）。
 *   new            本地没有这个 key
 *   same           本地有且字段一致
 *   changed        本地有但字段有差异（fields 列出每一项）
 *   missing-local  文件里被看板/关系引用，但文件与本地都没有定义（断链）
 */
export async function diffImport(json) {
  const layout = parseLayout(json);
  const s = await service.loadStore();
  const localByKey = new Map(s.repos.map((r) => [service.deriveKey(r), r]));

  const repos = layout.repos.map((inc) => {
    const local = localByKey.get(inc.key) || null;
    if (!local) {
      return {
        key: inc.key,
        status: 'new',
        local: null,
        incoming: inc,
        fields: [],
        canClone: !!inc.remote,
      };
    }
    const fields = [];
    for (const f of COMPARE_FIELDS) {
      // type 读时默认 dev（老记录没有该字段）——比较也要按同一默认值来，
      // 否则每条老仓库都会被误报成「type 有差异」。
      const a = f === 'type' ? clean(local[f]) || 'dev' : clean(local[f]);
      const b = clean(inc[f]);
      if (a !== b) fields.push({ field: f, local: a, incoming: b });
    }
    return {
      key: inc.key,
      status: fields.length ? 'changed' : 'same',
      local: { id: local.id, name: local.name, desc: local.desc, type: local.type || 'dev', remote: local.remote || '', path: local.path },
      incoming: inc,
      fields,
      canClone: !!inc.remote,
    };
  });

  const knownKeys = new Set([...repos.map((r) => r.key), ...localByKey.keys()]);
  const missing = new Set();
  for (const b of layout.boards) for (const m of b.repos) if (!knownKeys.has(m.key)) missing.add(m.key);
  for (const l of layout.links) {
    if (!knownKeys.has(l.ref)) missing.add(l.ref);
    for (const t of l.to) if (t.repo && !knownKeys.has(t.repo)) missing.add(t.repo);
  }

  const boardByKey = new Map(s.boards.map((b) => [boardKey(b.name), b]));
  const boardsOut = layout.boards.map((inc) => {
    const local = boardByKey.get(inc.key) || null;
    const fields = [];
    if (local) {
      if (clean(local.name) !== inc.name) fields.push({ field: 'name', local: local.name, incoming: inc.name });
      if (clean(local.desc) !== inc.desc) fields.push({ field: 'desc', local: local.desc || '', incoming: inc.desc });
    }
    // 本地未拥有的成员：带上 remote（面板的「克隆到本地」按钮要用它）
    const missingMembers = inc.repos
      .filter((m) => !knownKeys.has(m.key))
      .map((m) => {
        const src = layout.repos.find((x) => x.key === m.key);
        return {
          key: m.key,
          name: (src && src.name) || m.key,
          remote: (src && src.remote) || '',
          type: (src && src.type) || 'dev',
          clonable: !!(src && src.remote),
        };
      });
    return {
      key: inc.key,
      status: !local ? 'new' : fields.length ? 'changed' : 'same',
      local: local ? { id: local.id, name: local.name, desc: local.desc || '' } : null,
      incoming: inc,
      fields,
      missingMembers,
    };
  });

  const summary = {
    new: repos.filter((r) => r.status === 'new').length,
    changed: repos.filter((r) => r.status === 'changed').length,
    same: repos.filter((r) => r.status === 'same').length,
    missing: missing.size,
    boardsNew: boardsOut.filter((b) => b.status === 'new').length,
    boardsChanged: boardsOut.filter((b) => b.status === 'changed').length,
  };

  return {
    version: layout.version || 3,
    repos,
    boards: boardsOut,
    links: layout.links,
    missing: [...missing],
    summary,
    warnings: Array.isArray(layout.warnings) ? layout.warnings : [],
  };
}

// ─── 导入执行 ───────────────────────────────────────────────────────────

function cloneModeFor(type, clone) {
  if (clone === 'all') return true;
  if (clone === 'dev') return type === 'dev';
  if (clone === 'ref') return type === 'ref';
  return false; // none
}

/**
 * 执行导入。
 *   selection       要处理的 key（空 = 全部）
 *   strategy        ours=保留本地 / overwrite=用导入覆盖 / duplicate=另存 key-import-N
 *   boardSelection  要处理的看板 key（空 = 全部）
 *   clone           all | dev | ref | none
 */
export async function repoImport({
  json,
  selection,
  strategy = 'ours',
  boardSelection,
  clone = 'none',
} = {}) {
  if (!['ours', 'overwrite', 'duplicate'].includes(strategy)) {
    throw badInput('strategy 只能是 ours | overwrite | duplicate，收到: ' + strategy);
  }
  const layout = parseLayout(json);
  const diff = await diffImport(JSON.stringify(layout));

  const cfg = await loadConfig();
  const gitRepoRoot = clean(cfg.gitRepoRoot);
  const gitDevRoot = clean(cfg.gitDevRoot);
  const warnings = [];

  const sel = new Set((Array.isArray(selection) ? selection : selection ? [selection] : []).map(clean).filter(Boolean));
  const want = (k) => !sel.size || sel.has(k);
  const bsel = new Set((Array.isArray(boardSelection) ? boardSelection : boardSelection ? [boardSelection] : []).map(clean).filter(Boolean));
  const wantBoard = (k) => !bsel.size || bsel.has(k);

  const created = [];
  const updated = [];
  const duplicated = [];
  const cloned = [];
  const skipped = [];
  const keyMap = new Map(); // 导入 key -> 本地 repo id

  // 先登记本地已有的（哪怕这次不动，也要能解析关系）
  // keyMap: repoKey -> repoKey（关系的身份；本地有没有这条登记用 keyMap.has 判断）
  const s0 = await service.loadStore();
  for (const r of s0.repos) {
    // 冻结仓库不进 keyMap：它的 local/<名称> 不是身份，不该被导入文件"命中"
    if (service.isFrozen(r)) continue;
    keyMap.set(service.deriveKey(r), service.deriveKey(r));
  }

  for (const item of diff.repos) {
    if (!want(item.key)) continue;
    const inc = item.incoming;
    try {
      if (item.status === 'same') {
        skipped.push({ key: item.key, why: '已一致' });
        continue;
      }

      if (item.status === 'changed') {
        if (strategy === 'ours') {
          skipped.push({ key: item.key, why: '保留本地（ours）' });
          continue;
        }
        if (strategy === 'overwrite') {
          const patch = {};
          for (const f of item.fields) {
            if (f.field === 'type') patch.type = inc.type;
            else if (f.field === 'remote') patch.remote = inc.remote || '';
            else patch[f.field] = inc[f.field];
          }
          await service.updateRepo(item.local.id, patch);
          updated.push({ key: item.key, fields: item.fields.map((f) => f.field) });
          continue;
        }
        // duplicate：另存一份（占位路径带上新 key，避免与原记录/前一次复制撞路径）
        const newKey = await uniqueKey(item.key);
        const r = await service.addRepo({
          path: placeholderPath({ ...inc, key: newKey }, gitRepoRoot, gitDevRoot, newKey),
          name: (inc.name || inc.key) + ' (import)',
          desc: inc.desc,
          notes: inc.notes,
          type: inc.type,
          remote: inc.remote || '',
          key: newKey,
          keyCustom: true,
          remotes: inc.remotes || [],
        });
        duplicated.push({ key: item.key, newKey, id: r.id });
        keyMap.set(newKey, newKey);
        continue;
      }

      // status === 'new'：登记（可选 clone）
      const type = inc.type;
      const root = type === 'ref' ? gitRepoRoot : gitDevRoot;
      const wantClone = cloneModeFor(type, clone) && !!inc.remote && !!root;
      if (cloneModeFor(type, clone) && inc.remote && !root) {
        warnings.push(`「${inc.name || inc.key}」需要克隆但 ${type === 'ref' ? 'gitRepoRoot' : 'gitDevRoot'} 未设置 —— 只登记`);
      }

      // 磁盘上已经有同源目录（换机搬过 / 以前 clone 过）就直登记，不再 clone
      let dest = null;
      if (root && inc.remote) {
        const guess = resolve(join(resolve(root), service.dirnameFromRemote(inc.remote)));
        if (await hasGit(guess)) dest = guess;
      }

      if (!dest && wantClone) {
        dest = resolve(join(resolve(root), service.dirnameFromRemote(inc.remote)));
        const used = await gitClone(inc.remote, dest, { depth: 1 });
        cloned.push({ key: item.key, dest, remote: used });
        const r = await service.addRepo({
          path: dest, name: inc.name, desc: inc.desc, notes: inc.notes,
          type, remote: used, key: inc.key, keyCustom: inc.keyCustom, remotes: inc.remotes || [],
        });
        created.push({ key: item.key, id: r.id, cloned: true });
        keyMap.set(item.key, item.key);
        continue;
      }

      const r = await service.addRepo({
        path: dest || placeholderPath(inc, gitRepoRoot, gitDevRoot),
        name: inc.name,
        desc: inc.desc,
        notes: inc.notes,
        type,
        remote: inc.remote || '',
        key: inc.key,
        keyCustom: inc.keyCustom,
        remotes: inc.remotes || [],
      });
      created.push({ key: item.key, id: r.id, cloned: !!dest });
      keyMap.set(item.key, item.key);
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (/已.*登记|已存在/.test(msg)) skipped.push({ key: item.key, why: msg });
      else warnings.push(`「${inc.name || item.key}」导入失败: ${msg}`);
    }
  }

  // 看板：按 key 匹配，缺失则新建；成员按 repo key 解析
  let boardsCreated = 0;
  let boardsMerged = 0;
  const unmatched = [];
  for (const bd of diff.boards) {
    if (!wantBoard(bd.key)) continue;
    const inc = bd.incoming;
    let b = (await service.loadStore()).boards.find((x) => boardKey(x.name) === bd.key);
    try {
      if (!b) {
        await boards.createBoard({ name: inc.name, desc: inc.desc });
        boardsCreated += 1;
        b = (await service.loadStore()).boards.find((x) => boardKey(x.name) === bd.key);
      } else {
        boardsMerged += 1;
        if (strategy === 'overwrite' && inc.desc && inc.desc !== (b.desc || '')) {
          await boards.updateBoard(b.id, { desc: inc.desc });
        }
      }
      if (!b) continue;
      // **完整复制导出方的组布局**：按导入文件的顺序重建成员列表。
      // 本地没有的成员（占位）也保留位置 —— 组结构照抄，缺的那几个标出来等 clone。
      for (const m of inc.repos) {
        const known = keyMap.has(m.key);
        await boards.assignRepo({ key: m.key, board: b.id }).catch(() => {});
        if (m.note) {
          // 组内描述挂在 key 上：占位成员也保留描述，等仓库补齐后自动生效
          await boards.setBoardRepoNote({ key: m.key, board: b.id, note: m.note }).catch(() => {});
        }
        if (!known) {
          unmatched.push({
            board: inc.name,
            entry: m.key,
            reason: '本地未拥有',
            remote: m.remote || '',
            clonable: !!m.remote,
            name: m.name || '',
          });
        }
      }
    } catch (err) {
      warnings.push(`看板「${inc.name}」导入失败: ${String((err && err.message) || err)}`);
    }
  }

  // 参考关系
  let linksDone = 0;
  for (const l of diff.links) {
    const rkey = l.ref;
    if (!keyMap.has(rkey)) {
      unmatched.push({ board: '(参考关系)', entry: rkey, reason: '参考仓库本地未拥有' });
      continue;
    }
    for (const t of l.to) {
      try {
        if (t.repo) {
          if (!keyMap.has(t.repo)) {
            unmatched.push({ board: `(参考关系 ${l.ref})`, entry: t.repo, reason: '本地未拥有' });
            continue;
          }
          await refBind(rkey, t.repo, null, t.note);
        } else if (t.board) {
          const bs = (await service.loadStore()).boards.find((x) => boardKey(x.name) === t.board);
          if (!bs) { unmatched.push({ board: `(参考关系 ${l.ref})`, entry: '看板 ' + t.board, reason: '看板未建立' }); continue; }
          await refBind(rkey, null, boardKey(bs.name), t.note);
        }
        linksDone += 1;
      } catch (err) {
        warnings.push(`参考关系 ${l.ref} → ${t.repo || t.board} 失败: ${String((err && err.message) || err)}`);
      }
    }
  }

  return {
    strategy,
    created,
    updated,
    duplicated,
    cloned,
    skipped,
    unmatched,
    warnings,
    boardsCreated,
    boardsMerged,
    links: linksDone,
  };
}

// 给重复导入起一个不冲突的 key：key-import-1/2/3…
async function uniqueKey(base) {
  const s = await service.loadStore();
  const used = new Set(s.repos.map((r) => service.deriveKey(r)));
  for (let i = 1; i < 1000; i++) {
    const k = `${base}-import-${i}`;
    if (!used.has(k)) return k;
  }
  return `${base}-import-${Date.now().toString(36)}`;
}

// 没有可 clone 的远程地址时，登记路径只是占位（目录不存在，等 clone 后 update --path）。
// 占位目录名取 key 的末段——复制出来的条目 key 不同，目录也就不会撞。
function placeholderPath(inc, gitRepoRoot, gitDevRoot, keyOverride) {
  const root = inc.type === 'ref' ? gitRepoRoot : gitDevRoot;
  const base = resolve(root || '.');
  const k = keyOverride || inc.remote || inc.key;
  const dir = service.dirnameFromRemote(k).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
  return join(base, dir);
}

// 关系重建的绑定直写（双向：ref 侧写 {repo|board}，dev 侧写反向 {ref}）。
// 入参一律是 **key**（关系的身份），不再用随机 id。
async function refBind(refKey, repoKey, boardKey_, note) {
  return service.mutateStore((s) => {
    const r = s.repos.find((x) => deriveKeyOf(x) === refKey);
    if (!r) throw badInput('参考仓库不存在: ' + refKey);
    if (!Array.isArray(r.linked)) r.linked = [];
    const key = boardKey_ ? 'board:' + boardKey_ : 'repo:' + repoKey;
    const hit = r.linked.find((l) => l.kind + ':' + l.id === key);
    if (!hit) {
      r.linked.push(
        note
          ? boardKey_ ? { kind: 'board', id: boardKey_, note } : { kind: 'repo', id: repoKey, note }
          : boardKey_ ? { kind: 'board', id: boardKey_ } : { kind: 'repo', id: repoKey }
      );
    } else if (note) {
      hit.note = note;
    }
    if (repoKey) {
      const d = s.repos.find((x) => deriveKeyOf(x) === repoKey);
      if (d) {
        if (!Array.isArray(d.linked)) d.linked = [];
        const back = d.linked.find((l) => l.kind === 'ref' && l.id === refKey);
        if (!back) d.linked.push(note ? { kind: 'ref', id: refKey, note } : { kind: 'ref', id: refKey });
        else if (note) back.note = note;
      }
    }
    return r.linked.slice();
  });
}

// 写入 zip 到磁盘（CLI --zip 用）
export async function writeExportZip(file, options = {}) {
  const buf = await repoExportZip(options);
  const abs = resolve(String(file));
  await fsp.mkdir(join(abs, '..'), { recursive: true });
  await fsp.writeFile(abs, buf);
  return { file: abs, bytes: buf.length };
}

// ─── 人读渲染（CLI 用；面板直接消费 JSON）──────────────────────────────

const STATUS_LABEL = { new: '新增', changed: '有差异', same: '一致', 'missing-local': '本地未拥有' };

export function renderDiff(d) {
  const lines = [
    `差异检查（v${d.version}）: 新增 ${d.summary.new} · 有差异 ${d.summary.changed} · 一致 ${d.summary.same} · 本地未拥有 ${d.summary.missing}`,
  ];
  for (const r of d.repos) {
    const label = STATUS_LABEL[r.status] || r.status;
    const clone = r.canClone ? '（可克隆）' : '';
    lines.push(`  [${label}] ${r.key}${clone}`);
    for (const f of r.fields) {
      lines.push(`      ${f.field}: ${JSON.stringify(f.local)} → ${JSON.stringify(f.incoming)}`);
    }
  }
  for (const b of d.boards) {
    const label = STATUS_LABEL[b.status] || b.status;
    lines.push(`  [看板${label}] ${b.key}（${b.incoming.repos.length} 个成员）`);
    if (b.missingMembers.length) {
      lines.push(`      本地未拥有成员: ${b.missingMembers.map((m) => m.key).join('、')}`);
    }
  }
  for (const l of d.links) {
    lines.push(`  关系 ${l.ref} → ${l.to.map((t) => t.repo || t.board).join('、')}`);
  }
  if (d.missing.length) lines.push(`  本地未拥有: ${d.missing.join('、')}`);
  const hasChange = d.summary.new || d.summary.changed || d.missing.length;
  if (hasChange) lines.push('', '执行: nx-kv repo import <file> [--strategy ours|overwrite|duplicate] [--select <keys>]');
  else lines.push('', '本地与导入文件完全一致。');
  return lines.join('\n');
}

export function renderResult(d) {
  const lines = [
    `导入完成（策略 ${d.strategy}）: 新建 ${d.created.length} · 覆盖 ${d.updated.length} · 另存 ${d.duplicated.length} · 跳过 ${d.skipped.length}`,
    `看板: 新建 ${d.boardsCreated} · 合并 ${d.boardsMerged}｜参考关系 ${d.links} 条`,
  ];
  if (d.cloned.length) {
    lines.push('克隆:');
    for (const c of d.cloned) lines.push(`  ${c.key}  →  ${c.dest}`);
  }
  if (d.duplicated.length) {
    lines.push('另存:');
    for (const c of d.duplicated) lines.push(`  ${c.key}  →  ${c.newKey}`);
  }
  if (d.skipped.length) {
    lines.push('跳过:');
    for (const c of d.skipped) lines.push(`  ${c.key}（${c.why}）`);
  }
  if (d.unmatched.length) {
    lines.push('未匹配:');
    for (const u of d.unmatched) lines.push(`  [${u.board}] ${u.entry} —— ${u.reason}`);
  }
  for (const w of d.warnings) lines.push(`⚠ ${w}`);
  return lines.join('\n');
}
