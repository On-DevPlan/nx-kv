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
import repoLayer from '../repo/index.js';
import type { BoardEntry, RepoHint, BoardRefEntry, Store } from '../repo/rows.js';

const repo = repoLayer;

export const cleanText = (v: unknown): string => String(v || '').trim();

/** 组介绍的主篇（面板入口用）。 */
export interface IntroMainOut {
  refId: string;
  docId: string;
  title: string;
  desc: string;
  note: string;
  tag: string;
}

// 组内描述：同一个仓库在不同看板里的角色可以各不相同（「fr 组里它是 API 契约方」，
// 「nx 组里它只是同族工具」），所以描述挂在**看板的成员关系**上（repoNotes，按 key），
// 而不是仓库登记上。登记里的 desc 回答「这个仓库是干什么的」，
// 组内描述回答「它在这个组里占什么位置、怎么配合」。
export const noteOf = (b: BoardEntry, rkey: string): string => (b.repoNotes || {})[rkey] || '';

/** 看板成员投影（memberView 的形状）。 */
export interface BoardMemberView {
  key: string;
  name: string;
  desc: string;
  path: string;
  remote: string;
  type: string;
  note: string;
  /** 组内描述文档（ref:<refId>）；没有绑定为空串 */
  noteDocId: string;
  /** 本地有没有这条登记 */
  present: boolean;
  /** 有远程地址 → 可以一键 clone 补齐 */
  clonable: boolean;
  id: string;
}

/**
 * 成员投影。key 在前，名字/描述在后面——
 * 本地未拥有的成员没有登记，只有 key + （导入文件里的）名字。
 *   present   = 本地有没有这条登记
 *   clonable  = 有远程地址 → 可以一键 clone 补齐
 */
function memberView(s: Store, b: BoardEntry, rkey: string, fallback: RepoHint | null): BoardMemberView {
  const note = noteOf(b, rkey);
  const local = s.repos.find((r) => deriveKey(r) === rkey);
  const base: BoardMemberView = {
    key: rkey,
    name: local ? local.name : (fallback && fallback.name) || rkey,
    desc: local ? local.desc || '' : (fallback && fallback.desc) || '',
    path: local ? local.path : '',
    remote: local ? local.remote || '' : (fallback && fallback.remote) || '',
    type: local ? local.type || 'dev' : (fallback && fallback.type) || 'dev',
    note,
    // 组内描述文档（ref:<refId>）——前端点开 doc 页签用
    noteDocId: (b.repoDocs || {})[rkey]?.ref ? 'ref:' + (b.repoDocs || {})[rkey].ref : '',
    present: !!local,
    clonable: !!(local ? local.remote : fallback && fallback.remote),
    id: local ? local.id : '',
  };
  return base;
}

// 占位成员的线索（导入布局时记下的 name/remote/desc/type）。
// 以前占位只留一个 key：既显示不出名字，也没有远程地址 —— 「克隆到本地」按钮
// 永远不出现，「待初始化」于是成了一个只能看、不能救的清单。
export const hintOf = (b: BoardEntry, rkey: string): RepoHint | null => (b.repoHints && b.repoHints[rkey]) || null;

/** 看板成员（全是显式成员——前缀归组命令跑一次后也固化成显式成员） */
function membersOf(s: Store, b: BoardEntry): BoardMemberView[] {
  return boardRepoKeys(b, s).map((k) => memberView(s, b, k, hintOf(b, k)));
}

/** listBoards 里的看板投影。 */
export interface BoardListEntry {
  id: string;
  name: string;
  desc: string;
  key: string;
  /** 组介绍主篇（ref:<refId>）；没有绑定为空串 */
  docId: string;
  /** 组文档总篇数（主篇 + 补充篇） */
  docCount: number;
  /** 组级参考仓库（v4）：组内所有仓库共享 */
  refs: BoardRefEntry[];
  repos: BoardMemberView[];
}

/** 未分组的仓库（有登记但不在任何看板里）。 */
export interface UnassignedRepo {
  id: string;
  key: string;
  name: string;
  desc: string;
  path: string;
}

/** listBoards 的返回。 */
export interface ListBoardsResult {
  boards: BoardListEntry[];
  unassigned: UnassignedRepo[];
}

export async function listBoards(): Promise<ListBoardsResult> {
  const s = await loadStore();
  const inBoard = new Set(s.boards.flatMap((b) => boardRepoKeys(b, s)));
  const reposOf = (b: BoardEntry) => membersOf(s, b);
  const { docSetOf } = await import('../../docs/brief.js');
  const boards: BoardListEntry[] = [];
  for (const b of s.boards) {
    const docs = await docSetOf(b, 'board');
    boards.push({
      id: b.id,
      name: b.name,
      desc: b.desc,
      key: storedBoardKey(b),
      docId: docs.main ? docs.main.docId : '',
      docCount: docs.count,
      // 组级参考仓库（v4）：组内所有仓库共享
      refs: Array.isArray(b.refs) ? b.refs : [],
      repos: reposOf(b),
    });
  }
  return {
    boards,
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

/** getBoard 的返回：单看板投影 + 介绍文档集 + 成员投影。 */
export interface GetBoardResult {
  id: string;
  name: string;
  desc: string;
  key: string;
  /** 组介绍主篇（ref:<refId>）；没有绑定为空串 */
  docId: string;
  /** 介绍文档集：主篇 + 其余各篇 */
  introMain: IntroMainOut | null;
  introExtras: Array<IntroMainOut & { name: string }>;
  introCount: number;
  refs: BoardRefEntry[];
  repos: BoardMemberView[];
}

export async function getBoard(idOrKey: unknown): Promise<GetBoardResult> {
  const s = await loadStore();
  const raw = String(idOrKey || '').trim();
  let b = s.boards.find((x) => x.id === raw);
  if (!b) b = s.boards.find((x) => storedBoardKey(x) === normalizeKey(raw));
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!b) throw notFound('看板不存在: ' + raw);
  // 组介绍是**文档集**（主篇 + 其余各篇）——#58
  const { docSetOf } = await import('../../docs/brief.js');
  const set = await docSetOf(b, 'board');
  return {
    id: b.id,
    name: b.name,
    desc: b.desc,
    key: storedBoardKey(b),
    docId: set.main ? set.main.docId : '',
    introMain: set.main ? {
      refId: set.main.refId,
      docId: set.main.docId,
      title: set.main.title,
      desc: set.main.desc,
      note: set.main.note,
      tag: set.main.tag,
    } : null,
    introExtras: set.links.map((d) => ({
      refId: d.refId,
      docId: d.docId,
      title: d.title,
      desc: d.desc,
      note: d.note,
      tag: d.tag,
      name: d.title,
    })),
    introCount: set.count,
    refs: Array.isArray(b.refs) ? b.refs : [],
    repos: membersOf(s, b),
  };
}

/** createBoard 的返回。 */
export interface CreateBoardResult {
  id: string;
  name: string;
  desc: string;
  key: string;
  repos: BoardMemberView[];
}

/** createBoard 的参数。 */
export interface CreateBoardInput {
  name?: unknown;
  desc?: unknown;
  key?: unknown;
}

export async function createBoard({ name, desc, key }: CreateBoardInput = {}, opts: { seedDoc?: boolean } = {}): Promise<CreateBoardResult> {
  const nm = cleanText(name);
  if (!nm) throw badInput('看板名称不能为空');
  const b = await mutateStore((s) => {
    if (s.boards.some((x) => x.name === nm)) throw conflict('同名看板已存在: ' + nm);
    const board: BoardEntry = {
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
    return { id: board.id, name: board.name, desc: board.desc, key: fk, repos: [] as BoardMemberView[] };
  });
  // 描述是文档：初始描述写成组介绍的主篇（已有就不动），摘要由回写刷新
  // 导入路径自带文档（zip 还原正文 + layout 的绑定），不能再按 desc 生成一篇。
  if (cleanText(desc) && opts.seedDoc !== false) await writeBoardDocContent({ name: nm }, desc);
  return b;
}

/** updateBoard 的参数。 */
export interface UpdateBoardInput {
  name?: unknown;
  desc?: unknown;
}

/** updateBoard 的返回。 */
export interface UpdateBoardResult {
  id: string;
  name: string;
  desc: string;
  key: string;
}

export async function updateBoard(idOrKey: unknown, { name, desc }: UpdateBoardInput = {}): Promise<UpdateBoardResult> {
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
    // 领域描述同样是文档：改正文用 docs update --ref，换绑主篇用 docs bind --board
    if (desc !== undefined) {
      throw badInput(
        '描述已改为文档（不再是字符串）：改正文用 `docs update --ref <refId> --body …`，' +
        '换绑主篇用 `docs bind --board <看板> --ref <refId>`'
      );
    }
    return { id: b.id, name: b.name, desc: b.desc, key: storedBoardKey(b) };
  });
}

export function findBoardIn(s: Store, idOrKey: unknown): BoardEntry | null {
  const raw = String(idOrKey || '').trim();
  let b = s.boards.find((x) => x.id === raw);
  if (!b) b = s.boards.find((x) => storedBoardKey(x) === normalizeKey(raw));
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  return b || null;
}

/** 仓库在 store 里的 key（id / key / 路径 / 名称 都认）。找不到 → null。 */
export function repoKeyIn(s: Store, idOrKey: unknown): string | null {
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

/** removeBoard 的返回。 */
export interface RemoveBoardResult {
  removed: string;
  released: number;
  key: string;
}

// 删看板 = 摘容器：repoKeys 随之消失，里面的仓库自动回未分组（登记不动）。
// 组级参考绑定（group_refs）由 persistStore 随组行删除一并清掉；这里同时摘掉
// 旧数据里 ref 侧 kind:'board' 的残留（迁移后的库应为空）。
export async function removeBoard(idOrKey: unknown): Promise<RemoveBoardResult> {
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
 * 看板的领域描述写成组介绍主篇（文档是权威）。已有主篇就不动——
 * 重复 createBoard（导入/补建）不该把写过的组介绍冲掉。
 */
async function writeBoardDocContent(board: { name: string }, text: unknown): Promise<string> {
  const { createRef, updateDoc } = await import('../../docs/service.js');
  const { setDocRef } = await import('../../docs/refs.js');
  const { summaryFromMd } = await import('../../docs/seed.js');
  const created = await createRef({ owner: 'group', group: board.name });
  const body = `# ${board.name}\n\n${String(text || '').trim()}\n`;
  await updateDoc({ ref: 'ref:' + created.refId, body });
  await setDocRef({ board: board.name, ref: created.refId });
  await mutateStore((s) => {
    const b = s.boards.find((x) => String(x.name) === board.name);
    if (b) b.desc = summaryFromMd(body);
  });
  return created.refId;
}
