// 页签与文档状态（模块级单例，会话内存）：
//   - 打开过的页面 = 一个页签；docs[id] 缓存每页签的编辑态，切换页签不丢稿。
//   - 不落 localStorage：草稿本就只在当前会话有效（与旧「存草稿」行为一致），
//     页面本身随时可由 ?task=<id> 深链重新打开，刷新丢的只是页签排列。
//   - store 是编辑态的唯一来源：view 把 title/body/attachments/mode 的读写都
//     委托给 docs，路由 ?task= 只作为「同步进 store」的输入。
import { useSyncExternalStore } from 'react';
import { GLOBAL_KEY } from '../../../../modules/localtask/board.js';

let draftSeq = 0; // 会话内自增：draft-1 / draft-2 …（URL 可复现同一草稿页签）
let s = { tabs: [], activeId: null, docs: {} };
const listeners = new Set();

const emit = () => { for (const l of listeners) l(); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => s;

export const scopeOf = (dirKey) => (dirKey || GLOBAL_KEY);

/** 草稿页签：task 参数以 draft 开头（'draft' 是「新建一页」的瞬时标记） */
export const isDraftTask = (task) => /^draft/.test(String(task || ''));

export function useTabs() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 页签 → hash 路由（全局池无 dir 段） */
export function routeOfTab(tab) {
  if (!tab) return '';
  const base = tab.scope === GLOBAL_KEY ? '#/global' : `#/dir/${encodeURIComponent(tab.scope)}`;
  return `${base}?task=${encodeURIComponent(tab.task)}`;
}

function tabById(id) {
  return s.tabs.find((t) => t.id === id) || null;
}
export { tabById };

function commit(next) {
  s = next;
  emit();
}

function putTab(next, tab, doc) {
  const tabs = next.tabs.some((t) => t.id === tab.id)
    ? next.tabs.map((t) => (t.id === tab.id ? { ...t, ...tab } : t))
    : [...next.tabs, tab];
  const docs = { ...next.docs, [tab.id]: doc };
  return { tabs, docs, activeId: tab.id };
}

/** 打开（或聚焦）一页：已有页签只聚焦并保留缓存文档（轮询重放无副作用） */
export function openPage({ scope, task, title = '', body = '', attachments = [], mode = 'split' }) {
  const id = `${scope}::${task}`;
  const existed = tabById(id);
  if (existed && s.docs[id]) {
    setActive(id);
    return id;
  }
  commit(putTab(s, { id, scope, task, title }, { title, body, attachments, mode }));
  return id;
}

/** 新建一页草稿页签（每次调用都是新页签；task 缺省自增，刷新后可由 URL 复现）。
 *  显式给 task 且该页签已在 → 只聚焦不重置（文档是会话编辑态，不能被 URL 重放清掉）。 */
export function openDraft({ scope, task, title = '', body = '', attachments = [], mode = 'split' }) {
  const t = task || `draft-${++draftSeq}`;
  const id = `${scope}::${t}`;
  if (tabById(id)) {
    setActive(id);
    return id;
  }
  commit(putTab(s, { id, scope, task: t, title }, { title, body, attachments, mode }));
  return id;
}

export function setActive(id) {
  if (s.activeId === id) return;
  commit({ ...s, activeId: id });
}

/** 关闭页签；若关的是激活页签则落点邻位。返回新的激活页签（无则 null），调用方据此导航 */
export function closeTab(id) {
  const idx = s.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return tabById(s.activeId);
  const tabs = s.tabs.filter((t) => t.id !== id);
  const docs = { ...s.docs };
  delete docs[id];
  let activeId = s.activeId;
  if (activeId === id) {
    const next = tabs[Math.min(idx, tabs.length - 1)] || null;
    activeId = next ? next.id : null;
  }
  commit({ tabs, docs, activeId });
  return activeId ? tabById(activeId) : null;
}

export function docOf(id) {
  return s.docs[id] || null;
}

/** 编辑态写回（title 同步进页签标题，页签条即时跟随） */
export function saveDoc(id, patch) {
  if (!tabById(id)) return;
  const prev = s.docs[id] || { title: '', body: '', attachments: [], mode: 'split' };
  const doc = { ...prev, ...patch };
  const docs = { ...s.docs, [id]: doc };
  const tabs = typeof patch.title === 'string'
    ? s.tabs.map((t) => (t.id === id ? { ...t, title: patch.title } : t))
    : s.tabs;
  commit({ tabs, docs, activeId: s.activeId });
}

/** 草稿提交成页面：页签换身份（id/task），文档原地保留 */
export function promoteDraft(oldId, { task, title }) {
  const tab = tabById(oldId);
  if (!tab) return;
  const id = `${tab.scope}::${task}`;
  const doc = s.docs[oldId] || { title, body: '', attachments: [], mode: 'split' };
  doc.title = title;
  const tabs = s.tabs.map((t) => (t.id === oldId ? { ...t, id, task, title } : t));
  const docs = { ...s.docs };
  delete docs[oldId];
  docs[id] = doc;
  commit({
    tabs,
    docs,
    activeId: s.activeId === oldId ? id : s.activeId,
  });
}
