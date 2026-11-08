// timegoal 模块 service —— 固化"持续运行 N 小时"任务的时间运算与全局提示词回显。
//
// 设计要点（与 localtask 严格分离）：
//   1. **存储进库（T06）**，两套作用域两个落点：
//      · **任务级** goal（`localtask add --duration` → 领取起算）→ `goals` +
//        `goal_checks` 表（task_id 外键；删任务连 goal 与流水级联消失）。
//        见 localtask/repo/goals.js。
//      · **队列级** goal（`timegoal set --cwd`）→ `settings` 表 `tg.cwd.<topicKey>`
//        一键一目标（value 是 JSON：目标字段 + checks 流水）。队列是容器、没有
//        可挂的 task_id（goals.task_id NOT NULL 是 schema 定稿），而 goal 恰是
//        「按键取值、不做关系查询」的运行时状态 —— settings 表的硬规则
//        （WHERE 里的东西不进 settings）对它恰好不构成约束。
//   2. **每 cwd 一对一**：topicKeyOf(完整 cwd) 派生，set 时已有则覆盖并标 replaced。
//   3. **不可变 prompt**：set 写进库之后，prompt 字段变成只读事实。
//      后续 `check` 永远从库原文回显，不让 agent 改 prompt 或从对话历史里
//      重新拼接——这是"避免偏移"的物理保证。
//   4. **纯函数时间运算**：`evalTimegoal(goal, nowMs)` 不读时钟，单测钉各种边界
//      （到点前/临门/到点整/过线）；`checkTimegoal` 调它前才 `Date.now()`。
//   5. **check 流水只增不改**：elapsed / remaining / overtime 存**当日快照**
//      （deadline 会被延期，查时重算会把历史改写）。行级追加没有
//      logTruncated 的概念（那是 JSON 整份重写时代的产物）——总量用 count。
//
// 模块边界：
//   - 本文件只 import core（db / errors / topic-key）与 localtask/repo/goals.js
//     （叶子仓储，不构成环）；localtask 反向引用本模块的出口在 taskgoal.js。
//   - 与 localtask wait 互不感知：timegoal 不阻塞、不依赖面板是否存在，
//     agent 按 `reached` 自行决定下一轮动作。
import { basename, resolve } from 'node:path';
import { badInput } from '../../../core/errors.js';
import { topicKeyOf } from '../../../core/topic-key.js';
import { readSettingRaw, writeSettingRaw, deleteSettingRaw, listSettingsByPrefix } from '../../../core/db/settings.js';
import { tx } from '../../../core/db/index.js';
import { db as ltDb } from '../../localtask/repo/open.js';
import { nowMs, msToStamp, parseStampMs } from '../../../core/db/time.js';
import * as goalsRepo from '../../localtask/repo/goals.js';

export const MIN_DURATION_SEC = 60; // 最小 1 分钟（避免误设 0 立即到点）
// 上限从「24 小时」放宽到「365 天」。真实场景里"跑一晚上""连续优化几天"是常态，
// 24 小时上限逼着用户去改代码而不是改配置——这正是"从真实角度"最刺手的一处。
export const MAX_DURATION_SEC = 365 * 24 * 3600; // 365 天
export const MAX_PROMPT = 20_000; // prompt 长度上限（与 localtask MAX_TEXT 同档）
export const ARCHIVE_RETENTION_SEC = 7 * 24 * 3600; // 到点自动归档后保留多久再丢弃日志

/** settings 表里队列级 goal 的键前缀。 */
const CWD_GOAL_PREFIX = 'tg.cwd.';

// 保留期可用环境变量覆盖（NX_KV_TIMEGOAL_RETENTION_SEC）。
// 默认 7 天：按"消费方轮询间隔 × 安全系数"取——agent 每轮 check 一次，
// 7 天意味着机器关机一周回来仍能读到提示词原文。
export function archiveRetentionSec() {
  const raw = process.env.NX_KV_TIMEGOAL_RETENTION_SEC;
  if (raw === undefined || raw === null || String(raw).trim() === '') return ARCHIVE_RETENTION_SEC;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return ARCHIVE_RETENTION_SEC;
  return Math.floor(n);
}

// ─── 时间字符串工具（与 localtask 对齐的格式）─────────────────────────

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function stampNow(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

const stampOf = (ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? msToStamp(Number(ms)) : '');

// ─── cwd → 主题 key（T03 起与 localtask 同一派生：topicKeyOf(完整 cwd)）─────
//
// 必须同源：任务级目标的 scope 是 `task:<topicKey>:<id>`，topicKey 来自
// localtask 的 normalizeCwd —— 两边派生不同，任务级目标就全部失联。
// key 纯函数下沉在 core/topic-key.js（core 层，两边都能 import）。

export function topicKeyFor(cwdOrName) {
  return topicKeyOf(String(cwdOrName ?? ''), '');
}

// 归一化工作目录：trim → resolve → 用完整 cwd 做 key。
function normalizeCwd(raw) {
  const trimmed = raw && String(raw).trim() ? String(raw).trim() : '';
  const cwd = trimmed ? resolve(trimmed) : process.cwd();
  const name = basename(cwd);
  return { cwd, name, key: topicKeyOf(cwd, '') };
}

// ─── 输入校验 ──────────────────────────────────────────────────────────

// ─── 时长解析：纯秒数 或 人类单位（5h / 90m / 2d / 5小时）──────────────
//
// 「5 小时」是用户脑子里真实的说法；逼他换算成 18000 秒是本末倒置。
// 纯数字仍然按秒解释（向后兼容：--duration 10800 照旧工作）。
const DURATION_UNITS = {
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
export function parseDuration(raw) {
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
  const unit = m[2].trim();
  const mult = DURATION_UNITS[unit];
  if (!mult) throw badInput(`无法识别的时长单位「${unit}」——请用 ${DURATION_UNIT_HINT}`);
  return clampDuration(Math.floor(Number(m[1]) * mult));
}

function clampDuration(n) {
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

function normalizePrompt(raw) {
  const body = String(raw ?? '').trim();
  if (!body) throw badInput('--prompt 不能为空');
  if (body.length > MAX_PROMPT) {
    throw badInput(`--prompt 过长（≤${MAX_PROMPT} 字，当前 ${body.length} 字）`);
  }
  return body;
}

// ─── 纯函数：给定 goal 与 nowMs，算 reached / elapsed / remaining ────────
// 抽出来便于单测钉边界（不依赖系统时钟）。
export function evalTimegoal(goal, nowMsArg) {
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

// ─── 视图（与 JSON 时代同形状；logTruncated 已随 JSON store 一起消失）────

function blobToGoal(blob) {
  if (!blob || typeof blob !== 'object') return null;
  return {
    key: String(blob.key || ''),
    cwd: String(blob.cwd || ''),
    name: String(blob.name || ''),
    durationSec: Number(blob.durationSec) || 0,
    prompt: String(blob.prompt || ''),
    startedAt: stampOf(blob.startedAtMs),
    deadline: stampOf(blob.deadlineMs),
    archived: !!blob.archived,
    archivedAt: stampOf(blob.archivedAtMs),
    purged: false,
    purgedAt: '',
    totalChecks: Number(blob.totalChecks) || 0,
  };
}

function blobToGoalView(blob, { withPrompt = true } = {}) {
  const g = blobToGoal(blob);
  if (!g) return null;
  const checks = Array.isArray(blob.checks) ? blob.checks : [];
  const view = {
    ...g,
    logCount: checks.length,
    totalChecks: Number(blob.totalChecks) || checks.length,
  };
  if (withPrompt) {
    view.prompt = g.prompt;
  } else {
    // 列表不吐完整 prompt：归档区 N 个目标就是 N×20KB，面板每 1.5s 拉一次会白烧带宽。
    // 只给一小段预览；要看全文用 timegoal show（按 cwd 取单个目标）。
    delete view.prompt;
    view.promptPreview = g.prompt.length > 120 ? g.prompt.slice(0, 120) + '…' : g.prompt;
  }
  return view;
}

// goal_checks 行的 progress 与 summary 合存在同一列（JSON 编码，见 goals.js），
// 不再需要独立的行→条目映射器 —— 队列级走 blob、任务级走 applyGoalCheck。

// ─── 队列级 goal（settings 表 blob）的读写 ──────────────────────────────

const cwdGoalKeyOf = (topicKey) => CWD_GOAL_PREFIX + String(topicKey || '');

function readCwdGoal(conn, topicKey) {
  const blob = readSettingRaw(conn, cwdGoalKeyOf(topicKey));
  return blob && typeof blob === 'object' ? blob : null;
}

function writeCwdGoal(conn, blob, atMs) {
  writeSettingRaw(conn, cwdGoalKeyOf(blob.key), blob, atMs);
}

/** 到点归档 + 超期自动失效（写路径才落库；读路径只推导不写）。 */
function autoRecycleCwdBlob(blob, atNow) {
  let changed = false;
  const retentionMs = archiveRetentionSec() * 1000;
  const deadlineMs = Number(blob.deadlineMs);
  if (!blob.archived && Number.isFinite(deadlineMs) && atNow >= deadlineMs) {
    blob.archived = true;
    blob.archivedAtMs = blob.archivedAtMs || atNow;
    changed = true;
  }
  if (blob.archived) {
    // 保留期从 deadline 起算（而不是从"归档那一刻"）：它是可推导的，
    // 不依赖是否有人读过这个目标。
    const base = Number.isFinite(deadlineMs) ? deadlineMs : atNow;
    if (atNow - base >= retentionMs) {
      changed = 'purge'; // 调用方负责删键
    }
  }
  return changed;
}

function withCwdGoalDb(fn) {
  return tx((conn) => fn(conn), { db: ltDb(), mode: 'IMMEDIATE' });
}

/** 只读探针共用：读 blob（不写库）；null = 没有目标或已自动失效。 */
function readLiveCwdBlob(topicKey, atNow) {
  const conn = ltDb();
  const blob = readCwdGoal(conn, topicKey);
  if (!blob) return null;
  if (autoRecycleCwdBlob(blob, atNow) === 'purge') return null; // 超期：读路径不落库，视为已消失
  return blob;
}

// ─── 只读探针 ──────────────────────────────────────────────────────────

/**
 * 只读探针：这个 key 上的时间目标**到点了吗**。
 *
 * 存在的理由：localtask 的 wait 是阻塞的，默认要等满自己的超时（最多 10 分钟）。
 * 但如果这个目录挂着时间目标，预算到点这一局就该结束了 —— agent 不该在预算外
 * 继续空等。wait 每轮轮询问一次这个探针，到点就立刻收尾（与用户点「关闭等待」
 * 同一条出口：status:"timeout" + cancelled:true）。
 *
 * 刻意**不写库、不归档**：探针是 500ms 轮询的热路径。到点归档由真正的写路径负责。
 *
 * @returns {Promise<null | {key,name,cwd,deadline,reached}>} 没有目标 → null
 */
export async function probeGoalExpiry(key) {
  if (!key) return null;
  const blob = readLiveCwdBlob(String(key), Date.now());
  if (!blob) return null;
  return {
    key: String(key),
    name: blob.name || '',
    cwd: blob.cwd || '',
    deadline: stampOf(blob.deadlineMs),
    deadlineMs: Number(blob.deadlineMs),
    reached: evalTimegoal(blobToGoal(blob), Date.now()).reached,
  };
}

// ─── 队列级 CRUD（与 localtask 思路一致但命令族更窄）────────────────────

/**
 * 设置本目录的 timegoal；已存在则覆盖并标 `replaced:true`。
 */
export async function setTimegoal({ cwd: rawCwd, durationSec: rawDur, prompt: rawPrompt } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const durationSec = parseDuration(rawDur);
  const prompt = normalizePrompt(rawPrompt);
  const { cwd, name, key } = normalizeCwd(rawCwd);

  // 写路径顺手清扫（Redis 式的"主动回收"那一半）：长期没人读时库里也不会一直堆着
  recycleAllCwdGoals({ persist: true });
  const at = nowMs();
  return withCwdGoalDb((conn) => {
    const replaced = !!readCwdGoal(conn, key);
    const startMs = at;
    const deadlineMs = startMs + durationSec * 1000;
    // set = 开一局新的：归档标记必须清掉，否则新目标会被当成"已归档的旧目标"藏起来
    const blob = {
      key,
      cwd,
      name,
      durationSec,
      prompt,
      startedAtMs: startMs,
      deadlineMs,
      archived: false,
      archivedAtMs: 0,
      totalChecks: 0,
      checks: [],
    };
    writeCwdGoal(conn, blob, at);
    return { status: 'ok', replaced, key, name, cwd, goal: blobToGoalView(blob) };
  });
}

/** 查看本目录的 timegoal；无则返回 `{hasGoal:false}`。 */
export async function showTimegoal({ cwd: rawCwd } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const { key, name, cwd } = normalizeCwd(rawCwd);
  const blob = readLiveCwdBlob(key, Date.now());
  if (!blob) return { hasGoal: false, key, name, cwd };
  const evalRes = evalTimegoal(blobToGoal(blob), Date.now());
  return {
    hasGoal: true,
    key,
    name,
    cwd,
    goal: blobToGoalView(blob),
    reached: evalRes.reached,
    remainingSec: evalRes.remainingSec,
    elapsedSec: evalRes.elapsedSec,
    overtimeSec: evalRes.overtimeSec,
  };
}

/**
 * 时间运算 + 回显原 prompt，并追加一条状态日志。
 * - 每次有效 check 都要求调用方提供 `summary`（当前现状）与 `progress`
 *   （完成度/下一步），空值、缺值、超长都拒绝，保证日志有用且可比较。
 * - 有 goal：日志先成功落库，再返回 reached/time/prompt 和本次日志记录。
 * - 无 goal：仍需要提交 summary/progress，但不写日志（没有目标就不该有 goal 日志）。
 * `prompt` 永远从库原文回显 —— 不让 agent 在长对话里漂移。
 */

/**
 * check 的共同实现（队列级）：写一条流水 + 组装返回。
 * 日志先成功落库，再返回——「这轮 check 发生过」有据可查。
 */
function applyCwdCheck(conn, blob, key, name, cwd, summary, progress) {
  const at = nowMs();
  if (!blob) {
    return {
      hasGoal: false,
      reached: false,
      elapsedSec: 0,
      remainingSec: 0,
      overtimeSec: 0,
      prompt: '',
      summary,
      progress,
      key,
      name,
      cwd,
      now: stampNow(new Date(at)),
    };
  }
  const goal = blobToGoal(blob);
  const result = evalTimegoal(goal, at);
  // 归档惰性：check 是写路径，到点归档顺手落库
  if (result.reached && !blob.archived) {
    blob.archived = true;
    blob.archivedAtMs = blob.archivedAtMs || at;
  }
  blob.checks = Array.isArray(blob.checks) ? blob.checks : [];
  blob.checks.push({
    at,
    elapsedSec: result.elapsedSec,
    remainingSec: result.remainingSec,
    overtimeSec: result.overtimeSec,
    reached: result.reached,
    summary,
    progress,
  });
  blob.totalChecks = (Number(blob.totalChecks) || blob.checks.length - 1) + 1;
  writeCwdGoal(conn, blob, at);

  return {
    ...result,
    prompt: goal.prompt, // 永远原文回显，绝不拼接/裁剪
    summary,
    progress,
    checkedAt: stampOf(at),
    startedAt: goal.startedAt,
    deadline: goal.deadline,
    now: stampNow(new Date(at)),
    key,
    name,
    cwd,
    logCount: blob.checks.length,
    totalChecks: blob.totalChecks,
    archived: !!blob.archived,
    purged: false,
  };
}

export async function checkTimegoal({ cwd: rawCwd, summary: rawSummary, progress: rawProgress } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const summary = normalizeLogField(rawSummary, 'summary', 2000);
  const progress = normalizeLogField(rawProgress, 'progress', 2000);
  const { key, name, cwd } = normalizeCwd(rawCwd);
  // ⚠️ check 是**写路径**（每轮都要写一条流水），"自动失效"（超过保留期 → 整条删掉）
  // 在这里顺便落库。读路径（show / list / 面板的 /api/timegoals/all）刻意不写：
  // 面板每 1.5s 轮询一次，读路径写库会把并发的 CLI 写入冲掉。
  recycleAllCwdGoals({ persist: true });
  return withCwdGoalDb((conn) => {
    const blob = readCwdGoal(conn, key);
    return applyCwdCheck(conn, blob, key, name, cwd, summary, progress);
  });
}

// ─── 任务维度 goal（发布带时长 → 领取起算；goals / goal_checks 表）──────
//
// 任务级 goal 与**单条任务**一对一（goals.task_id 外键，删任务级联删 goal）。
// 起点 = **领取时刻**（localtask 领取路径调 startTaskGoal 时传入 consumedAt）。

export function taskGoalKey(topicKey, taskId) {
  return `task:${topicKey}:${taskId}`;
}

export function isTaskGoalKey(key) {
  return String(key || '').startsWith('task:');
}

/** 解析 task:<topicKey>:<seq> → { topicKey, seq }；不合法返回 null。 */
function parseTaskGoalKey(rawKey) {
  const m = /^task:(.+):(\d+)$/.exec(String(rawKey || ''));
  return m ? { topicKey: m[1], seq: Number(m[2]) } : null;
}

/** goals 行 + join 信息 → 旧 goalView 形状（key 由 taskGoalKey 拼回）。 */
function goalRowToView(row, { withPrompt = true } = {}) {
  if (!row) return null;
  const archived = String(row.state || '') === 'archived';
  const view = {
    key: taskGoalKey(row.topic_key, row.task_seq),
    taskId: Number(row.task_id),
    topicKey: String(row.topic_key || ''),
    cwd: String(row.topic_cwd || ''),
    name: String(row.topic_name || ''),
    durationSec: Number(row.duration_sec) || 0,
    startedAt: stampOf(row.started_at),
    deadline: stampOf(row.deadline),
    archived,
    archivedAt: archived ? stampOf(row.updated_at) : '',
    purged: false,
    purgedAt: '',
    totalChecks: 0,
    logCount: 0,
  };
  if (withPrompt) {
    view.prompt = String(row.prompt || '');
  } else if (row.prompt) {
    const p = String(row.prompt);
    view.promptPreview = p.length > 120 ? p.slice(0, 120) + '…' : p;
  }
  return view;
}

/** goals 行（未 join）→ evalTimegoal 可吃的 goal 视图（startedAt/deadline 为本地戳）。 */
function goalRowToGoal(row) {
  if (!row) return null;
  return {
    startedAt: stampOf(row.started_at),
    deadline: stampOf(row.deadline),
    durationSec: Number(row.duration_sec) || 0,
  };
}

/**
 * 领取时刻建任务级 goal。幂等：已存在直接返回 exists（防重复领取重复起表）。
 * @param {number} [startedAtMs] 计时起点（epoch ms）；缺省 = 现在。localtask 领取时传 consumedAt。
 */
export async function startTaskGoal({ topicKey, taskId: seq, cwd, name, durationSec, prompt = '', startedAtMs } = {}) {
  if (!topicKey || seq === undefined || seq === null) {
    throw badInput('startTaskGoal 需要 topicKey 与 taskId');
  }
  const dur = clampDuration(Number(durationSec));
  const at = Number(startedAtMs) || nowMs();
  return tx(
    (conn) => {
      const taskRow = conn.get(
        'SELECT t.id, tp.cwd AS topic_cwd, tp.name AS topic_name FROM tasks t JOIN topics tp ON tp.id = t.topic_id WHERE tp.key = :k AND t.seq = :s AND t.deleted_at IS NULL',
        { k: String(topicKey), s: Number(seq) }
      );
      if (!taskRow) throw badInput(`找不到任务 task:${topicKey}:${seq}（goal 无处挂载）`);
      const { id, existed } = goalsRepo.insertGoal(conn, {
        taskId: Number(taskRow.id),
        durationSec: dur,
        startedAtMs: at,
        deadlineMs: at + dur * 1000,
        prompt: String(prompt || '').trim(),
        atMs: at,
      });
      const row = goalsRepo.getGoalById(id, conn);
      const view = goalRowToView(
        {
          ...row,
          task_seq: Number(seq),
          topic_key: String(topicKey),
          topic_cwd: String(cwd || taskRow.topic_cwd || ''),
          topic_name: String(name || taskRow.topic_name || `任务 #${seq}`),
        },
        { withPrompt: true }
      );
      return { status: existed ? 'exists' : 'ok', goal: view };
    },
    { db: ltDb(), mode: 'IMMEDIATE' }
  );
}

/** 任务级 goal 状态（完成门禁的查询口）：hasGoal/reached/remaining/overtime + goal 视图。 */
export async function taskGoalState({ topicKey, taskId: seq } = {}) {
  if (!topicKey || seq === undefined || seq === null) return { hasGoal: false };
  const key = taskGoalKey(topicKey, seq);
  const row = goalsRepo.getGoalRowByTaskKey(topicKey, seq, ltDb());
  if (!row) return { hasGoal: false, key };
  const r = evalTimegoal(goalRowToGoal(row), nowMs());
  return { hasGoal: true, key, goal: goalRowToView(row), ...r };
}

/** 任务维度的查询（show --task 用）：按 goal key 直查。 */
export async function showGoalByKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) throw badInput('请给 --cwd <工作目录> 或 --task <任务goal key>');
  const parsed = parseTaskGoalKey(key);
  if (!parsed) return { hasGoal: false, key };
  const row = goalsRepo.getGoalRowByTaskKey(parsed.topicKey, parsed.seq, ltDb());
  if (!row) return { hasGoal: false, key };
  const r = evalTimegoal(goalRowToGoal(row), nowMs());
  return {
    hasGoal: true,
    key,
    name: String(row.topic_name || ''),
    cwd: String(row.topic_cwd || ''),
    goal: goalRowToView(row),
    reached: r.reached,
    remainingSec: r.remainingSec,
    elapsedSec: r.elapsedSec,
    overtimeSec: r.overtimeSec,
  };
}

/** 任务维度的最终 check（完成动作自动记录一条日志——「结束必须 check」的记录器语义）。 */
export async function checkGoalByKey(rawKey, { summary: rawSummary, progress: rawProgress } = {}) {
  const key = String(rawKey || '').trim();
  if (!key) throw badInput('请给 --cwd <工作目录> 或 --task <任务goal key>');
  const summary = normalizeLogField(rawSummary, 'summary', 2000);
  const progress = normalizeLogField(rawProgress, 'progress', 2000);
  const parsed = parseTaskGoalKey(key);
  if (!parsed) throw badInput('goal key 不合法（应为 task:<topicKey>:<seq>）: ' + key);
  return tx(
    (conn) => {
      const row = goalsRepo.getGoalRowByTaskKey(parsed.topicKey, parsed.seq, conn);
      if (!row) {
        return {
          hasGoal: false,
          reached: false,
          elapsedSec: 0,
          remainingSec: 0,
          overtimeSec: 0,
          prompt: '',
          summary,
          progress,
          key,
          name: key,
          cwd: '',
          now: stampNow(new Date(nowMs())),
        };
      }
      return applyGoalCheck(conn, row, parsed, summary, progress);
    },
    { db: ltDb(), mode: 'IMMEDIATE' }
  );
}

/** 任务级 check 的共同实现：写一条 goal_checks 流水 + 组装返回。 */
function applyGoalCheck(conn, row, parsed, summary, progress) {
  const at = nowMs();
  const goal = goalRowToGoal(row);
  const result = evalTimegoal(goal, at);
  // 归档惰性：check 是写路径，到点归档顺手落库
  if (result.reached && String(row.state || '') !== 'archived') {
    goalsRepo.archiveGoal(conn, Number(row.id), at);
    row.state = 'archived';
    row.updated_at = at;
  }
  goalsRepo.appendCheck(conn, {
    goalId: Number(row.id),
    atMs: at,
    elapsedSec: result.elapsedSec,
    remainingSec: result.remainingSec,
    overtimeSec: result.overtimeSec,
    reached: result.reached,
    summary,
    progress,
  });
  const totalChecks = goalsRepo.countChecks(Number(row.id), conn);
  return {
    ...result,
    prompt: String(row.prompt || ''), // 永远原文回显，绝不拼接/裁剪
    summary,
    progress,
    checkedAt: stampOf(at),
    startedAt: goal.startedAt,
    deadline: goal.deadline,
    now: stampNow(new Date(at)),
    key: taskGoalKey(parsed.topicKey, parsed.seq),
    name: String(row.topic_name || ''),
    cwd: String(row.topic_cwd || ''),
    logCount: totalChecks,
    totalChecks,
    archived: String(row.state || '') === 'archived',
    purged: false,
  };
}

export async function recordTaskCheck({ topicKey, taskId: seq, summary, progress } = {}) {
  const sum = normalizeLogField(summary, 'summary', 2000);
  const prog = normalizeLogField(progress, 'progress', 2000);
  if (!topicKey || seq === undefined || seq === null) return { recorded: false, reason: 'no_goal' };
  return tx(
    (conn) => {
      const row = goalsRepo.getGoalRowByTaskKey(topicKey, seq, conn);
      if (!row) return { recorded: false, reason: 'no_goal' };
      const payload = applyGoalCheck(conn, row, { topicKey: String(topicKey), seq: Number(seq) }, sum, prog);
      return { recorded: true, reached: payload.reached, checkedAt: payload.checkedAt };
    },
    { db: ltDb(), mode: 'IMMEDIATE' }
  );
}

/**
 * 读本目录 timegoal 的检查日志（每次 check 追加一条：现状 + 完成度）。
 * 这是 timegoal 的"历史"——回看每轮干了什么、剩多少时间。
 */
export async function getTimegoalLog({ cwd: rawCwd } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const { key, name, cwd } = normalizeCwd(rawCwd);
  const blob = readLiveCwdBlob(key, Date.now());
  if (!blob) return { hasGoal: false, count: 0, entries: [], key, name, cwd };
  const checks = Array.isArray(blob.checks) ? blob.checks : [];
  return {
    hasGoal: true,
    count: checks.length,
    totalEntries: Number(blob.totalChecks) || checks.length,
    entries: checks.map((e) => ({
      checkedAt: stampOf(e.at),
      elapsedSec: Number(e.elapsedSec) || 0,
      remainingSec: Number(e.remainingSec) || 0,
      overtimeSec: Number(e.overtimeSec) || 0,
      reached: !!e.reached,
      summary: String(e.summary || ''),
      progress: String(e.progress || ''),
    })),
    key,
    name,
    cwd,
  };
}

function durationLabel(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600}h`;
  if (s >= 60 && s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}

/**
 * 任务维度的 check 流水：面板「查看每轮 check」与 CLI `localtask timegoal-log` 共用。
 * 与队列级 getTimegoalLog 不同——任务级记录落在 goal_checks 行，逐轮读。
 */
export async function getTaskGoalLog({ topicKey, taskId: seq } = {}) {
  const key = taskGoalKey(topicKey, seq);
  if (!topicKey || seq === undefined || seq === null) {
    return { hasGoal: false, key, seq: Number(seq) || 0, count: 0, entries: [] };
  }
  const row = goalsRepo.getGoalRowByTaskKey(topicKey, seq, ltDb());
  if (!row) return { hasGoal: false, key, seq: Number(seq) || 0, count: 0, entries: [] };
  const checks = goalsRepo.listChecks(Number(row.id), ltDb());
  const view = goalRowToView(row);
  return {
    hasGoal: true,
    key,
    seq: Number(seq) || 0,
    name: String(row.topic_name || ''),
    cwd: String(row.topic_cwd || ''),
    durationSec: Number(view.durationSec) || 0,
    duration: durationLabel(view.durationSec),
    startedAt: view.startedAt,
    deadline: view.deadline,
    archived: view.archived,
    count: checks.length,
    totalChecks: checks.length,
    entries: checks.map((c) => {
      let summary = '';
      let progress = '';
      try {
        const v = JSON.parse(String(c.summary || '{}'));
        if (v && typeof v === 'object') {
          summary = String(v.summary || '');
          progress = String(v.progress || '');
        } else {
          summary = String(c.summary || '');
        }
      } catch {
        summary = String(c.summary || '');
      }
      return {
        checkedAt: stampOf(c.at),
        elapsedSec: Number(c.elapsed_sec) || 0,
        remainingSec: Number(c.remaining_sec) || 0,
        overtimeSec: Number(c.overtime_sec) || 0,
        reached: !!c.reached,
        summary,
        progress,
      };
    }),
  };
}

function normalizeLogField(raw, flag, maxLength) {
  const value = String(raw ?? '').trim();
  if (!value) throw badInput(`--${flag} 不能为空（每次 check 都会写入 timegoal 日志）`);
  if (value.length > maxLength) {
    throw badInput(`--${flag} 过长（≤${maxLength} 字，当前 ${value.length} 字）`);
  }
  return value;
}

/**
 * 更新本目录 timegoal 的 prompt（可选同时改时长），**不动 startedAt**。
 *
 * 这是"agent 自己优化提示词"与"用户在 web 上编辑 timegoal"的共同入口。
 * 与 `set` 的关键差异：
 *   - `set`    → 重置起点（计时从头算），适合"开一局新的"
 *   - `update` → 保留起点。改时长时 deadline = startedAt + 新时长，
 *                已用掉的时间仍然算数（不会因为拖了下时长就白赚一段）。
 *
 * `durationSec` 省略 = 时长不变，只换 prompt。
 *
 * ⚠️ **已到点（失效）的目标不能 update**：到期即失效，不可复活；要继续这个目录
 * 的工作请用 `set` 开新一局。
 *
 * 无 goal 时抛错（不存在就没有"更新"对象，与 clear 的宽容返回不同）。
 */
export async function updateTimegoal({ cwd: rawCwd, prompt: rawPrompt, durationSec: rawDur } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const prompt = normalizePrompt(rawPrompt);
  const { cwd, name, key } = normalizeCwd(rawCwd);
  recycleAllCwdGoals({ persist: true });
  return withCwdGoalDb((conn) => {
    const blob = readCwdGoal(conn, key);
    if (!blob) {
      throw badInput(`主题「${name}」尚未设置 timegoal——请先 nx-kv timegoal set`);
    }
    // ⚠️ **已到点的目标不可复活**：「失效」就是失效。
    if (blob.archived) {
      throw badInput(
        `主题「${name}」的时间目标已经到点失效了，不能续上——请用 nx-kv timegoal set 开新一局`
      );
    }
    blob.prompt = prompt;
    if (rawDur !== undefined && rawDur !== null && rawDur !== '') {
      const dur = parseDuration(rawDur);
      blob.durationSec = dur;
      // 保留起点：deadline = startedAt + 新时长（已用时间仍算数）
      const base = Number(blob.startedAtMs);
      blob.deadlineMs = (Number.isFinite(base) ? base : nowMs()) + dur * 1000;
    }
    writeCwdGoal(conn, blob, nowMs());
    return { updated: true, key, name, cwd, goal: blobToGoalView(blob) };
  });
}

/**
 * 删除本目录的 timegoal。无则 `{cleared:false, reason:'no_goal'}`（不抛错，
 * 方便面板"清空"按钮无脑调用）。
 */
export async function clearTimegoal({ cwd: rawCwd } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const { key, cwd, name } = normalizeCwd(rawCwd);
  return withCwdGoalDb((conn) => {
    if (!readCwdGoal(conn, key)) {
      return { cleared: false, reason: 'no_goal', key, name, cwd };
    }
    deleteSettingRaw(conn, cwdGoalKeyOf(key));
    return { cleared: true, key, name, cwd };
  });
}

/**
 * 列出所有有 timegoal 的目录，按 deadline 升序（最近的先提醒）。
 *
 * **活动目标**（goals）与**已归档目标**（archived）分开返回：
 * 到点即自动归档的活动目标不会再出现在这里——用户不必再手动点「回收已到点」。
 */
export async function listTimegoals() {
  // 读路径不落库，但**归档态照样可见**：在内存副本上跑 recycle（与 JSON 时代的
  // loadRecycledStore({persist:false}) 同语义），列表/归档区据此分类。
  const byDeadline = (a, b) => String(a.deadline).localeCompare(String(b.deadline));
  const active = [];
  const archived = [];
  const at = nowMs();
  for (const { value } of listSettingsByPrefix(ltDb(), CWD_GOAL_PREFIX)) {
    if (!value || typeof value !== 'object') continue;
    // 内存内生效；写路径负责真正落库。返回 'purge' = 保留期已过 → 不再列出（已失效）
    if (autoRecycleCwdBlob(value, at) === 'purge') continue;
    const view = blobToGoalView(value, { withPrompt: false });
    if (!view) continue;
    (view.archived ? archived : active).push(view);
  }
  active.sort(byDeadline);
  archived.sort(byDeadline);
  return {
    count: active.length,
    // 列表**不返回完整 prompt**：每个 prompt 上限 20000 字，归档区 N 个目标就是
    // N×20KB，而面板每 1.5s 拉一次 list。要看全文用 `timegoal show --cwd <目录>`。
    goals: active,
    archivedCount: archived.length,
    archived,
  };
}

/** 队列级目标的到点归档 / 超期失效（persist=true 才落库）。返回是否有变化。 */
function recycleAllCwdGoals({ persist = false } = {}) {
  const conn = ltDb();
  const at = nowMs();
  let changed = false;
  for (const { key, value } of listSettingsByPrefix(conn, CWD_GOAL_PREFIX)) {
    if (!value || typeof value !== 'object') continue;
    const res = autoRecycleCwdBlob(value, at);
    if (res === 'purge') {
      if (persist) deleteSettingRaw(conn, key);
      changed = true;
    } else if (res) {
      if (persist) writeSettingRaw(conn, key, value, at);
      changed = true;
    }
  }
  return changed;
}

/**
 * 彻底删除已到点 / 已归档的时间目标（硬删，不是归档）。
 *
 * 用途：面板「彻底清除」按钮 / 手动清理。**只删到点的或已归档的**——还在跑的不动。
 * 注意：正常的"到点回收"是**自动归档**，不需要人来点这个；
 * 保留期过后系统会自动丢掉旧日志（提示词仍留着）；本命令用于把整个目标连提示词一起清掉。
 *
 * @returns {{count:number, removed:Array}} removed 是删除前的快照（供 UI 汇报）
 */
export async function pruneExpired() {
  const at = nowMs();
  const removed = [];
  return tx(
    (conn) => {
      for (const { key, value } of listSettingsByPrefix(conn, CWD_GOAL_PREFIX)) {
        if (!value || typeof value !== 'object') continue;
        const view = blobToGoalView(value);
        if (view.archived || evalTimegoal(view, at).reached) {
          removed.push(view);
          deleteSettingRaw(conn, key);
        }
      }
      // 任务级：到点/已归档的 goals 一并回收（与队列级同一条「彻底清除」语义）
      for (const row of goalsRepo.listGoalRows(conn)) {
        const goal = goalRowToGoal(row);
        const archived = String(row.state || '') === 'archived';
        if (archived || evalTimegoal(goal, at).reached) {
          removed.push(goalRowToView(row));
          goalsRepo.purgeGoal(conn, Number(row.id));
        }
      }
      return { count: removed.length, removed };
    },
    { db: ltDb(), mode: 'IMMEDIATE' }
  );
}
