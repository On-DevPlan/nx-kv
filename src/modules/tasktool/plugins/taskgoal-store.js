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
//   3. 推进：agent 每轮 `timegoal check --task <goalKey> --summary --progress`
//   4. 完成：`localtask done --id ...` —— **未到时间拒绝标记完成**，提示派
//      sub agent 重新提出新的需求；到点自动记录最终 check
//
// 本文件不依赖 localtask（纯 timegoal 存储 + core），localtask 反过来引用这里。
import { badInput } from '../../../core/errors.js';
import {
  TASK_GOAL_PROMPT_TEMPLATE,
  renderTaskGoalPrompt,
  taskGoalTemplateCtx,
} from './goal-template.js';
import { MAX_PROMPT, parseDuration, startTaskGoal, taskGoalState, taskGoalKey, recordTaskCheck } from './timegoal-store.js';

/**
 * 发布端的声明字段校验（localtask add 落库前调用；不合法直接抛，宁可在发布时报错）。
 * 时长存**人类写法原文**（"2h"），解析发生在领取时刻——本文件拥有 timegoal 语义。
 */
export function sanitizeTaskGoal(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') throw badInput('timegoal 必须是 { duration, prompt }');
  const duration = String(raw.duration || '').trim();
  if (!duration) throw badInput('timegoal.duration 不能为空（如 2h / 90m / 30分钟）');
  parseDuration(duration); // 发布时就解析一次：写法错误在发布时报，不在领取时报
  const prompt = String(raw.prompt || '').trim();
  if (prompt.length > MAX_PROMPT) {
    throw badInput(`timegoal.prompt 过长（≤${MAX_PROMPT} 字，当前 ${prompt.length} 字）`);
  }
  return { duration, prompt };
}

/**
 * 交付时刻调用：确保任务级 goal 已起表（**领取即计时**，幂等——重复领取不重置起点），
 * 并返回渲染用 goal 上下文（与目录级 readGoalCtx 同形状：name/deadline/prompt）。
 * 声明的时长不合法 → 返回 null（发布端已校验，这里是防御）。
 *
 * @param {{topicKey:string, taskId:number, cwd?:string, name?:string, text?:string,
 *          timegoal:{duration:string,prompt?:string}, startedAtMs?:number}} p
 * @returns {Promise<null | {name, deadline, prompt, promptTemplate, goalKey, durationSec, extra}>}
 */
export async function ensureTaskGoal(p) {
  const { topicKey, taskId, cwd, name, timegoal, startedAtMs } = p || {};
  const taskText = p && p.text;
  if (!timegoal || !topicKey || taskId === undefined || taskId === null) return null;
  let durationSec;
  try {
    durationSec = parseDuration(timegoal.duration);
  } catch {
    return null;
  }
  const goalKey = taskGoalKey(topicKey, taskId);
  // 落库的是**模板**（占位符保留），交付时用领取那一刻的 ctx 渲染。
  const promptTemplate = TASK_GOAL_PROMPT_TEMPLATE;
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
  });
  return {
    name: g.name,
    deadline: g.deadline,
    // check 指令用同一套模板渲染：之后每轮 check 会按当下 ctx 重新渲染（任务 #87）
    prompt: renderTaskGoalPrompt(ctx, g.prompt || promptTemplate),
    promptTemplate: g.prompt || promptTemplate,
    goalKey: g.key || goalKey,
    durationSec: g.durationSec || durationSec,
    extra: extra || '',
  };
}

/**
 * 预览用的 goal 上下文（**零副作用**：不起表、不写盘）。
 *
 * 「预览 get 提示词」必须与真实领取**逐字一致**，否则预览就没有意义：
 *   - 已经起过表 → 回显固化后的 prompt（领取时写死在 goal 里的那份原文）；
 *   - 还没起表（pending 任务）→ 按声明现算（= 领取那一刻会固化的同一份文本）。
 */
export async function previewTaskGoal({ topicKey, taskId, name, timegoal, text }) {
  if (!timegoal || !topicKey || taskId === undefined || taskId === null) return null;
  let durationSec;
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
    });
    return {
      name: g.name || name || `任务 #${taskId}`,
      deadline: g.deadline || '',
      prompt: renderTaskGoalPrompt(ctx, g.prompt),
      promptTemplate: g.prompt || '',
      goalKey: g.key || goalKey,
      durationSec: g.durationSec || durationSec,
      extra: timegoal.prompt || '',
      started: true,
    };
  }
  const ctx = taskGoalTemplateCtx({
    taskId,
    taskText: text,
    goalKey,
    durationSec,
    extra: timegoal.prompt,
    startedAt: Date.now(),
    deadline: Date.now() + durationSec * 1000,
    nowMs: Date.now(),
  });
  return {
    name: name || `任务 #${taskId}`,
    deadline: '',
    prompt: renderTaskGoalPrompt(ctx),
    promptTemplate: TASK_GOAL_PROMPT_TEMPLATE,
    goalKey,
    durationSec,
    extra: timegoal.prompt || '',
    started: false,
  };
}

export { taskGoalState, recordTaskCheck, taskGoalKey };
