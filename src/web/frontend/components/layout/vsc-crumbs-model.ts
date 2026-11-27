// VS Code 式面包屑的数据模型（纯函数，单测直接吃——#254）。
//
// 三段：**命名空间 → 组/目录 → 任务**；点任一段弹「同级的其余」：
//   · ns 段下拉 = 其余命名空间（点击 = 侧栏切过去 + 落到它的首个成员页）
//   · 组段下拉 = 该命名空间下**其余**目录（队列）；没有看板归属时本段就是目录本身
//   · 任务段下拉 = 同队列**其余**任务（pending→plan→claimed→done 序）
//
// 数据口径（都不新增后端字段）：
//   · 命名空间 = prefs.namespaces（纯 UI 分区；items 键 'board:<id>' | '<仓库key>'）
//   · 组 = 队列所属仓库登记的看板（topic.repo.boards[0]；组锚定路由用它自己解析到的看板）
//   · 目录 = 一条本机队列（topic）；cwd 取 topic.cwd（复制寻址用）
//   · 未分组 = 不在任何 ns items 里的队列（伪分区，不进下拉的「其余」里）
import { findGroupTask } from '../../modules/board/board-view.js';
import type { AppRoute, BoardRow, LocalTask, LocalTopic, Prefs, RepoData } from '../../types.js';

// 兄弟模块类型桥：board-view 尚未类型化（与 crumbs.ts 同一款桥），按真实契约收窄。
const findGroupTaskBridge = findGroupTask as unknown as (
  rows: LocalTopic[],
  boards: BoardRow[],
  groupKey: string | undefined,
  taskId: string | number,
) => { board?: BoardRow | null; topic?: LocalTopic | null; taskRow?: LocalTask | null };

/** 同级下拉的一项：hash 直跳；nsId 特殊（先切侧栏命名空间再落它的首个成员页）。
    taskId = 任务段下拉的任务条目（#261：hover 双按钮用——复制该任务路径 / 旁路预览）。 */
export interface VscSibling {
  label: string;
  hash: string;
  nsId?: string;
  taskId?: string;
  note?: string;
}

/** 面包屑一段。 */
export interface VscSegment {
  kind: 'ns' | 'owner' | 'task';
  label: string;
  siblings: VscSibling[];
}


/** vscTrailOf 的返回面（组件渲染 + 复制寻址都要用）。 */
export interface VscTrail {
  segments: VscSegment[];
  topicKey: string;
  dirName: string;
  cwd: string;
  /** '' = 草稿（还没有任务号） */
  taskId: string;
  /** 组锚定路由的看板 id（#/group/<id>?task= 深链保持锚定） */
  boardId: string;
  isGroup: boolean;
}

const DRAFT_RE = /^draft/i;

/** 任务下拉里的状态后缀（pending 是默认态，不加后缀）。 */
function statusNote(t: LocalTask): string {
  if (t.status === 'done') return '（已完成）';
  if (t.status === 'claimed') return '（已领取）';
  if (t.status === 'plan') return '（草稿）';
  return '';
}

const STATUS_ORDER: Record<string, number> = { pending: 0, plan: 1, claimed: 2, done: 3 };

/** 同队列任务排序：状态序（pending 最前），done 内按完成时间倒序。 */
function sortTasks(list: LocalTask[]): LocalTask[] {
  return [...list].sort((a, b) => {
    const d = (STATUS_ORDER[String(a.status)] ?? 9) - (STATUS_ORDER[String(b.status)] ?? 9);
    if (d !== 0) return d;
    if (a.status === 'done' && b.status === 'done') {
      return String(b.doneAt || '').localeCompare(String(a.doneAt || ''));
    }
    return 0;
  });
}

/** ns items → 可打开目录队列（board 成员展开 + 仓库直挂；按 topicKey 去重，保持 items 序）。 */
export function nsDirsOf(ns: { items?: string[] } | null | undefined, rows: LocalTopic[], boards: BoardRow[]): LocalTopic[] {
  const topicByRepoKey = new Map<string, LocalTopic>();
  for (const t of rows || []) {
    const k = t && t.repo && t.repo.key ? String(t.repo.key) : '';
    if (k && !topicByRepoKey.has(k)) topicByRepoKey.set(k, t);
  }
  const out: LocalTopic[] = [];
  const seen = new Set<string>();
  const push = (t: LocalTopic | undefined) => {
    if (!t || !t.key || seen.has(t.key)) return;
    seen.add(t.key);
    out.push(t);
  };
  for (const k of (ns && Array.isArray(ns.items) ? ns.items : [])) {
    if (k.startsWith('board:')) {
      const b = boards.find((x) => x && x.id === k.slice(6));
      for (const m of (b && Array.isArray(b.repos) ? b.repos : []) as Array<{ key?: string }>) {
        if (m && m.key) push(topicByRepoKey.get(String(m.key)));
      }
    } else {
      push(topicByRepoKey.get(k));
    }
  }
  return out;
}

/** 未分组队列 = 不落在任何 ns item 里的队列（nsDirsOf 的补集）。 */
function ungroupedDirs(rows: LocalTopic[], boards: BoardRow[], nsList: Array<{ items?: string[] }>): LocalTopic[] {
  const claimed = new Set<string>();
  for (const ns of nsList) {
    for (const t of nsDirsOf(ns, rows, boards)) claimed.add(t.key);
  }
  return (rows || []).filter((t) => t && t.key && !claimed.has(t.key));
}

/** 命名空间 → 落点路由：首个看板成员 → 组页；否则首个有队列的仓库 → 目录页；'' = 没有可落的。 */
export function nsFirstTargetOf(ns: { items?: string[] } | null | undefined, rows: LocalTopic[], boards: BoardRow[]): string {
  for (const t of nsDirsOf(ns, rows, boards)) {
    const b = t.repo && Array.isArray(t.repo.boards) ? t.repo.boards[0] : null;
    if (b && b.id && boards.some((x) => x && x.id === b.id)) {
      return '#/group/' + encodeURIComponent(String(b.id));
    }
    return '#/dir/' + encodeURIComponent(String(t.key));
  }
  return '';
}

/**
 * 路由 → VS Code 式三段面包屑（含每段同级清单）。
 * 非任务路由（无队列可锚定）返回 null——那些页面继续用旧 RouteBreadcrumb。
 */
export function vscTrailOf(
  route: Partial<AppRoute> | null | undefined,
  rows: LocalTopic[] = [],
  repoData: Partial<RepoData> = {},
  prefs: Partial<Prefs> = {}
): VscTrail | null {
  if (!route || !route.view) return null;
  const isGroup = route.view === 'group';
  const isDir = route.view === 'dir';
  if (!isGroup && !isDir) return null;

  const boards = repoData.boards || [];
  const nsList: Array<{ id: string; name?: string; items?: string[] }> = Array.isArray(prefs.namespaces)
    ? prefs.namespaces
    : [];

  // 定位当前队列 / 看板 / 任务（组锚定路由走 findGroupTask 同一套寻址）
  let topic: LocalTopic | null | undefined = null;
  let board: BoardRow | null = null;
  let taskRow: LocalTask | null = null;
  if (isGroup) {
    const g = findGroupTaskBridge(rows, boards, route.key, route.task == null ? '' : route.task) || {};
    board = g.board || null;
    topic = g.topic || null;
    taskRow = g.taskRow || null;
  } else {
    topic = (rows || []).find((r) => r && r.key === route.key) || null;
    if (topic && route.task && !DRAFT_RE.test(String(route.task))) {
      taskRow = (topic.tasks || []).find((t) => t && String(t.id) === String(route.task)) || null;
    }
    const rb = (topic && topic.repo && Array.isArray(topic.repo.boards) ? topic.repo.boards : []) as Array<{ id?: string }>;
    if (rb.length && rb[0] && rb[0].id) {
      board = boards.find((b) => b && b.id === rb[0]!.id) || null;
    }
  }
  if (!topic || !topic.key) return null; // 没有队列就没有路径可画（NotFound 页自己有提示）

  const repoKey = topic.repo && topic.repo.key ? String(topic.repo.key) : '';
  const isDraft = !route.task || DRAFT_RE.test(String(route.task));
  const taskId = isDraft ? '' : String(route.task);

  // 命名空间：items 命中 repoKey 或 'board:<boardId>'
  const inNs = (ns: { items?: string[] }): boolean => {
    const items = Array.isArray(ns.items) ? ns.items : [];
    return items.includes(repoKey) || (!!board && items.includes('board:' + String(board.id)));
  };
  const ns = nsList.find(inNs) || null;

  // ── 段 1：命名空间（下拉 = 其余 ns，点击先切侧栏再落成员页）──
  const nsSiblings: VscSibling[] = nsList
    .filter((n) => !ns || n.id !== ns.id)
    .map((n) => ({ label: String(n.name || n.id), hash: '', nsId: n.id }));

  // ── 段 2：组（无看板归属 = 目录本身）；下拉 = 同命名空间的其余目录 ──
  const dirs = ns ? nsDirsOf(ns, rows, boards) : ungroupedDirs(rows, boards, nsList);
  const ownerSiblings: VscSibling[] = dirs
    .filter((t) => t.key !== topic!.key)
    .map((t) => ({ label: String(t.name || t.key), hash: '#/dir/' + encodeURIComponent(String(t.key)) }));

  // ── 段 3：任务；下拉 = 同队列其余任务 ──
  const taskSiblings: VscSibling[] = [];
  if (route.task) {
    const anchor = isGroup && board ? '#/group/' + encodeURIComponent(String(board.id)) : '#/dir/' + encodeURIComponent(String(topic.key));
    const list = sortTasks(((topic.tasks || []) as LocalTask[]).filter(
      (t) => t && !t.deletedAt && !t.migratedTo && String(t.id) !== taskId
    ));
    for (const t of list.slice(0, 40)) {
      taskSiblings.push({
        label: '#' + String(t.id) + statusNote(t),
        hash: anchor + '?task=' + encodeURIComponent(String(t.id)),
        taskId: String(t.id),
      });
    }
  }

  const segments: VscSegment[] = [
    { kind: 'ns', label: ns ? String(ns.name || ns.id) : '未分组', siblings: nsSiblings },
    { kind: 'owner', label: board ? String(board.name) : String(topic.name || topic.key), siblings: ownerSiblings },
  ];
  if (route.task) {
    const label = isDraft ? 'draft' : '#' + (taskRow ? String(taskRow.id) : taskId);
    segments.push({ kind: 'task', label, siblings: taskSiblings });
  }

  return {
    segments,
    topicKey: String(topic.key),
    dirName: String(topic.name || topic.key),
    cwd: String(topic.cwd || ''),
    taskId,
    boardId: board ? String(board.id) : '',
    isGroup,
  };
}

/** 单个任务的复制载荷（#261：下拉任务条目 hover 复制用；draft 无任务号退回原始路径）。 */
export function taskCopyPayload(cwd: string, dirName: string, taskId: string, style: 'raw' | 'prompt' | undefined): string {
  const base = cwd || dirName;
  if (!taskId) return base + ' (draft)';
  if (style !== 'prompt') return base + ' #' + taskId;
  return [
    `任务 #${taskId} 在队列「${dirName}」（cwd：${base}）`,
    `查看：nx-kv localtask show --id ${taskId} --cwd "${base}" --json`,
    `领取处理：nx-kv localtask get --cwd "${base}" --json`,
  ].join('\n');
}

/** 复制内容（#254 偏好两态）——当前任务即 trail 上的 taskCopyPayload。 */
export function copyPayloadOf(trail: VscTrail, style: 'raw' | 'prompt' | undefined): string {
  return taskCopyPayload(trail.cwd, trail.dirName, trail.taskId, style);
}
