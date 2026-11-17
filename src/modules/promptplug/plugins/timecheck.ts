// timecheck 段（order 30 / check 链）：时间目标检查指令 / 状态行。
//
// 一个段一个文件：正文就是这个类里的 BUILTIN。
// 有任务级时间目标时给完整 check 指令；只有目录级目标时给一行状态。
import { z } from 'zod';
import { PromptPlugin, type TemplateText } from '../base.js';
import { goalShape } from './goal-shape.js';

const schema = z.strictObject({ goal: goalShape });

const BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `{{#if goal.check}}
{{goal.check}}
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
