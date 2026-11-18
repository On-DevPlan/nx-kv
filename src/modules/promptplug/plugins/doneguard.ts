// doneguard 段（order 50 / done 链）：未到点不许 done 的拦截文案。
//
// 一个段一个文件：正文就是这个类里的 BUILTIN。
// 条件渲染（goal.blocked）——时间没到才输出，到了就整段消失。
import { z } from 'zod';
import { PromptPlugin, type TemplateText } from '../base.js';
import { goalShape, taskShape } from './goal-shape.js';

const schema = z.strictObject({ goal: goalShape, task: taskShape });

const BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `{{#if goal.blocked}}
〔完成门禁 · 时间未到〕任务 #{{task.id}} 还不能 done：持续 {{goal.durationHuman}}，已过 {{goal.elapsedHuman}}（{{percent goal.elapsedSec goal.durationSec}}%），剩余 {{goal.remainingHuman}}。
- 现在可做：{{#if (gte (percent goal.elapsedSec goal.durationSec) 67)}}收尾整理（收敛改动 / 补验证 / 写清遗留），或派 sub agent 提出新的需求继续推进{{else}}继续推进主线，并派 sub agent 重新提出新的需求{{/if}}。
{{#if (and goal.checks (lte goal.sinceLastCheckSec 600))}}
⚠️ 严重警告：距上次检查不到 10 分钟就想 done——这轮几乎没有新进展。禁止 sleep / 空转等待：派一个 sub agent 找一个**全新的切入角度**（换模块 / 换验证方式 / 补测试 / 收尾整理），拿新产出再来。
{{/if}}
- 每轮推进先跑：nx-kv timegoal check --task {{goal.goalKey}} --summary "<本轮现状>"
- 到点后再：nx-kv localtask done --id {{task.id}} --summary "<完成总结>"
{{/if}}`,
};

export class DoneguardPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'doneguard';
  readonly order = 50;
  readonly group = 'done' as const;
  readonly tag = 'nx-kv.doneguard';
  readonly label = '完成门禁提示（timegoal）';
  readonly dataSchema = schema;
  readonly templates = [BUILTIN];

  constructor(template = '') { super(template); }
  protected buildData() { return {} as never; }
}
