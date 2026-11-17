// 只读段四插件（timecheck 30 / goalhint 40 → check 链；doneguard 50 / ack 70 → done / get）：
// writes=[]，buildData() 返回空对象——它们只消费 seed（goal / task），
// schema 声明本段模板可见的变量目录（goal.* / task.*），全部 optional +
// nullable：strictObject 对「缺失的 optional」放行、buildData() 返回 {} 合法。
//
// #152：模板正文进代码（templates 列表），group 决定它挂在哪个时机链上。
import { z } from 'zod';
import { PromptPlugin, type TemplateText } from '../base.js';

const goalShape = z.looseObject({
  name: z.string().optional(),
  deadline: z.string().optional(),
  prompt: z.string().optional(),
  durationHuman: z.string().optional(),
  elapsedHuman: z.string().optional(),
  remainingHuman: z.string().optional(),
  elapsedSec: z.number().optional(),
  durationSec: z.number().optional(),
  remainingSec: z.number().optional(),
  overtimeSec: z.number().optional(),
  reached: z.boolean().optional(),
  blocked: z.boolean().optional(),
  goalKey: z.string().optional(),
  extra: z.string().optional(),
  check: z.string().optional(),
  statusLine: z.string().optional(),
}).optional().nullable();

const taskShape = z.looseObject({ id: z.number(), text: z.string() }).optional().nullable();

const TIMECHECK_BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `{{#if goal.check}}
{{goal.check}}
{{/if}}
{{#if goal.statusLine}}
{{goal.statusLine}}
{{/if}}`,
};

const GOALHINT_BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `{{#if goal.check}}
〔特殊功能提示 · 时间目标〕任务 #{{task.id}} 正在计时：持续 {{goal.durationHuman}}，已过 {{goal.elapsedHuman}}（{{percent goal.elapsedSec goal.durationSec}}%），{{#if goal.reached}}已到点（超时 {{formatDuration goal.overtimeSec}}）{{else}}剩余 {{goal.remainingHuman}}{{/if}}。
{{#if goal.reached}}——时间已到：可以收口，把改动收敛成可交付状态，补验证与说明后按 ack 段 done。
{{else}}{{#if (gte (percent goal.elapsedSec goal.durationSec) 67)}}——已过 2/3：进入收尾整理（收敛改动 / 补验证 / 写清遗留），别开新战线。
{{else}}{{#if (gte (percent goal.elapsedSec goal.durationSec) 50)}}——已过半：先确认主线走到哪，剩余时间只做收尾必需项。
{{else}}——时间尚足：先做主线，再补细节。{{/if}}{{/if}}{{/if}}
{{/if}}`,
};

const DONEGUARD_BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `{{#if goal.blocked}}
〔完成门禁 · 时间未到〕任务 #{{task.id}} 还不能 done：持续 {{goal.durationHuman}}，已过 {{goal.elapsedHuman}}（{{percent goal.elapsedSec goal.durationSec}}%），剩余 {{goal.remainingHuman}}。
- 现在可做：{{#if (gte (percent goal.elapsedSec goal.durationSec) 67)}}收尾整理（收敛改动 / 补验证 / 写清遗留），或派 sub agent 提出新的需求继续推进{{else}}继续推进主线，并派 sub agent 重新提出新的需求{{/if}}。
- 每轮推进先跑：nx-kv timegoal check --task {{goal.goalKey}} --summary "<本轮现状>"
- 到点后再：nx-kv localtask done --id {{task.id}} --summary "<完成总结>"
{{/if}}`,
};

const ACK_BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `完成之后必须调用 nx-kv localtask done --id {{task.id}} --summary "<完成总结>" 汇报结果。`,
};

export class TimecheckPlugin extends PromptPlugin<z.ZodObject<z.ZodRawShape>> {
  readonly id = 'timecheck';
  readonly order = 30;
  readonly group = 'check' as const;
  readonly tag = 'nx-kv.timecheck';
  readonly label = '时间目标检查';
  override readonly writes: readonly string[] = [];
  readonly dataSchema = z.strictObject({ goal: goalShape });
  readonly templates = [TIMECHECK_BUILTIN];

  constructor(template = '') { super(template); }
  protected buildData() { return {} as never; }
}

export class GoalhintPlugin extends PromptPlugin<z.ZodObject<z.ZodRawShape>> {
  readonly id = 'goalhint';
  readonly order = 40;
  readonly group = 'check' as const;
  readonly tag = 'nx-kv.goalhint';
  readonly label = '特殊功能提示（timegoal）';
  override readonly writes: readonly string[] = [];
  readonly dataSchema = z.strictObject({ goal: goalShape, task: taskShape });
  readonly templates = [GOALHINT_BUILTIN];

  constructor(template = '') { super(template); }
  protected buildData() { return {} as never; }
}

export class DoneguardPlugin extends PromptPlugin<z.ZodObject<z.ZodRawShape>> {
  readonly id = 'doneguard';
  readonly order = 50;
  readonly group = 'done' as const;
  readonly tag = 'nx-kv.doneguard';
  readonly label = '完成门禁提示（timegoal）';
  override readonly writes: readonly string[] = [];
  readonly dataSchema = z.strictObject({ goal: goalShape, task: taskShape });
  readonly templates = [DONEGUARD_BUILTIN];

  constructor(template = '') { super(template); }
  protected buildData() { return {} as never; }
}

export class AckPlugin extends PromptPlugin<z.ZodObject<z.ZodRawShape>> {
  readonly id = 'ack';
  readonly order = 70;
  readonly group = 'get' as const;
  readonly tag = 'nx-kv.ack';
  readonly label = 'ack 完成总结';
  override readonly writes: readonly string[] = [];
  readonly dataSchema = z.strictObject({ task: taskShape });
  readonly templates = [ACK_BUILTIN];

  constructor(template = '') { super(template); }
  protected buildData() { return {} as never; }
}
