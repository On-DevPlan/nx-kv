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
import { formatDuration } from '../../../core/instruction-template.js';
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
 * 任务级 goal 的固化 prompt = **check 指令**（系统部分，agent 每轮照做）
 * + 用户 --goal-prompt 追加说明（可选）。
 * goalKey 先算出来直接嵌进指令——agent 复制执行即可，不用自己拼 key。
 */
function taskGoalPrompt({ goalKey, taskId, durationHuman, extra }) {
  return [
    `本任务带时间目标（领取即计时，持续 ${durationHuman}）。`,
    `- 每轮推进先执行：nx-kv timegoal check --task ${goalKey} --summary "<本轮现状>" --progress "<进展/下一步>"`,
    `- 时间未到不得标记完成——应派出 sub agent 重新提出新的需求，再继续推进。`,
    `- check 返回 reached:true 后才允许：nx-kv localtask done --id ${taskId} --summary "<完成总结>"`,
    extra ? `\n附加要求（发布方）：\n${extra}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 交付时刻调用：确保任务级 goal 已起表（**领取即计时**，幂等——重复领取不重置起点），
 * 并返回渲染用 goal 上下文（与目录级 readGoalCtx 同形状：name/deadline/prompt）。
 * 声明的时长不合法 → 返回 null（发布端已校验，这里是防御）。
 *
 * @param {{topicKey:string, taskId:number, cwd?:string, name?:string,
 *          timegoal:{duration:string,prompt?:string}, startedAtMs?:number}} p
 * @returns {Promise<null | {name, deadline, prompt, goalKey, durationSec}>}
 */
export async function ensureTaskGoal(p) {
  const { topicKey, taskId, cwd, name, timegoal, startedAtMs } = p || {};
  if (!timegoal || !topicKey || taskId === undefined || taskId === null) return null;
  let durationSec;
  try {
    durationSec = parseDuration(timegoal.duration);
  } catch {
    return null;
  }
  const goalKey = taskGoalKey(topicKey, taskId);
  const prompt = taskGoalPrompt({
    goalKey,
    taskId,
    durationHuman: formatDuration(durationSec),
    extra: timegoal.prompt,
  });
  const r = await startTaskGoal({
    topicKey,
    taskId,
    cwd,
    name,
    durationSec,
    prompt,
    startedAtMs,
  });
  const g = r && r.goal;
  if (!g) return null;
  return {
    name: g.name,
    deadline: g.deadline,
    prompt: g.prompt, // check 指令已固化：之后每轮 check 原文回显，agent 不可能「忘了要 check」
    goalKey: g.key,
    durationSec: g.durationSec,
  };
}

export { taskGoalState, recordTaskCheck, taskGoalKey };
