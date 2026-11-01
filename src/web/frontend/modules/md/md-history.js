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

/**
 * @param {Map<string, {past: Array, future: Array, lastAt: number}>} store
 * @param {string} id 文档 id
 * @param {{title: string, body: string}} snap 改动前的快照
 * @param {'typing'|'op'} kind 改动类型
 */
export function pushHistory(store, id, snap, kind = 'op') {
  if (!id) return;
  const h = store.get(id) || { past: [], future: [], lastAt: 0 };
  const now = Date.now();
  const typing = kind === 'typing';
  const merge = typing && now - h.lastAt < TYPING_MERGE_MS && h.past.length > 0;
  if (merge) {
    // 合并进上一条：撤销回到这段输入开始前的状态
    h.past[h.past.length - 1] = snap;
  } else {
    h.past.push(snap);
    // 栈上限：防止长文档编辑把内存吃满
    if (h.past.length > 200) h.past.shift();
  }
  h.future = [];
  h.lastAt = typing ? now : 0; // 操作类改动后断开合并窗口
  store.set(id, h);
}

/**
 * 撤销一步。
 * @param {Map} store
 * @param {string} id
 * @param {{title: string, body: string}} current 撤销前所处的状态（重做要用）
 * @returns {{title: string, body: string}|null} 应当恢复的快照
 */
export function undoHistory(store, id, current) {
  const h = store.get(id);
  if (!h || !h.past.length) return null;
  const target = h.past.pop();
  // 重做要回到「撤销前」的状态，所以存 current 而不是 target
  h.future.unshift(current);
  if (h.future.length > 200) h.future.pop();
  h.lastAt = 0;
  return target;
}

/**
 * 重做一步。
 * @param {Map} store
 * @param {string} id
 * @param {{title: string, body: string}} current 重做前所处的状态（撤销要用）
 * @returns {{title: string, body: string}|null} 应当恢复的快照
 */
export function redoHistory(store, id, current) {
  const h = store.get(id);
  if (!h || !h.future.length) return null;
  const target = h.future.shift();
  h.past.push(current);
  h.lastAt = 0;
  return target;
}

/** 文档提交/保存后清空历史：不该再撤回到已落盘之前 */
export function clearHistory(store, id) {
  store.delete(id);
}
