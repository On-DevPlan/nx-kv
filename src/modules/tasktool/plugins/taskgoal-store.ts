// tasktool/taskgoal.js —— 任务级 timegoal 工具链。
//
// 与目录级 timegoal（timegoal.js）的关系：同一棵存储（timegoals.json）、同一套
// 状态机（evalTimegoal/autoRecycle/日志/保留期），只是寻址不同——目录级与目录一对一，
// 任务级与**单条任务**一对一（key = task:<topicKey>:<taskId>）。
//
// 流程（todo.md「任务工具」的 timegoal 规格）：
//   1. 发布：`localtask add "..." --duration 2h [--goal-prompt "..."]`
//      → 任务记录带 timegoal 声明 { duration, prompt }（时长人类写法，领取时才解析）
//   2. 领取：交付时刻（buildTaskDelivery）调 ensureTaskGoal → **领取即起表**
//      （起点 = consumedAt），并把 check 指令作为 goal.prompt 固化
//   3. 推进：agent 每轮 `timegoal check --task <goalKey> --summary`
//   4. 完成：`localtask done --id ...` —— **未到时间拒绝标记完成**，提示派
//      sub agent 重新提出新的需求；到点自动记录最终 check
//
// 本文件不依赖 localtask（纯 timegoal 存储 + core），localtask 反过来引用这里。
import { badInput } from '../../../core/errors.js';
import {
  customGoalPromptOf,
  renderCustomGoalPrompt,
  taskGoalTemplateCtx,
} from './goal-template.js';
import { MAX_PROMPT, parseDuration, startTaskGoal, taskGoalState, taskGoalKey, recordTaskCheck } from './timegoal-store.js';
import { checkHistoryOfTask } from './timegoal-task-store.js';

export interface TaskGoalDeclaration {
  duration?: unknown;
  prompt?: unknown;
}

/**
 * 发布端的声明字段校验（localtask add 落库前调用；不合法直接抛，宁可在发布时报错）。
 * 时长存**人类写法原文**（"2h"），解析发生在领取时刻——本文件拥有 timegoal 语义。
 */
export function sanitizeTaskGoal(raw: unknown): { duration: string; prompt: string } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') throw badInput('timegoal 必须是 { duration, prompt }');
  const decl = raw as TaskGoalDeclaration;
  const duration = String(decl.duration || '').trim();
  if (!duration) throw badInput('timegoal.duration 不能为空（如 2h / 90m / 30分钟）');
  parseDuration(duration); // 发布时就解析一次：写法错误在发布时报，不在领取时报
  const prompt = String(decl.prompt || '').trim();
  if (prompt.length > MAX_PROMPT) {
    throw badInput(`timegoal.prompt 过长（≤${MAX_PROMPT} 字，当前 ${prompt.length} 字）`);
  }
  return { duration, prompt };
}

export interface EnsureTaskGoalParams {
  topicKey?: unknown;
  taskId?: unknown;
  cwd?: unknown;
  name?: unknown;
  text?: unknown;
  timegoal?: TaskGoalDeclaration | null;
  startedAtMs?: number;
}

/**
 * 交付时刻调用：确保任务级 goal 已起表（**领取即计时**，幂等——重复领取不重置起点），
 * 并返回渲染用 goal 上下文（与目录级 readGoalCtx 同形状：name/deadline/prompt）。
 * 声明的时长不合法 → 返回 null（发布端已校验，这里是防御）。
 *
 * @returns null | {name, deadline, prompt, promptTemplate, goalKey, durationSec, extra}
 */
export async function ensureTaskGoal(p: EnsureTaskGoalParams = {}): Promise<Record<string, any> | null> {
  const { topicKey, taskId, cwd, name, timegoal, startedAtMs } = p || {};
  const taskText = p && p.text;
  if (!timegoal || !topicKey || taskId === undefined || taskId === null) return null;
  let durationSec: number;
  try {
    durationSec = parseDuration(timegoal.duration);
  } catch {
    return null;
  }
  const goalKey = taskGoalKey(topicKey, taskId);
  // #161：出厂指令正文搬进 timecheck 段模板（所见即所得，设置页可编辑）。
  // goals.prompt 只存**用户自定义**（timegoal set/update --prompt）——落库出厂
  // 原文会让「段模板编辑」对这些行永远失效（段模板被 goal.check 双层遮住）。
  const promptTemplate = '';
  const r = await startTaskGoal({
    topicKey,
    taskId,
    cwd,
    name,
    durationSec,
    prompt: promptTemplate,
    startedAtMs,
  });
  const g = r && r.goal;
  if (!g) return null;
  const extra = timegoal.prompt;
  const ctx = taskGoalTemplateCtx({
    taskId,
    taskText,
    goalKey: g.key || goalKey,
    durationSec: g.durationSec || durationSec,
    extra,
    startedAt: g.startedAt || g.started_at,
    deadline: g.deadline,
    nowMs: Date.now(),
    history: checkHistoryOfTask(taskId),
  });
  return {
    name: g.name,
    deadline: g.deadline,
    // #161：只有**用户自定义**的 prompt 才进 goal.check（出厂正文在 timecheck 段模板里，
    // 设置页编辑即生效）；每轮 check 会按当下 ctx 重新渲染（任务 #87）。
    prompt: renderCustomGoalPrompt(ctx, g.prompt),
    promptTemplate: customGoalPromptOf(g.prompt),
    goalKey: g.key || goalKey,
    durationSec: g.durationSec || durationSec,
    // check 段（进度行）与 doneguard 段在 get 交付里也渲染——时间量 / check 历史按领取当下补齐
    elapsedSec: ctx.goal.elapsedSec,
    remainingSec: ctx.goal.remainingSec,
    sinceLastCheckSec: ctx.goal.sinceLastCheckSec,
    checks: ctx.goal.checks,
    extra: extra || '',
  };
}

export interface PreviewTaskGoalParams {
  topicKey?: unknown;
  taskId?: unknown;
  cwd?: unknown;
  name?: unknown;
  timegoal?: TaskGoalDeclaration | null;
  text?: unknown;
}

/**
 * 预览用的 goal 上下文（**零副作用**：不起表、不写盘）。
 *
 * 「预览 get 提示词」必须与真实领取**逐字一致**，否则预览就没有意义：
 *   - 已经起过表 → 回显固化后的 prompt（领取时写死在 goal 里的那份原文）；
 *   - 还没起表（pending 任务）→ 按声明现算（= 领取那一刻会固化的同一份文本）。
 */
export async function previewTaskGoal({ topicKey, taskId, name, timegoal, text }: PreviewTaskGoalParams = {}): Promise<Record<string, any> | null> {
  if (!timegoal || !topicKey || taskId === undefined || taskId === null) return null;
  let durationSec: number;
  try {
    durationSec = parseDuration(timegoal.duration);
  } catch {
    return null;
  }
  const goalKey = taskGoalKey(topicKey, taskId);
  const state = await taskGoalState({ topicKey, taskId }).catch(() => null);
  if (state && state.hasGoal && state.goal) {
    const g = state.goal;
    const ctx = taskGoalTemplateCtx({
      taskId,
      taskText: text,
      goalKey: g.key || goalKey,
      durationSec: g.durationSec || durationSec,
      extra: timegoal.prompt,
      startedAt: g.startedAt || g.started_at,
      deadline: g.deadline,
      nowMs: Date.now(),
      history: checkHistoryOfTask(taskId),
    });
    return {
      name: g.name || name || `任务 #${taskId}`,
      deadline: g.deadline || '',
      prompt: renderCustomGoalPrompt(ctx, g.prompt),
      promptTemplate: customGoalPromptOf(g.prompt),
      goalKey: g.key || goalKey,
      durationSec: g.durationSec || durationSec,
      elapsedSec: ctx.goal.elapsedSec,
      remainingSec: ctx.goal.remainingSec,
      sinceLastCheckSec: ctx.goal.sinceLastCheckSec,
      checks: ctx.goal.checks,
      extra: timegoal.prompt || '',
      started: true,
    };
  }
  // #161：出厂正文在 timecheck 段模板里——未起表的预览不需要 ctx（prompt 恒空）
  return {
    name: name || `任务 #${taskId}`,
    deadline: '',
    prompt: '',
    promptTemplate: '',
    goalKey,
    durationSec,
    extra: timegoal.prompt || '',
    started: false,
  };
}

export { taskGoalState, recordTaskCheck, taskGoalKey };
