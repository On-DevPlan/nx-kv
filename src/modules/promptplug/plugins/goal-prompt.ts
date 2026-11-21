// 任务级 timegoal 的提示词模板（任务 #87）——**领取交付**与**每轮 check** 的同源代码。
//
// 为什么在 promptplug（#227 重构）：模板正文归提示词模板体系（出厂正文 / 兜底文案
// 都在 promptplug/plugins/ 下）；taskgoal-store（领取路径）与 timegoal-task-store
// （check 路径）作为 goals 域宿主从这里取用——依赖方向单一（goals → promptplug），
// 两边变量口径永远一致，也不再依赖「模板夹在两个互相 import 的 store 之间」来防环。
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
//   {{check.summary}} {{check.at}} {{check.count}}（仅 check 渲染时）
import { formatDuration, renderInstruction } from '../../../core/instruction-template.js';

export const TASK_GOAL_PROMPT_TEMPLATE = [
  '本任务带时间目标（领取即计时，持续 {{goal.durationHuman}}）。',
  '- 每轮推进先执行：nx-kv timegoal check --task {{goal.goalKey}} --summary "<本轮现状>"',
  '- 时间未到不得标记完成——应派出 sub agent 重新提出新的需求，再继续推进。不允许 进行sleep空转, 不允许放弃问题',
  '- check 返回 reached:true 后才允许：nx-kv localtask done --id {{task.id}} --summary "<完成总结>"',
  '{{#if goal.extra}}',
  '附加要求（发布方）：',
  '{{goal.extra}}',
  '{{/if}}',
].join('\n');

/** 戳（本地时间字符串）→ epoch ms。 */
export function stampMsOf(v: unknown): number {
  if (typeof v === 'number') return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(v || ''));
  if (!m) return NaN;
  return new Date(Number(m?.[1]), Number(m?.[2]) - 1, Number(m?.[3]), Number(m?.[4]), Number(m?.[5]), Number(m?.[6])).getTime();
}

/** epoch ms → 本地时间戳（与 timegoal 存储的 stamp 同格式）。 */
export function stampOfMs(ms: unknown): string {
  if (!Number.isFinite(Number(ms))) return '';
  const d = new Date(Number(ms));
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export interface TaskGoalTemplateCtxInput {
  taskId: unknown;
  taskText: unknown;
  goalKey: unknown;
  durationSec: unknown;
  extra?: unknown;
  startedAt: unknown;
  deadline: unknown;
  nowMs?: unknown;
  check?: unknown;
  /** 本轮**之前**的检查流水（旧→新，不含本次；check 路径查 goal_checks 传入） */
  history?: GoalCheckRecord[];
}

/** 单条检查流水的仓库层形状（goal_checks 行的最小集）。 */
export interface GoalCheckRecord {
  atMs: number;
  elapsedSec: number;
  remainingSec: number;
  overtimeSec: number;
  reached: boolean;
  summary: string;
}

/** goal 模板渲染的 ctx（领取 / check 共用同一构造，保证两处变量口径一致）。 */
export function taskGoalTemplateCtx({ taskId, taskText, goalKey, durationSec, extra, startedAt, deadline, nowMs, check, history }: TaskGoalTemplateCtxInput): Record<string, any> {
  const dur = Number(durationSec) || 0;
  const startMs = typeof startedAt === 'number' ? startedAt : stampMsOf(startedAt);
  const endMs = typeof deadline === 'number' ? deadline : stampMsOf(deadline);
  const now = Number(nowMs) || Date.now();
  const remainingSec = Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - now) / 1000)) : 0;
  const overtimeSec = Number.isFinite(endMs) ? Math.max(0, Math.round((now - endMs) / 1000)) : 0;
  const elapsedSec = Number.isFinite(startMs) ? Math.max(0, Math.round((now - startMs) / 1000)) : 0;
  const reached = Number.isFinite(endMs) ? now >= endMs : false;
  // #161：check 历史（本轮**之前**的流水，旧→新）+ 距上次检查秒数——
  // 模板据此做「重复检查太频繁 → 严重警告（防 AI 死胡同空转 sleep）」的分支。
  const hist = Array.isArray(history) ? history : [];
  const lastMs = hist.length ? Number(hist[hist.length - 1]?.atMs) : NaN;
  const sinceLastCheckSec = hist.length && Number.isFinite(lastMs) && Number.isFinite(now)
    ? Math.max(0, Math.round((now - lastMs) / 1000))
    : undefined;
  return {
    task: { id: taskId, text: String(taskText || '') },
    goal: {
      checks: hist.length
        ? hist.map((c) => ({
            at: stampOfMs(Number(c.atMs)),
            elapsedSec: Number(c.elapsedSec) || 0,
            remainingSec: Number(c.remainingSec) || 0,
            overtimeSec: Number(c.overtimeSec) || 0,
            reached: !!c.reached,
            summary: String(c.summary || ''),
          }))
        : undefined,
      ...(sinceLastCheckSec !== undefined ? { sinceLastCheckSec } : {}),
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
export function renderTaskGoalPrompt(ctx: unknown, template: unknown = TASK_GOAL_PROMPT_TEMPLATE): string {
  const src = String(template || '').trim() ? template : TASK_GOAL_PROMPT_TEMPLATE;
  try {
    return renderInstruction(src, ctx);
  } catch {
    return src as string;
  }
}

// ── #161：出厂正文已搬进 timecheck 段模板（promptplug），goals.prompt 只存「用户自定义」──
//
// 旧 goal 行落库里存的出厂原文（TASK_GOAL_PROMPT_TEMPLATE）不再视为自定义——
// 否则段模板编辑会被 goal.check 双层遮住、对旧行永远失效。出厂原文 → 走段模板。

/** 落库的 goals.prompt 里「用户自定义」的部分：空 / 出厂原文 → ''（正文走 timecheck 段模板）。 */
export function customGoalPromptOf(v: unknown): string {
  const s = String(v ?? '').trim();
  return s && s !== TASK_GOAL_PROMPT_TEMPLATE.trim() ? String(v) : '';
}

/** 只渲染用户自定义 prompt（没有 → ''；渲染失败退回原文——自定义是发布方的硬要求，宁可原文也不吞）。 */
export function renderCustomGoalPrompt(ctx: unknown, template: unknown): string {
  const src = customGoalPromptOf(template);
  if (!src) return '';
  try {
    return renderInstruction(src, ctx);
  } catch {
    return src;
  }
}
