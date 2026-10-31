// 文档状态（会话内存）：工作区里每个 MD **页签**对应一份文档。
//
// 面板化之后，**页签归 FlexLayout 管**（开哪几页、拖到哪、浮出与否都在布局模型里），
// 这里只管「文档内容」——标题 / 正文 / 附件 / 视图模式。
// 面板关掉再打开，内容还在（会话内）；刷新即空（草稿本就只在会话有效）。
import { useSyncExternalStore } from 'react';
import { GLOBAL_KEY } from '../../../../modules/localtask/board.js';

let draftSeq = 0; // 会话内自增：draft-1 / draft-2 …（URL 可复现同一草稿页签）
let s = { docs: {} };
const listeners = new Set();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => s;

/** 目录作用域：全局池用 GLOBAL_KEY */
export const scopeOf = (dirKey) => (dirKey || GLOBAL_KEY);

/** 文档身份：作用域 + 任务号（草稿号也算） */
export const docIdOf = (scope, task) => `${scope}::${task}`;

/** 草稿页签：task 以 draft 开头 */
export const isDraftTask = (task) => /^draft/.test(String(task || ''));

/** 新草稿号（会话内唯一） */
export const nextDraftId = () => `draft-${++draftSeq}`;

/** 订阅全部文档（组件按 id 取自己那份） */
export function useDocs() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 取文档；没有就按 seed 建一份（首次打开某页时用服务端正文做种） */
export function getDoc(id, seed) {
  if (!s.docs[id]) {
    s = { ...s, docs: { ...s.docs, [id]: { title: '', body: '', attachments: [], mode: 'split', ...(seed || {}) } } };
    emit();
  }
  return s.docs[id];
}

/** 写回文档 */
export function saveDoc(id, patch) {
  const prev = s.docs[id] || { title: '', body: '', attachments: [], mode: 'split' };
  s = { ...s, docs: { ...s.docs, [id]: { ...prev, ...patch } } };
  emit();
}

/** 丢弃文档（面板关掉时可选；现在保留——重新打开还在） */
export function dropDoc(id) {
  if (!s.docs[id]) return;
  const docs = { ...s.docs };
  delete docs[id];
  s = { ...s, docs };
  emit();
}

/** 草稿转正：文档换身份（提交成任务后，把草稿的内容搬到新任务号下） */
export function promoteDoc(fromId, toId, patch) {
  const prev = s.docs[fromId] || {};
  const docs = { ...s.docs, [toId]: { ...prev, ...(patch || {}) } };
  delete docs[fromId];
  s = { ...s, docs };
  emit();
}
