// store 读写层的**保留部分**：输入校验与时间工具。
//
// T03 之后这里不再有 JSON 读写：`localtasks.json` 的 load/save 全部下线，
// 写入走 repo/ 的窄方法（每个方法一个事务），读取走 repo/topics.js 的 JSON 形态投影。
// 保留这个文件的原因很实际：约 30 个调用点只 import 这里的常量与校验函数
// （normalizeSummary / normalizeText / stampNow / clampTimeoutSec / parseStampMs），
// 这些与存储无关。
//
// ⚠️ 删除清单（T03 已删，勿复活）：
//   loadStore() / saveStore(data) / topicOf(store,...) / nextTaskId(tasks)
//   —— 任何「读全表到内存 → 改 → 整表重写」的写法都被禁止：那会把 SQLite 的
//   行级守卫（claim 的 WHERE status='pending'）退化成「最后写入者赢」。
import { badInput } from '../../core/errors.js';

export const DEFAULT_TIMEOUT_MS = 180_000; // 阻塞默认 3 分钟（推荐值）
export const DEFAULT_TIMEOUT_SEC = 180; // 推荐阻塞时长（3 分钟）
export const MAX_TIMEOUT_SEC = 600; // 阻塞时长上限（10 分钟）
export const MAX_SUMMARY = 2000; // 现状（状态）长度上限（原 200，已放宽）
export const MAX_TEXT = 20_000; // 单条任务内容长度上限

/** normalizeSummary 的选项。 */
export interface NormalizeSummaryOptions {
  optional?: boolean;
}

// ─── 现状（状态文本） ──────────────────────────────────────────────

// 归一化：折叠所有连续空白为单空格、去首尾。wait 必填；add 可选（仅刷新状态）。
export function normalizeSummary(raw: unknown, { optional = false }: NormalizeSummaryOptions = {}): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) {
    if (optional) return '';
    throw badInput('缺少 --summary "<当前现状总结>"（agent 当前状态，展示给用户）');
  }
  if (s.length > MAX_SUMMARY) {
    throw badInput(`--summary 过长（≤${MAX_SUMMARY} 字，当前 ${s.length} 字）`);
  }
  return s;
}

// 任务正文：必填、限长
export function normalizeText(raw: unknown): string {
  const body = String(raw ?? '').trim();
  if (!body) throw badInput('任务内容不能为空');
  if (body.length > MAX_TEXT) {
    throw badInput(`任务内容过长（≤${MAX_TEXT} 字，当前 ${body.length} 字）`);
  }
  return body;
}

// ─── 时间 ───────────────────────────────────────────────────────────

const pad = (n: number, w: number = 2): string => String(n).padStart(w, '0');

export function stampNow(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// "YYYY-MM-DD HH:mm:ss"（本地）→ epoch ms；无法解析返回 NaN
export function parseStampMs(s: unknown): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return NaN;
  // 正则六个捕获组与上面模式一一对应，匹配成功必然全存在
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!).getTime();
}

// 归一化超时秒数：非法/缺省 → 推荐值；超上限截断为 10 分钟
export function clampTimeoutSec(sec: unknown): number {
  let n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) n = DEFAULT_TIMEOUT_SEC;
  n = Math.floor(n);
  if (n > MAX_TIMEOUT_SEC) n = MAX_TIMEOUT_SEC;
  return n;
}
