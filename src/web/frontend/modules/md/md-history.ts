/** MD 工作台撤销栈（文档级）。
 *
 * 为什么要自己实现：textarea 是受控组件，格式工具/斜杠命令等**程序化改写**会
 * 冲掉浏览器原生 undo 栈——实测「Ctrl+B 加粗 → Ctrl+Z」完全没反应，原生撤销
 * 只能撤销纯输入，专业编辑器该有的「撤销格式操作」缺失。
 *
 * 模型：每个文档一份 { past, future } 快照栈，存的是改动**前**的 { title, body }。
 * - 连续输入按时间窗合并成一条（一次撤销回退整段输入，接近 VS Code 手感）
 * - 操作类改动（格式/转变/缩进/列表续行）各自成条
 * - undo/redo 只移动指针，不写入新的历史
 */

// 连续输入合并窗口（毫秒）：窗口内视为同一段输入
const TYPING_MERGE_MS = 700;

/** 一份撤销快照（只存标题与正文；文档页只关心 body，故 title 可缺）。 */
export interface HistorySnapshot {
  title?: string;
  body: string;
}

/**
 * 入参形状：比 HistorySnapshot 宽松（body 可缺）。
 *
 * 文档页在加载完成前 `doc.body` 是 undefined，旧 JS 会把它原样入栈、撤销时
 * 原样回写；这里保留该行为——入栈处做一次边界断言，不做运行时归一化。
 */
export interface HistorySnapshotInput {
  title?: string | null;
  body?: string;
}

/** 一个文档的撤销栈：past / future + 上次输入时刻（合并窗口用）。 */
export interface HistoryEntry {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  lastAt: number;
}

/**
 * 撤销栈的存储面（调用方传自己的 Map）。
 *
 * 值类型用 unknown：调用方各自持有 `Map<string, 自己的快照型>`（任务页还借用
 * 了 task-utils 的 HistorySnapshot 名字，那个其实是「任务链历史」的形状）——
 * 这里只按本模块的 HistoryEntry 收窄，避免给每个调用点加桥。
 */
export type HistoryStore = Map<string, unknown>;

/**
 * @param store 撤销栈
 * @param id 文档 id
 * @param snap 改动前的快照
 * @param kind 改动类型
 */
export function pushHistory(
  store: HistoryStore,
  id: string | null | undefined,
  snap: HistorySnapshotInput,
  kind: string = 'op',
) {
  if (!id) return;
  const h: HistoryEntry = (store.get(id) as HistoryEntry | undefined) ?? { past: [], future: [], lastAt: 0 };
  const now = Date.now();
  const typing = kind === 'typing';
  const merge = typing && now - h.lastAt < TYPING_MERGE_MS && h.past.length > 0;
  if (merge) {
    // 合并窗口内**不动 past**：段首快照已经在栈顶，撤销一次回退整段输入。
    // （曾错写成用本键前置快照覆盖栈顶——段内逐键覆盖后栈顶只剩最后一个
    // 字符的前置快照，Ctrl+Z 一次只退一个字符、再按就卡死，#156 实测。）
  } else {
    // 跨模块边界断言：调用方可能传入缺失的 body，原样入栈（撤销时原样回写）
    h.past.push(snap as HistorySnapshot);
    // 栈上限：防止长文档编辑把内存吃满
    if (h.past.length > 200) h.past.shift();
  }
  h.future = [];
  h.lastAt = typing ? now : 0; // 操作类改动后断开合并窗口
  store.set(id, h);
}

/**
 * 撤销一步。
 * @param store 撤销栈
 * @param id 文档 id
 * @param current 撤销前所处的状态（重做要用）
 * @returns 应当恢复的快照
 */
export function undoHistory(
  store: HistoryStore,
  id: string | null | undefined,
  current: HistorySnapshotInput,
): HistorySnapshot | null {
  if (!id) return null;
  const h = store.get(id) as HistoryEntry | undefined;
  if (!h || !h.past.length) return null;
  const target = h.past.pop();
  // 重做要回到「撤销前」的状态，所以存 current 而不是 target
  h.future.unshift(current as HistorySnapshot);
  if (h.future.length > 200) h.future.pop();
  h.lastAt = 0;
  return target ?? null;
}

/**
 * 重做一步。
 * @param store 撤销栈
 * @param id 文档 id
 * @param current 重做前所处的状态（撤销要用）
 * @returns 应当恢复的快照
 */
export function redoHistory(
  store: HistoryStore,
  id: string | null | undefined,
  current: HistorySnapshotInput,
): HistorySnapshot | null {
  if (!id) return null;
  const h = store.get(id) as HistoryEntry | undefined;
  if (!h || !h.future.length) return null;
  const target = h.future.shift();
  h.past.push(current as HistorySnapshot);
  h.lastAt = 0;
  return target ?? null;
}

/** 文档提交/保存后清空历史：不该再撤回到已落盘之前 */
export function clearHistory(store: HistoryStore, id: string | null | undefined) {
  if (!id) return;
  store.delete(id);
}
