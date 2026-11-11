// 文档状态（会话内存）：工作区里每个 MD **页签**对应一份文档。
//
// 面板化之后，**页签归 FlexLayout 管**（开哪几页、拖到哪、浮出与否都在布局模型里），
// 这里只管「文档内容」——标题 / 正文 / 附件 / 视图模式。
// 面板关掉再打开，内容还在（会话内）；刷新即空（草稿本就只在会话有效）。
import { useSyncExternalStore } from 'react';
import { GLOBAL_KEY } from '../board/board-view.js';
import type { Attachment } from '../../components/md/attach-common.js';

/**
 * 会话里的一份文档（doc-store 的唯一数据形状）。
 *
 * 附件沿用 components/md/attach-common 的 Attachment（type-only import，
 * 编译期擦除，不会把组件层带进模块层）。
 */
export interface DocRecord {
  title: string;
  body: string;
  attachments: Attachment[];
  mode?: string;
}

/** 内部状态：docId → 文档（对外只透出 docs，不透出包装）。 */
interface DocStoreState {
  docs: Record<string, DocRecord>;
}

let draftSeq = 0; // 会话内自增：draft-1 / draft-2 …（URL 可复现同一草稿页签）
let s: DocStoreState = { docs: {} };
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/**
 * 对外快照 = **扁平的 docId → doc 映射**。
 *
 * 千万不要把内部的包装对象 `{ docs: {...} }` 透出去：调用方（page-panel）按
 * `docs[docId]` 取，包装一露出去就永远 undefined —— 表现为任务详细页永久停在
 * 「载入中…」，且没有任何报错（历史 bug，护栏见 tests/unit/doc-store.test.mjs）。
 */
export const docsSnapshot = (): Record<string, DocRecord> => s.docs;
const snapshot = docsSnapshot;

/** 目录作用域：全局池用 GLOBAL_KEY */
export const scopeOf = (dirKey?: string | null): string => (dirKey || GLOBAL_KEY);

/** 文档身份：作用域 + 任务号（草稿号也算） */
export const docIdOf = (scope: string, task: string | number): string => `${scope}::${task}`;

/** 草稿页签：task 以 draft 开头 */
export const isDraftTask = (task?: string | number | null): boolean => /^draft/.test(String(task || ''));

/** 新草稿号（会话内唯一） */
export const nextDraftId = (): string => `draft-${++draftSeq}`;

/** 订阅全部文档（组件按 id 取自己那份） */
export function useDocs(): Record<string, DocRecord> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 取文档；没有就按 seed 建一份（首次打开某页时用服务端正文做种） */
export function getDoc(id: string, seed?: Partial<DocRecord> | null): DocRecord {
  const existing = s.docs[id];
  if (existing) return existing;
  const created: DocRecord = { title: '', body: '', attachments: [], mode: 'split', ...(seed || {}) };
  s = { ...s, docs: { ...s.docs, [id]: created } };
  emit();
  return created;
}

/** 只读取文档，**不创建**——路由/页签命名这类只读场合用（getDoc 会顺手建空文档） */
export function peekDoc(id: string): DocRecord | null {
  return s.docs[id] ?? null;
}

/** 写回文档 */
export function saveDoc(id: string, patch: Partial<DocRecord>) {
  const prev: DocRecord = s.docs[id] || { title: '', body: '', attachments: [], mode: 'split' };
  s = { ...s, docs: { ...s.docs, [id]: { ...prev, ...patch } } };
  emit();
}

/** 丢弃文档（面板关掉时可选；现在保留——重新打开还在） */
export function dropDoc(id: string) {
  if (!s.docs[id]) return;
  const docs = { ...s.docs };
  delete docs[id];
  s = { ...s, docs };
  emit();
}

/** 草稿转正：文档换身份（提交成任务后，把草稿的内容搬到新任务号下） */
export function promoteDoc(fromId: string, toId: string, patch?: Partial<DocRecord> | null) {
  const prev = s.docs[fromId] || {};
  // 浅合并：调用方负责把 title/body 补齐；历史行为就是「有什么并什么」
  const merged = { ...prev, ...(patch || {}) } as DocRecord;
  const docs: Record<string, DocRecord> = { ...s.docs, [toId]: merged };
  delete docs[fromId];
  s = { ...s, docs };
  emit();
}
