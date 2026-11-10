// timegoal 任务级 store——`localtask add --duration` 的「领取起算」目标落点。
//
// 落库形态：**goals + goal_checks 表**（task_id 外键；删任务连 goal 与流水级联消失，
// 见 localtask/repo/goals.js）。任务级 goal 与**单条任务**一对一；
// 起点 = **领取时刻**（localtask 领取路径调 startTaskGoal 时传入 consumedAt）。
//
// goal_checks 行的 progress 与 summary 合存在同一列（JSON 编码，见 goals.js）。
import { badInput } from '../../../core/errors.js';
import { tx } from '../../../core/db/index.js';
import { db as ltDb } from '../../localtask/repo/open.js';
import { nowMs } from '../../../core/db/time.js';
import * as goalsRepo from '../../localtask/repo/goals.js';
import {
  clampDuration,
  durationLabel,
  evalTimegoal,
  normalizeLogField,
  stampNow,
  stampOf,
} from './timegoal-core-store.js';

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
export function goalRowToView(row, { withPrompt = true } = {}) {
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
export function goalRowToGoal(row) {
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
