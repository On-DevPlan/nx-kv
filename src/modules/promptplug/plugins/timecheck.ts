// timegoal 段（order 65 / get 链）：时间目标**启动介绍**（#161 用户口径三段化——
// get 一段介绍、check 一段进度、done 一段拦截）。
//
// 一个段一个文件：正文就是这个类里的 BUILTIN。出厂指令完整写在正文里（所见即所得）；
// goal.check 只装用户自定义 prompt（timegoal set/update --prompt），有值时整体替换。
import { z } from 'zod';
import { PromptPlugin, type TemplateText } from '../base.js';
import { goalShape, taskShape } from './goal-shape.js';

const schema = z.strictObject({ goal: goalShape, task: taskShape });

// 出厂指令正文（#161）：完整写在段模板里——设置页所见即所得，编辑这里的正文
// 对 get 交付与 timegoal check CLI 同时生效（CLI 的「本轮提示词」也走这条链渲染）。
// goal.check 只装「用户自定义的 per-goal 提示词」（timegoal set/update --prompt），
// 出厂模板不再落库到 goals.prompt（落库原文 ≠ 自定义），没有自定义就走下面的正文。
const BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `{{#if goal.check}}
{{goal.check}}
{{else}}{{#if goal.goalKey}}
〔时间目标 · 启动〕本任务领取即计时，持续 {{goal.durationHuman}}（截止 {{goal.deadline}}）。
- 每轮推进先执行：nx-kv timegoal check --task {{goal.goalKey}} --summary "<本轮现状>"
- 时间未到不得标记完成——应派出 sub agent 重新提出新的需求，再继续推进。
- check 返回 reached:true 后才允许：nx-kv localtask done --id {{task.id}} --summary "<完成总结>"
{{#if goal.extra}}
附加要求（发布方）：
{{goal.extra}}
{{/if}}
{{/if}}{{/if}}`,
};

export class TimegoalPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'timegoal';
  readonly order = 65;
  readonly group = 'get' as const;
  readonly tag = 'nx-kv.timegoal';
  readonly label = '时间目标启动';
  readonly dataSchema = schema;
  readonly templates = [BUILTIN];

  constructor(template = '') { super(template); }
  protected buildData() { return {} as never; }
}
