// 看板核心：成员投影、看板 CRUD、定位助手（findBoardIn / repoKeyIn）。
import { resolve } from 'node:path';
import {
  loadStore,
  mutateStore,
  newId,
  boardKeyOf,
  storedBoardKey,
  boardRepoKeys,
  deriveKey,
  normalizeKey,
} from '../service.js';
import { badInput, notFound, conflict } from '../../../core/errors.js';
import { boardDocDirRel, boardDocRel, groupNoteRel } from '../../docs/paths.js';
import { readIntroSet } from '../../docs/knowledge.js';
import repoLayer from '../repo/index.js';

const repo = repoLayer;

export const cleanText = (v) => String(v || '').trim();

/** 介绍文档集条目 → DocRef 形状（自有树给 rel，外部给 path） */
function introRefOut(d) {
  if (!d) return null;
  if (d.rel) return { rel: d.rel };
  if (d.docId && String(d.docId).startsWith('rel:')) return { rel: String(d.docId).slice(4) };
  if (d.path) return { path: d.path };
  if (d.abs) return { path: d.abs };
  return null;
}

// 组内描述：同一个仓库在不同看板里的角色可以各不相同（「fr 组里它是 API 契约方」，
// 「nx 组里它只是同族工具」），所以描述挂在**看板的成员关系**上（repoNotes，按 key），
// 而不是仓库登记上。登记里的 desc 回答「这个仓库是干什么的」，
// 组内描述回答「它在这个组里占什么位置、怎么配合」。
export const noteOf = (b, rkey) => (b.repoNotes || {})[rkey] || '';

/**
 * 成员投影。key 在前，名字/描述在后面——
 * 本地未拥有的成员没有登记，只有 key + （导入文件里的）名字。
 *   present   = 本地有没有这条登记
 *   clonable  = 有远程地址 → 可以一键 clone 补齐
 */
function memberView(s, b, rkey, fallback) {
  const note = noteOf(b, rkey);
  const local = s.repos.find((r) => deriveKey(r) === rkey);
  const base = {
    key: rkey,
    name: local ? local.name : (fallback && fallback.name) || rkey,
    desc: local ? local.desc || '' : (fallback && fallback.desc) || '',
    path: local ? local.path : '',
    remote: local ? local.remote || '' : (fallback && fallback.remote) || '',
    type: local ? local.type || 'dev' : (fallback && fallback.type) || 'dev',
    note,
    // 组内描述文档（绑定优先，缺省约定路径）——前端点开 doc 页签用
    noteDocRel: (b.repoDocs || {})[rkey]?.rel || groupNoteRel(b.name, rkey),
    noteDocPath: (b.repoDocs || {})[rkey]?.path || '',
    present: !!local,
    clonable: !!(local ? local.remote : fallback && fallback.remote),
    id: local ? local.id : '',
  };
  return base;
}

// 占位成员的线索（导入布局时记下的 name/remote/desc/type）。
// 以前占位只留一个 key：既显示不出名字，也没有远程地址 —— 「克隆到本地」按钮
// 永远不出现，「待初始化」于是成了一个只能看、不能救的清单。
export const hintOf = (b, rkey) => (b.repoHints && b.repoHints[rkey]) || null;

/** 看板成员（全是显式成员——前缀归组命令跑一次后也固化成显式成员） */
function membersOf(s, b) {
  return boardRepoKeys(b, s).map((k) => memberView(s, b, k, hintOf(b, k)));
}

export async function listBoards() {
  const s = await loadStore();
  const inBoard = new Set(s.boards.flatMap((b) => boardRepoKeys(b, s)));
  const reposOf = (b) => membersOf(s, b);
  return {
    boards: s.boards.map((b) => ({
      id: b.id,
      name: b.name,
      desc: b.desc,
      key: storedBoardKey(b),
      // 组介绍文档与组级附加文档列表（绑定优先；前端渲染介绍 md 与 docLinks chips）
      docRel: b.doc?.rel || boardDocRel(b.name),
      docPath: b.doc?.path || '',
      docLinks: Array.isArray(b.docLinks) ? b.docLinks : [],
      // 组级参考仓库（v4）：组内所有仓库共享
      refs: Array.isArray(b.refs) ? b.refs : [],
      repos: reposOf(b),
    })),
    // 未分组 = 有登记但不在任何看板里（占位成员不算——它们在组里）
    unassigned: s.repos.filter((r) => !inBoard.has(deriveKey(r))).map((r) => ({
      id: r.id,
      key: deriveKey(r),
      name: r.name,
      desc: r.desc || '',
      path: r.path,
    })),
  };
}

export async function getBoard(idOrKey) {
  const s = await loadStore();
  const raw = String(idOrKey || '').trim();
  let b = s.boards.find((x) => x.id === raw);
  if (!b) b = s.boards.find((x) => storedBoardKey(x) === normalizeKey(raw));
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!b) throw notFound('看板不存在: ' + raw);
  // 组介绍是**文档集**（主篇 + 其余各篇），不是孤立的一篇——#58
  const set = await readIntroSet({
    dirRel: boardDocDirRel(b.name),
    legacyRel: boardDocRel(b.name),
    ref: b.doc || null,
    links: b.docLinks,
    warnings: [],
    label: `组介绍·${b.name}`,
  });
  return {
    id: b.id,
    name: b.name,
    desc: b.desc,
    key: storedBoardKey(b),
    docRel: b.doc?.rel || boardDocRel(b.name),
    docPath: b.doc?.path || '',
    // 介绍文档集：主篇（目录 index.md 优先）+ 其余各篇
    introMain: set.main ? introRefOut(set.main) : null,
    introExtras: (set.extras || []).map((d) => ({ ...introRefOut(d), name: d.name || '' })),
    introCount: set.count,
    docLinks: Array.isArray(b.docLinks) ? b.docLinks : [],
    refs: Array.isArray(b.refs) ? b.refs : [],
    repos: membersOf(s, b),
  };
}

export async function createBoard({ name, desc, key } = {}) {
  const nm = cleanText(name);
  if (!nm) throw badInput('看板名称不能为空');
  const b = await mutateStore((s) => {
    if (s.boards.some((x) => x.name === nm)) throw conflict('同名看板已存在: ' + nm);
    const board = {
      id: newId('b'),
      name: nm,
      desc: cleanText(desc),
      createdAt: new Date().toISOString(),
      repoKeys: [], // 成员按 key 存（不再用随机 id）
    };
    // 冻结 key：布局导入带 key（改名过的组往返后 key 不漂）；缺省按名字派生
    const fk = key ? normalizeKey(key) : boardKeyOf(nm);
    if (key && !fk) throw badInput('看板 key 不合法: ' + key);
    if (s.boards.some((x) => storedBoardKey(x) === fk)) throw conflict(`看板 key 已存在: ${fk}`);
    board.key = fk;
    s.boards.push(board);
    return { id: board.id, name: board.name, desc: board.desc, key: fk, repos: [] };
  });
  // 描述是文档：初始描述写成组介绍的主篇（已有就不动），摘要由回写刷新
  if (cleanText(desc)) await writeBoardDocContent({ name: nm }, desc);
  return b;
}

export async function updateBoard(idOrKey, { name, desc } = {}) {
  const nm = name === undefined ? undefined : cleanText(name);
  if (nm !== undefined && !nm) throw badInput('看板名称不能为空');
  return mutateStore((s) => {
    const b = findBoardIn(s, idOrKey);
    if (!b) throw notFound('看板不存在: ' + idOrKey);
    if (nm !== undefined && s.boards.some((x) => x.id !== b.id && x.name === nm)) {
      throw conflict('同名看板已存在: ' + nm);
    }
    if (nm !== undefined) b.name = nm;
    // 改名只动显示名：冻结 key 不变（成员边 / ref 绑定 / topics.group_key 都指它）。
    // （updateBoard 不接受 key 参数 —— key 是身份，改身份没有入口。）
    // 领域描述同样是文档：写正文用 docs set，换绑主篇用 docs bind --board
    if (desc !== undefined) {
      throw badInput(
        '描述已改为文档（不再是字符串）：改正文用 `docs set board/<组>.md`，' +
        '换绑主篇用 `docs bind --board <看板> --rel <路径>`'
      );
    }
    return { id: b.id, name: b.name, desc: b.desc, key: storedBoardKey(b) };
  });
}

export function findBoardIn(s, idOrKey) {
  const raw = String(idOrKey || '').trim();
  let b = s.boards.find((x) => x.id === raw);
  if (!b) b = s.boards.find((x) => storedBoardKey(x) === normalizeKey(raw));
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  return b || null;
}

/** 仓库在 store 里的 key（id / key / 路径 / 名称 都认）。找不到 → null。 */
export function repoKeyIn(s, idOrKey) {
  const raw = String(idOrKey || '').trim();
  if (!raw) return null;
  let r = s.repos.find((x) => x.id === raw);
  if (!r) {
    const k = normalizeKey(raw);
    if (k) r = s.repos.find((x) => deriveKey(x) === k);
  }
  if (!r) {
    const p = resolve(raw);
    r = s.repos.find((x) => x.path.toLowerCase() === p.toLowerCase());
  }
  if (!r) r = s.repos.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  return r ? deriveKey(r) : null;
}

// 删看板 = 摘容器：repoKeys 随之消失，里面的仓库自动回未分组（登记不动）。
// 组级参考绑定（group_refs）由 persistStore 随组行删除一并清掉；这里同时摘掉
// 旧数据里 ref 侧 kind:'board' 的残留（迁移后的库应为空）。
export async function removeBoard(idOrKey) {
  // 删组前置检查：topics.group_key 是 RESTRICT —— 挂着队列上下文的组删不掉，
  // 先把那些队列处理掉（改上下文或删除）再删。与其等 FK 报「外键违规」，
  // 不如提前说人话。
  const s0 = await loadStore();
  const target = findBoardIn(s0, idOrKey);
  if (target) {
    const bound = repo.txw((conn) => repo.repos.countTopicsOfGroup(storedBoardKey(target), conn));
    if (bound > 0) {
      throw conflict(
        `看板「${target.name}」下还有 ${bound} 条队列按该组上下文运行 —— 先处理这些队列再删组`
      );
    }
  }
  return mutateStore((s) => {
    const b = findBoardIn(s, idOrKey);
    if (!b) throw notFound('看板不存在: ' + idOrKey);
    const bkey = storedBoardKey(b);
    const released = boardRepoKeys(b, s).length;
    s.boards = s.boards.filter((x) => x.id !== b.id);
    for (const r of s.repos) {
      if (!Array.isArray(r.linked)) continue;
      r.linked = r.linked.filter((l) => !(l.kind === 'board' && l.id === bkey));
    }
    return { removed: b.name, released, key: bkey };
  });
}

/**
 * 看板的领域描述写进 board/<组>.md（文档是权威）。已有文档就不动——
 * 重复 createBoard（导入/补建）不该把写过的组介绍冲掉。
 */
async function writeBoardDocContent(board, text) {
  const { boardDocRel } = await import('../../docs/paths.js');
  const store = await import('../../docs/store.js');
  const { writeBackSummary } = await import('../../docs/seed.js');
  const rel = boardDocRel(board.name);
  if (await store.ownDocExists(rel)) return rel;
  const body = `# ${board.name}\n\n${String(text || '').trim()}\n`;
  await store.writeOwnDoc(rel, body);
  await writeBackSummary(rel, body);
  return rel;
}
