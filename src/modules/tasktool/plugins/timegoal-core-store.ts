// timegoal 纯函数核——常量、时长解析、时间戳格式、纯函数时间运算（不碰 db、不读时钟）。
//
// 抽成独立文件的理由：evalTimegoal / parseDuration 是纯函数，单测直接钉边界；
// 队列级（timegoal-cwd-store.js）与任务级（timegoal-task-store.js）共用同一份运算，
// 两套作用域的状态机不会因为各写一份而漂移。
import { basename, resolve } from 'node:path';
import { badInput } from '../../../core/errors.js';
import { topicKeyOf } from '../../../core/topic-key.js';
import { msToStamp, parseStampMs } from '../../../core/db/time.js';

export const MIN_DURATION_SEC = 60; // 最小 1 分钟（避免误设 0 立即到点）
// 上限从「24 小时」放宽到「365 天」。真实场景里"跑一晚上""连续优化几天"是常态，
// 24 小时上限逼着用户去改代码而不是改配置——这正是"从真实角度"最刺手的一处。
export const MAX_DURATION_SEC = 365 * 24 * 3600; // 365 天
export const MAX_PROMPT = 20_000; // prompt 长度上限（与 localtask MAX_TEXT 同档）
export const ARCHIVE_RETENTION_SEC = 7 * 24 * 3600; // 到点自动归档后保留多久再丢弃日志

// 保留期可用环境变量覆盖（NX_KV_TIMEGOAL_RETENTION_SEC）。
// 默认 7 天：按"消费方轮询间隔 × 安全系数"取——agent 每轮 check 一次，
// 7 天意味着机器关机一周回来仍能读到提示词原文。
export function archiveRetentionSec(): number {
  const raw = process.env.NX_KV_TIMEGOAL_RETENTION_SEC;
  if (raw === undefined || raw === null || String(raw).trim() === '') return ARCHIVE_RETENTION_SEC;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return ARCHIVE_RETENTION_SEC;
  return Math.floor(n);
}

// ─── 时间字符串工具（与 localtask 对齐的格式）─────────────────────────

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
export function stampNow(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export const stampOf = (ms: unknown): string => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? msToStamp(Number(ms)) : '');

// ─── cwd → 主题 key（T03 起与 localtask 同一派生：topicKeyOf(完整 cwd)）─────
//
// 必须同源：任务级目标的 scope 是 `task:<topicKey>:<id>`，topicKey 来自
// localtask 的 normalizeCwd —— 两边派生不同，任务级目标就全部失联。
// key 纯函数下沉在 core/topic-key.js（core 层，两边都能 import）。

export function topicKeyFor(cwdOrName: unknown): string {
  return topicKeyOf(String(cwdOrName ?? ''), '');
}

// 归一化工作目录：trim → resolve → 用完整 cwd 做 key。
export function normalizeCwd(raw: unknown): { cwd: string; name: string; key: string } {
  const trimmed = raw && String(raw).trim() ? String(raw).trim() : '';
  const cwd = trimmed ? resolve(trimmed) : process.cwd();
  const name = basename(cwd);
  return { cwd, name, key: topicKeyOf(cwd, '') };
}

// ─── 时长解析：纯秒数 或 人类单位（5h / 90m / 2d / 5小时）──────────────
//
// 「5 小时」是用户脑子里真实的说法；逼他换算成 18000 秒是本末倒置。
// 纯数字仍然按秒解释（向后兼容：--duration 10800 照旧工作）。
const DURATION_UNITS: Record<string, number> = {
  ms: 0.001, 毫秒: 0.001,
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1, 秒: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60, 分钟: 60, 分: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, 小时: 3600, 时: 3600,
  d: 86400, day: 86400, days: 86400, 天: 86400,
};
export const DURATION_UNIT_HINT = '10800（秒）/ 5h / 90m / 2d / 5小时';

/**
 * 把用户写的时长解析成整数秒。
 * 纯数字 → 秒；带单位 → 单位换算；其它 → 报错（绝不猜）。
 */
export function parseDuration(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    throw badInput(`需要 --duration <时长>（${DURATION_UNIT_HINT}）`);
  }
  if (typeof raw === 'number') return clampDuration(raw);
  const s = String(raw).trim().toLowerCase();
  if (!s) throw badInput(`需要 --duration <时长>（${DURATION_UNIT_HINT}）`);
  // 纯数字 → 秒
  if (/^\d+(\.\d+)?$/.test(s)) return clampDuration(Math.floor(Number(s)));
  const m = /^(\d+(?:\.\d+)?)\s*(.+)$/.exec(s);
  if (!m) throw badInput(`无法解析时长「${raw}」——请用 ${DURATION_UNIT_HINT}`);
  const unit = (m?.[2] ?? '').trim();
  const mult = DURATION_UNITS[unit];
  if (!mult) throw badInput(`无法识别的时长单位「${unit}」——请用 ${DURATION_UNIT_HINT}`);
  return clampDuration(Math.floor(Number(m?.[1]) * mult));
}

export function clampDuration(n: unknown): number {
  if (!Number.isFinite(n)) {
    throw badInput(`--duration 必须是整数秒或带单位（${DURATION_UNIT_HINT}），收到: ${n}`);
  }
  const i = Math.floor(Number(n));
  if (i < MIN_DURATION_SEC) {
    throw badInput(`--duration 至少 ${MIN_DURATION_SEC} 秒（避免手滑设 0 立即到点）`);
  }
  if (i > MAX_DURATION_SEC) {
    throw badInput(`--duration 超过上限 ${MAX_DURATION_SEC} 秒（365 天）`);
  }
  return i;
}

export function normalizePrompt(raw: unknown): string {
  const body = String(raw ?? '').trim();
  if (!body) throw badInput('--prompt 不能为空');
  if (body.length > MAX_PROMPT) {
    throw badInput(`--prompt 过长（≤${MAX_PROMPT} 字，当前 ${body.length} 字）`);
  }
  return body;
}

export function normalizeLogField(raw: unknown, flag: unknown, maxLength: number): string {
  const value = String(raw ?? '').trim();
  if (!value) throw badInput(`--${flag} 不能为空（每次 check 都会写入 timegoal 日志）`);
  if (value.length > maxLength) {
    throw badInput(`--${flag} 过长（≤${maxLength} 字，当前 ${value.length} 字）`);
  }
  return value;
}

// ─── 纯函数：给定 goal 与 nowMs，算 reached / elapsed / remaining ────────
// 抽出来便于单测钉边界（不依赖系统时钟）。

/** evalTimegoal 的返回（时间运算四元组 + hasGoal） */
export interface GoalEval {
  hasGoal: boolean;
  reached: boolean;
  elapsedSec: number;
  remainingSec: number;
  overtimeSec: number;
}

export function evalTimegoal(goal: any, nowMsArg: number): GoalEval {
  if (!goal) {
    return { hasGoal: false, reached: false, elapsedSec: 0, remainingSec: 0, overtimeSec: 0 };
  }
  const startMs = parseStampMs(goal.startedAt);
  const deadlineMs = parseStampMs(goal.deadline);
  if (!Number.isFinite(startMs) || !Number.isFinite(deadlineMs)) {
    // 数据损坏：start/deadline 必须能解析；保守地算到点（避免 agent 误认为没到）
    return { hasGoal: true, reached: true, elapsedSec: 0, remainingSec: 0, overtimeSec: 0 };
  }
  const elapsedSec = Math.max(0, Math.floor((nowMsArg - startMs) / 1000));
  const remainingSec = Math.max(0, Math.ceil((deadlineMs - nowMsArg) / 1000));
  const reached = nowMsArg >= deadlineMs;
  // 超时多久：到点之后这个数继续涨——「已到点」不再是一个静止的标签，
  // 而是"已经超时 2 小时 13 分"这样能看出严重程度的量。
  const overtimeSec = reached ? Math.max(0, Math.floor((nowMsArg - deadlineMs) / 1000)) : 0;
  return { hasGoal: true, reached, elapsedSec, remainingSec, overtimeSec };
}

export function durationLabel(sec: unknown): string {
  const s = Math.max(0, Number(sec) || 0);
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600}h`;
  if (s >= 60 && s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}
