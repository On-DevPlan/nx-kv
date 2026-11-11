// 任务面板内部共享的形状与纯工具。
//
// types.ts 只放**跨页契约**（路由/面板/全局上下文/队列行）；这里是 MD 任务面板
// 这条链路（task.tsx 及其协作者）内部交换的会话态形状——文档、时间目标、
// 划选浮条、任务链节点。集中一处，避免 8 个文件各写一份「差不多」的接口。
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Attachment } from '../../components/md/attach-common.js';
import type { AttachAreaHandle } from '../../components/md/attach-area.jsx';
import type { EditorApi } from '../../components/md/md-panes-helpers.js';
import type { Model } from 'flexlayout-react';
import type { AppValue } from '../../app-context.jsx';
import type { BoardRow, LocalTask, LocalTopic, TemplatesApi } from '../../types.js';
import { findGroupTask as findGroupTaskRaw, sortTasksForDisplay as sortTasksForDisplayRaw } from '../../modules/board/board-view.js';
import { renderMarkdownHtml as renderMarkdownHtmlRaw } from '../../modules/md/md-parse.js';

/** 秒 → 人读（check 日志的已用/剩余）。 */
export function fmtSec(v: unknown): string {
  const s = Math.max(0, Number(v) || 0);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

/** 组锚定页解析出的成员队列 + 任务（findGroupTask 的返回面）。 */
export interface GroupResolved {
  topic?: LocalTopic | null;
  task?: LocalTask | null;
}

// ─── 兄弟模块的类型桥 ─────────────────────────────────────────────
//
// 下面几个纯函数来自尚未类型化完的模块：形参默认值（`= []`）让 TS 把它们
// 推断成 `never[]`，调用点传真实数组会被拒。这里按**实际契约**声明一次，
// 让本目录的调用点正常使用——等那些模块类型化后，桥接自动退化为恒等。

export const renderMarkdownHtml = renderMarkdownHtmlRaw as unknown as (
  src: string,
  attachments?: Attachment[],
  knownNames?: string[] | null,
) => string;

export const sortTasksForDisplay = sortTasksForDisplayRaw as unknown as (
  tasks: LocalTask[],
) => LocalTask[];

const findGroupTaskBridge = findGroupTaskRaw as unknown as (
  rows: LocalTopic[],
  boards: BoardRow[],
  groupKey: string | undefined,
  taskId: string | number,
) => GroupResolved | null;

export function findGroupTask(
  rows: LocalTopic[],
  boards: BoardRow[],
  groupKey: string | undefined,
  taskId: string | number,
): GroupResolved | null {
  return findGroupTaskBridge(rows, boards, groupKey, taskId);
}

/** 会话里的 MD 文档（doc-store 尚未类型化，形状在此收口）。 */
export interface DocState {
  title: string;
  body: string;
  attachments: Attachment[];
  mode?: string;
}

/** frontmatter：正文头部解析出来的键值（外部数据边界，按需读）。 */
export type DocFm = Record<string, any>;

/** 时间目标（可编辑态）：时长 + 附加要求。 */
export interface TimeGoal {
  duration: string;
  prompt: string;
}

/** 服务端声明的时间目标（字段可缺）。 */
export interface DeclaredGoal {
  duration?: string;
  prompt?: string;
  [k: string]: any;
}

/** 一轮 check 的日志条目（/api/localtasks/timegoal-log）。 */
export interface GoalLogEntry {
  checkedAt?: string;
  reached?: boolean;
  elapsedSec?: number;
  remainingSec?: number;
  summary?: string;
  progress?: string;
}

/** 时间目标日志（外部数据边界；entries 与 count 同来）。 */
export interface GoalLogData {
  count: number;
  entries: GoalLogEntry[];
  duration?: string;
  startedAt?: string;
  deadline?: string;
  archived?: boolean;
  [k: string]: any;
}

/** useGoal 返回的日志查询态。 */
export interface GoalLogState {
  busy: boolean;
  error: string;
  data: GoalLogData | null;
}

/** 编辑器命令面（MdPanes 已类型化，直接复用它的契约，避免第二份真相）。 */
export type { EditorApi };

/** 划选浮条状态（kind = 'format' | 'task'）。 */
export interface SelMenuState {
  kind: string;
  text: string;
  x: number;
  y: number;
  blockRange?: [number, number] | null;
  [k: string]: any;
}

/** 划选浮条的定位参数（placeSelMenu 的第 5 个参数）。 */
export type SelMenuExtra = Record<string, any>;

/** 评论任务的原文锚点。 */
export interface ParentRef {
  dirKey: string;
  task: string;
  name: string;
}

/** 工作组成员（归属项目下拉的选项）。 */
export interface BoardMember {
  key: string;
  name: string;
}

/** 工作组语义：本组 + 成员项目。 */
export interface BoardCtx {
  board: BoardRow;
  members: BoardMember[];
}

/** 任务链节点（渲染用；history 快照与 fork 祖先/子任务同一形状）。 */
export interface ChainNode {
  historyId: number | string | null;
  kind?: string;
  at?: string;
  excerpt: string;
  feedback?: string;
  quote?: string;
  attachmentCount: number;
  current: boolean;
  taskId?: number | string;
  dirKey?: string;
}

/** /api/localtasks/chain 的一个祖先/子任务（外部数据边界）。 */
export interface ChainApiItem {
  id: number | string;
  key?: string;
  missing?: boolean;
  forkKind?: string;
  createdAt?: string;
  excerpt?: string;
  [k: string]: any;
}

/** /api/localtasks/chain 的出站形状。 */
export interface ChainApi {
  ancestors?: ChainApiItem[];
  children?: ChainApiItem[];
}

/** 一条 history 快照（taskRow.history[] 的元素）。 */
export interface HistorySnapshot {
  id: number | string;
  kind?: string;
  at?: string;
  text?: string;
  attachments?: Attachment[];
  quote?: string;
  feedback?: string;
  excerpt?: string;
  summary?: string;
  [k: string]: any;
}

/** 预览面板的外部状态（一次预览请求的三种态）。 */
export interface PreviewState {
  busy?: boolean;
  error?: string;
  data?: {
    rendered?: string;
    segments?: Array<{ label?: string; text?: string }>;
    switches?: Record<string, any>;
    getLoop?: { enabled?: boolean; waitMinutes?: number };
    task?: { id?: number | string };
    [k: string]: any;
  } | null;
}

/** dialog() 的入参（popup 原语，字段按调用处出现）。 */
export interface DialogOptions {
  title?: string;
  message?: string;
  input?: boolean;
  placeholder?: string;
  value?: string;
  danger?: boolean;
  okText?: string;
  [k: string]: any;
}

export type DialogFn = (opts: DialogOptions) => Promise<unknown>;

/** 失败即 toast 的异步守卫。 */
export type Guard = (fn: () => Promise<unknown>) => Promise<unknown>;

/** 任务面板链路共享的全局面。 */
export type AppSlice = Partial<AppValue>;

/** 任务面板链路共享的会话参数（task.tsx 解析出来的那批）。 */
export interface TaskCtx {
  id: string;
  isDraft: boolean;
  task: string;
  taskRow: LocalTask | null;
  topicKey: string;
  topic: LocalTopic | null;
  isGlobal: boolean;
  groupAnchored: boolean;
  groupId?: string;
  dirKey?: string;
  doc: DocState | null;
  docFm: DocFm;
  boardCtx: BoardCtx | null;
  rows: LocalTopic[];
  app: AppSlice;
  model: Model | null;
  tabId?: string;
  tpl?: TemplatesApi;
  refreshLocal?: () => Promise<void>;
  markDirty: () => void;
  setDirty: Dispatch<SetStateAction<boolean>>;
  guard: Guard;
  dialog: DialogFn;
  showDockTab: (tab: string) => void;
  histRef: RefObject<Map<string, HistorySnapshot>>;
  editorApiRef: RefObject<EditorApi | null>;
  attachAreaRef: RefObject<AttachAreaHandle | null>;
}
