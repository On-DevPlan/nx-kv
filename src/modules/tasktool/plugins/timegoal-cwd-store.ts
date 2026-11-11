// timegoal 队列级 store——`timegoal set --cwd` 的「每 cwd 一目标」落点与 CRUD。
//
// 落库形态：**settings 表 blob**（键 `tg.cwd.<topicKey>`，value 是 JSON：目标字段 +
// checks 流水）。队列是容器、没有可挂的 task_id（goals.task_id NOT NULL 是 schema
// 定稿），而 goal 恰是「按键取值、不做关系查询」的运行时状态 —— settings 表的硬规则
// （WHERE 里的东西不进 settings）对它恰好不构成约束。
//
// 不变量：
//   - **不可变 prompt**：set 写进库之后 prompt 变成只读事实，check 永远从库原文回显
//     （不让 agent 改 prompt 或从对话历史重新拼接——"避免偏移"的物理保证）。
//   - **check 流水只增不改**：elapsed / remaining / overtime 存**当日快照**（deadline
//     会被延期，查时重算会把历史改写）。行级追加没有 logTruncated 的概念（那是 JSON
//     整份重写时代的产物）——总量用 totalChecks。
import { badInput } from '../../../core/errors.js';
import { readSettingRaw, writeSettingRaw, deleteSettingRaw, listSettingsByPrefix } from '../../../core/db/settings.js';
import { tx } from '../../../core/db/index.js';
import { db as ltDb } from '../../localtask/repo/open.js';
import { nowMs } from '../../../core/db/time.js';
import {
  archiveRetentionSec,
  evalTimegoal,
  normalizeCwd,
  normalizeLogField,
  normalizePrompt,
  parseDuration,
  stampNow,
  stampOf,
} from './timegoal-core-store.js';

/** settings 表里队列级 goal 的键前缀。 */
export const CWD_GOAL_PREFIX = 'tg.cwd.';

// ─── 视图（与 JSON 时代同形状；logTruncated 已随 JSON store 一起消失）────

function blobToGoal(blob: any): any | null {
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

export function blobToGoalView(blob: any, { withPrompt = true }: { withPrompt?: boolean } = {}): any | null {
  const g = blobToGoal(blob);
  if (!g) return null;
  const checks = Array.isArray(blob.checks) ? blob.checks : [];
  const view: any = {
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

// ─── 读写 blob ─────────────────────────────────────────────────────────

const cwdGoalKeyOf = (topicKey: unknown): string => CWD_GOAL_PREFIX + String(topicKey || '');

function readCwdGoal(conn: any, topicKey: unknown): any | null {
  const blob = readSettingRaw(conn, cwdGoalKeyOf(topicKey));
  return blob && typeof blob === 'object' ? blob : null;
}

function writeCwdGoal(conn: any, blob: any, atMs: number): void {
  writeSettingRaw(conn, cwdGoalKeyOf(blob.key), blob, atMs);
}

/** 到点归档 + 超期自动失效（写路径才落库；读路径只推导不写）。返回 false / true / 'purge' */
function autoRecycleCwdBlob(blob: any, atNow: number): boolean | 'purge' {
  let changed: boolean | 'purge' = false;
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

function withCwdGoalDb<T>(fn: (conn: any) => T): T {
  return tx((conn) => fn(conn), { db: ltDb(), mode: 'IMMEDIATE' });
}

/** 只读探针共用：读 blob（不写库）；null = 没有目标或已自动失效。 */
function readLiveCwdBlob(topicKey: string, atNow: number): any | null {
  const conn = ltDb();
  const blob = readCwdGoal(conn, topicKey);
  if (!blob) return null;
  if (autoRecycleCwdBlob(blob, atNow) === 'purge') return null; // 超期：读路径不落库，视为已消失
  return blob;
}

/** 队列级目标的到点归档 / 超期失效（persist=true 才落库）。返回是否有变化。 */
function recycleAllCwdGoals({ persist = false }: { persist?: boolean } = {}): boolean {
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
 * @returns 没有目标 → null
 */
export async function probeGoalExpiry(key: unknown): Promise<null | Record<string, any>> {
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

// ─── CRUD（与 localtask 思路一致但命令族更窄）───────────────────────────

export interface SetTimegoalOptions {
  cwd?: unknown;
  durationSec?: unknown;
  prompt?: unknown;
}

/**
 * 设置本目录的 timegoal；已存在则覆盖并标 `replaced:true`。
 */
export async function setTimegoal({ cwd: rawCwd, durationSec: rawDur, prompt: rawPrompt }: SetTimegoalOptions = {}): Promise<Record<string, any>> {
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
export async function showTimegoal({ cwd: rawCwd }: { cwd?: unknown } = {}): Promise<Record<string, any>> {
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
 * check 的共同实现（队列级）：写一条流水 + 组装返回。
 * 日志先成功落库，再返回——「这轮 check 发生过」有据可查。
 */
function applyCwdCheck(conn: any, blob: any, key: unknown, name: unknown, cwd: unknown, summary: unknown): Record<string, any> {
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
  });
  blob.totalChecks = (Number(blob.totalChecks) || blob.checks.length - 1) + 1;
  writeCwdGoal(conn, blob, at);

  return {
    ...result,
    prompt: goal.prompt, // 永远原文回显，绝不拼接/裁剪
    summary,
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

export interface CheckTimegoalOptions {
  cwd?: unknown;
  summary?: unknown;
}

/**
 * 时间运算 + 回显原 prompt，并追加一条状态日志。
 * - 每次有效 check 都要求调用方提供 `summary`（当前现状），空值、缺值、超长都
 *   拒绝，保证日志有用且可比较。
 * - 有 goal：日志先成功落库，再返回 reached/time/prompt 和本次日志记录。
 * - 无 goal：仍需要提交 summary，但不写日志（没有目标就不该有 goal 日志）。
 * `prompt` 永远从库原文回显 —— 不让 agent 在长对话里漂移。
 */
export async function checkTimegoal({ cwd: rawCwd, summary: rawSummary }: CheckTimegoalOptions = {}): Promise<Record<string, any>> {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const summary = normalizeLogField(rawSummary, 'summary', 2000);
  const { key, name, cwd } = normalizeCwd(rawCwd);
  // ⚠️ check 是**写路径**（每轮都要写一条流水），"自动失效"（超过保留期 → 整条删掉）
  // 在这里顺便落库。读路径（show / list / 面板的 /api/timegoals/all）刻意不写：
  // 面板每 1.5s 轮询一次，读路径写库会把并发的 CLI 写入冲掉。
  recycleAllCwdGoals({ persist: true });
  return withCwdGoalDb((conn) => {
    const blob = readCwdGoal(conn, key);
    return applyCwdCheck(conn, blob, key, name, cwd, summary);
  });
}

/**
 * 读本目录 timegoal 的检查日志（每次 check 追加一条：当轮现状）。
 * 这是 timegoal 的"历史"——回看每轮干了什么、剩多少时间。
 */
export async function getTimegoalLog({ cwd: rawCwd }: { cwd?: unknown } = {}): Promise<Record<string, any>> {
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
    entries: checks.map((e: any) => ({
      checkedAt: stampOf(e.at),
      elapsedSec: Number(e.elapsedSec) || 0,
      remainingSec: Number(e.remainingSec) || 0,
      overtimeSec: Number(e.overtimeSec) || 0,
      reached: !!e.reached,
      summary: String(e.summary || ''),
      // 历史 blob 可能带 progress 字段——参数已废不再写入，历史行原样透出
      progress: String(e.progress || ''),
    })),
    key,
    name,
    cwd,
  };
}

export interface UpdateTimegoalOptions {
  cwd?: unknown;
  prompt?: unknown;
  durationSec?: unknown;
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
export async function updateTimegoal({ cwd: rawCwd, prompt: rawPrompt, durationSec: rawDur }: UpdateTimegoalOptions = {}): Promise<Record<string, any>> {
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
export async function clearTimegoal({ cwd: rawCwd }: { cwd?: unknown } = {}): Promise<Record<string, any>> {
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
export async function listTimegoals(): Promise<Record<string, any>> {
  // 读路径不落库，但**归档态照样可见**：在内存副本上跑 recycle（与 JSON 时代的
  // loadRecycledStore({persist:false}) 同语义），列表/归档区据此分类。
  const byDeadline = (a: any, b: any): number => String(a.deadline).localeCompare(String(b.deadline));
  const active: any[] = [];
  const archived: any[] = [];
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
