// 时间解析与格式化（库里一律 epoch ms，UTC 语义）。
//
// **三种精度必须分开命名，不得互替** —— 这是迁移里最容易静默出错的一处：
//
//   localtasks.json / timegoals.json → "YYYY-MM-DD HH:mm:ss"（**本地时区**字符串）
//                                      → parseStampMs（本地构造）
//   repos.json                       → "2026-11-04T02:46:56.431Z"（UTC ISO）
//                                      → parseIsoMs（Date.parse）
//   数字                             → epoch ms，直接用
//
// 用 `new Date("2026-11-04 02:46:56")` 解析本地串的后果：V8 在多数平台上把
// 「不带时区的日期时间」当**本地**，但在部分形态（带 T、带毫秒）下又会按 UTC 解释，
// 于是整体偏 8 小时 —— 表现是「时间不对」而不是报错，最难查。

const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

const pad = (n: number, w: number = 2): string => String(n).padStart(w, '0');

/** 当前时刻（epoch ms）。测试可打桩这个函数，别去打桩 Date.now。 */
export function nowMs(): number {
  return Date.now();
}

/**
 * `"YYYY-MM-DD HH:mm:ss"`（**本地时区**）→ epoch ms。
 *
 * 本地构造（`new Date(y, m-1, d, h, mi, s)`），**不用** `Date.parse`。
 * 无法解析返回 `NaN`（调用方自己决定回落策略）。
 *
 * @param {string} s
 * @returns {number} epoch ms 或 NaN
 */
export function parseStampMs(s: unknown): number {
  const m = STAMP_RE.exec(String(s ?? '').trim());
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}

/**
 * UTC ISO 串（`"2026-11-04T02:46:56.431Z"`）→ epoch ms。无法解析返回 NaN。
 * @param {string} s
 * @returns {number}
 */
export function parseIsoMs(s: unknown): number {
  const raw = String(s ?? '').trim();
  if (!raw) return NaN;
  return Date.parse(raw);
}

/**
 * epoch ms → `"YYYY-MM-DD HH:mm:ss"`（本地时区）。仅用于人读输出与日志。
 * @param {number} ms
 * @returns {string}
 */
export function msToStamp(ms: number): string {
  const d = new Date(Number(ms) || 0);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * epoch ms → 定宽文件标签 `"YYYYMMDD-HHmmss"`（本地时区，字典序即时间序）。
 * 备份文件名 / 迁移日志用它。
 * @param {number} [ms]
 * @returns {string}
 */
export function stampFileTag(ms: number = Date.now()): string {
  const d = new Date(Number(ms) || 0);
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/**
 * 把「可能是本地串 / ISO 串 / 数字」的时间归一成 ms，解析不出来返回 `fallback`。
 *
 * 迁移专用：legacy JSON 里同一件事有三种写法（多数是本地串，repos 是 ISO，
 * 等待截止是数字），逐字段判断写法比逐字段判断精度更可靠。
 *
 * @param {unknown} v
 * @param {number} [fallback]
 * @returns {number}
 */
export function anyTimeMs(v: unknown, fallback?: number): number;
export function anyTimeMs(v: unknown, fallback: null): number | null;
export function anyTimeMs(v: unknown, fallback: number | null = NaN): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v ?? '').trim();
  if (!s) return fallback;
  const local = parseStampMs(s);
  if (!Number.isNaN(local)) return local;
  const iso = parseIsoMs(s);
  if (!Number.isNaN(iso)) return iso;
  return fallback;
}
