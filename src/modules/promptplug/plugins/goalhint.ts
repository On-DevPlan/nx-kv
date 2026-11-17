// goalhint 段（order 40 / check 链）：时间目标的可算上下文（进度百分比 / 该收口还是继续）。
//
// 一个段一个文件：正文就是这个类里的 BUILTIN。
import { z } from 'zod';
import { PromptPlugin, type TemplateText } from '../base.js';
import { goalShape, taskShape } from './goal-shape.js';

const schema = z.strictObject({ goal: goalShape, task: taskShape });

const BUILTIN: TemplateText = {
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

export class GoalhintPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'goalhint';
  readonly order = 40;
  readonly group = 'check' as const;
  readonly tag = 'nx-kv.goalhint';
  readonly label = '特殊功能提示（timegoal）';
  readonly dataSchema = schema;
  readonly templates = [BUILTIN];

  constructor(template = '') { super(template); }
  protected buildData() { return {} as never; }
}
