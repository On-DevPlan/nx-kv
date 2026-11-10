// 清单的存储原语：四把 key、时间格式、任务模型、groupId 回落、KV 读写。
//
// ─── 时间格式（沿用既有数据的约定，不要统一）───
//   createdAt / frozenAt：Dart `toIso8601String()` 风格，本地时间无时区
//                          例 2026-08-14T19:04:56.028788
//   doneAt              ：RFC3339 带偏移
//                          例 2026-08-15T14:32:53+08:00
// 两种格式在同一份数据里并存是既成事实，改掉会破坏既有记录的可比性。
//
// ─── groupId 回落 ───
// 显式传入（--group）优先，否则用本机配置里的**当前工作空间**。
//
// 这一步刻意放在读写边界（下面两个函数）而不是每个 action 里：
// 放边界上，读与写必然用同一个 groupId；放到 action 里，一旦有人漏了一处，
// 就会出现「从 A 组读、往 B 组写」——而这类错不会报错，只会静默写错空间。
//
// 规则本体在 core/config.resolveGroupId：file 模块选后端分组与本地附件目录
// 必须用同一条规则，否则会出现「任务读 A 组、附件同步 B 组」。
import { kvGet, kvSet } from '../../core/kvapi.js';
import { loadConfig, requireAuth, normalizeGroupId, resolveGroupId } from '../../core/config.js';

export const KEY = {
  open: 'todo:open',
  done: 'todo:done',
  topics: 'todo:topics',
  freeze: 'todo:freeze',
};
export const PROMPT_PREFIX = 'todo:prompt:';
export const COLD_PREFIX = 'todo:done:cold:';

export const BUCKETS = ['open', 'done', 'freeze'];

// ─── 时间 ──────────────────────────────────────────────────────────

const pad = (n, w = 2) => String(n).padStart(w, '0');
export { pad };

/** Dart toIso8601String() 风格：本地时间、微秒精度、无时区后缀。
 *  JS 的 Date 只有毫秒精度，微秒位补 000 —— 形状与既有数据一致即可，
 *  下游从不解析这两位的实际值。 */
export function dartNow(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}000`
  );
}

/** RFC3339 带本地偏移，例 2026-08-15T14:32:53+08:00 */
export function rfc3339Now(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// ─── 任务模型 ──────────────────────────────────────────────────────

export function normalizeTask(t) {
  return {
    id: Number(t.id) || 0,
    topic: String(t.topic ?? ''),
    text: String(t.text ?? ''),
    createdAt: String(t.createdAt ?? ''),
    doneAt: String(t.doneAt ?? ''),
    note: String(t.note ?? ''),
    frozenAt: String(t.frozenAt ?? ''),
    // 来源标记：本机队列迁入的任务带 'local'（面板据此渲染「来自本机」徽标）。
    // 老数据没有该字段 → 空串，不渲染徽标。
    from: String(t.from ?? ''),
  };
}

export function parseTasks(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(normalizeTask) : [];
  } catch {
    // 快照损坏时返回空数组而不抛 —— 读侧不该因为一条脏数据整个失效
    return [];
  }
}

export function parseTopics(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String).filter((s) => s.trim()) : [];
  } catch {
    return [];
  }
}

// ─── groupId 回落 ──────────────────────────────────────────────────

export async function resolveGroup(groupId) {
  return resolveGroupId(groupId);
}

// ─── 读 ────────────────────────────────────────────────────────────

export async function readKey(key, groupId) {
  const item = await kvGet(key, await resolveGroup(groupId));
  return item ? item.value : '';
}

/** 读入全部四个 key。list/get 等只读操作走这里，一次拿齐。 */
export async function loadAll(groupId) {
  await requireAuth();
  const gid = normalizeGroupId(groupId);
  const [open, done, freeze, topics] = await Promise.all([
    readKey(KEY.open, gid),
    readKey(KEY.done, gid),
    readKey(KEY.freeze, gid),
    readKey(KEY.topics, gid),
  ]);
  return {
    open: parseTasks(open),
    done: parseTasks(done),
    freeze: parseTasks(freeze),
    topics: parseTopics(topics),
  };
}

/** 待办 + 冻结的 id 最大值 + 1（契约 1） */
export function nextTaskId(open, freeze) {
  let max = 0;
  for (const t of [...open, ...freeze]) if (t.id > max) max = t.id;
  return max + 1;
}

// ─── 写 ────────────────────────────────────────────────────────────
//
// 顺序纪律（契约 3）：**主数据先写，辅助数据后写**——由调用方（service.js
// 的变更操作）保证顺序；这里只提供原语。

export async function writeKey(key, value, groupId) {
  await kvSet({ key, value, ttl: 0, groupId: await resolveGroup(groupId) });
}

export async function writeTasks(bucketKey, tasks, groupId) {
  await writeKey(bucketKey, JSON.stringify(tasks), groupId);
}

export async function writeTopics(topics, groupId) {
  await writeKey(KEY.topics, JSON.stringify(topics), groupId);
}

// 供 groupId 默认值的统一来源（service 内多处要用）
export async function currentGroupId() {
  const cfg = await loadConfig();
  return normalizeGroupId(cfg.groupId);
}
