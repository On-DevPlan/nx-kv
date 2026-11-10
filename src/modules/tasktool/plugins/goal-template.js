// 任务级 timegoal 的提示词模板（任务 #87）——**领取交付**与**每轮 check** 的同源代码。
//
// 为什么单独一个文件：领取路径（taskgoal-store）与 check 路径（timegoal-task-store）
// 都要渲染同一份模板；而这两个模块在 timegoal-store 里已经互相 import，把模板
// 放在这里可以避免循环依赖，也保证两边变量口径永远一致。
//
// goals.prompt 落库的是**模板原文**（占位符保留），渲染发生在：
//   - 领取交付：用「领取那一刻」的 ctx（输出与改造前逐字一致）；
//   - 每轮 check：用「当下」的 ctx 重新渲染——于是每轮都能拿到实时时间目标
//     与**任务实时原文**（{{task.text}}）。
//
// 可用占位符（与提示词模板同一套 Handlebars 引擎）：
//   {{task.id}} {{task.text}}
//   {{goal.goalKey}} {{goal.durationHuman}} {{goal.durationSec}}
//   {{goal.startedAt}} {{goal.deadline}} {{goal.remainingHuman}} {{goal.remainingSec}}
//   {{goal.elapsedHuman}} {{goal.elapsedSec}} {{goal.overtimeSec}} {{goal.reached}}
//   {{goal.extra}}
//   {{check.summary}} {{check.progress}} {{check.at}} {{check.count}}（仅 check 渲染时）
import { formatDuration, renderInstruction } from '../../../core/instruction-template.js';

export const TASK_GOAL_PROMPT_TEMPLATE = [
  '本任务带时间目标（领取即计时，持续 {{goal.durationHuman}}）。',
  '- 每轮推进先执行：nx-kv timegoal check --task {{goal.goalKey}} --summary "<本轮现状>" --progress "<进展/下一步>"',
  '- 时间未到不得标记完成——应派出 sub agent 重新提出新的需求，再继续推进。',
  '- check 返回 reached:true 后才允许：nx-kv localtask done --id {{task.id}} --summary "<完成总结>"',
  '{{#if goal.extra}}',
  '附加要求（发布方）：',
  '{{goal.extra}}',
  '{{/if}}',
].join('\n');

/** 戳（本地时间字符串）→ epoch ms。 */
export function stampMsOf(v) {
  if (typeof v === 'number') return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(v || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

/** epoch ms → 本地时间戳（与 timegoal 存储的 stamp 同格式）。 */
export function stampOfMs(ms) {
  if (!Number.isFinite(Number(ms))) return '';
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** goal 模板渲染的 ctx（领取 / check 共用同一构造，保证两处变量口径一致）。 */
export function taskGoalTemplateCtx({ taskId, taskText, goalKey, durationSec, extra, startedAt, deadline, nowMs, check }) {
  const dur = Number(durationSec) || 0;
  const startMs = typeof startedAt === 'number' ? startedAt : stampMsOf(startedAt);
  const endMs = typeof deadline === 'number' ? deadline : stampMsOf(deadline);
  const now = Number(nowMs) || Date.now();
  const remainingSec = Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - now) / 1000)) : 0;
  const overtimeSec = Number.isFinite(endMs) ? Math.max(0, Math.round((now - endMs) / 1000)) : 0;
  const elapsedSec = Number.isFinite(startMs) ? Math.max(0, Math.round((now - startMs) / 1000)) : 0;
  const reached = Number.isFinite(endMs) ? now >= endMs : false;
  return {
    task: { id: taskId, text: String(taskText || '') },
    goal: {
      goalKey: String(goalKey || ''),
      durationHuman: formatDuration(dur),
      durationSec: dur,
      startedAt: typeof startedAt === 'string' ? startedAt : stampOfMs(startedAt),
      deadline: typeof deadline === 'string' ? deadline : stampOfMs(deadline),
      remainingHuman: reached ? '' : formatDuration(remainingSec),
      remainingSec,
      elapsedHuman: formatDuration(elapsedSec),
      elapsedSec,
      overtimeSec,
      reached,
      extra: String(extra || ''),
    },
    check: check || null,
  };
}

/** 渲染模板；模板坏了就退回原文（check 绝不能因为渲染失败拿不到提示词）。 */
export function renderTaskGoalPrompt(ctx, template = TASK_GOAL_PROMPT_TEMPLATE) {
  const src = String(template || '').trim() ? template : TASK_GOAL_PROMPT_TEMPLATE;
  try {
    return renderInstruction(src, ctx);
  } catch {
    return src;
  }
}
