// timecheck 段（order 30 / check 链，**该链唯一段**）：时间目标进度 + 每轮检查提醒。
//
// #161 用户口径三段化（get 一段介绍 / check 一段进度 / done 一段拦截）——原
// timecheck（壳 {{goal.check}}）与 goalhint（进度行）合并成这一段。判据
// goal.goalKey（任务级 goal）；目录级目标只有 statusLine 一行。
import { z } from 'zod';
import { PromptPlugin, type TemplateText } from '../base.js';
import { goalShape, taskShape } from './goal-shape.js';

const schema = z.strictObject({ goal: goalShape, task: taskShape });

const BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `{{#if goal.goalKey}}
〔时间目标〕任务 #{{task.id}} 正在计时：持续 {{goal.durationHuman}}，已过 {{goal.elapsedHuman}}（{{percent goal.elapsedSec goal.durationSec}}%），{{#if goal.reached}}已到点（超时 {{formatDuration goal.overtimeSec}}）{{else}}剩余 {{goal.remainingHuman}}{{/if}}。
{{#if goal.reached}}——时间已到：可以收口，把改动收敛成可交付状态，补验证与说明后按 ack 段 done。
{{else}}{{#if (gte (percent goal.elapsedSec goal.durationSec) 67)}}——已过 2/3：进入收尾整理（收敛改动 / 补验证 / 写清遗留），别开新战线。
{{else}}{{#if (gte (percent goal.elapsedSec goal.durationSec) 50)}}——已过半：先确认主线走到哪，剩余时间只做收尾必需项。
{{else}}——时间尚足：先做主线，再补细节。{{/if}}{{/if}}{{/if}}
{{#if (and goal.checks (lte goal.sinceLastCheckSec 600))}}
⚠️ 严重警告：距上次检查不到 10 分钟（{{formatDuration goal.sinceLastCheckSec}}）——你极可能已经走进死胡同在原地打转，甚至开始调用 sleep 空转。立即停止当前路径：派一个 sub agent 去找一个**全新的切入角度**（换模块 / 换验证方式 / 补测试 / 整理交付），用新产出来填这一轮；而不是重复汇报同样的现状。
{{/if}}
- 每轮检查照旧执行：nx-kv timegoal check --task {{goal.goalKey}} --summary "<本轮现状>"
{{#if goal.extra}}
附加要求（发布方）：
{{goal.extra}}
{{/if}}
{{/if}}
{{#if goal.statusLine}}
{{goal.statusLine}}
{{/if}}`,
};

export class TimecheckPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'timecheck';
  readonly order = 30;
  readonly group = 'check' as const;
  readonly tag = 'nx-kv.timecheck';
  readonly label = '时间目标检查';
  readonly dataSchema = schema;
  readonly templates = [BUILTIN];

  constructor(template = '') { super(template); }
  protected buildData() { return {} as never; }
}
