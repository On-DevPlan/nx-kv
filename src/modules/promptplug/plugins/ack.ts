// ack 段（order 70 / get 链）：完成回填指令。
//
// 一个段一个文件：正文就是这个类里的 BUILTIN（#152 起正文进代码，一个模板一个文件）。
// 只管「怎么交差」——完成总结该按什么格式写、用哪条命令回填。
import { z } from 'zod';
import { PromptPlugin, type TemplateText } from '../base.js';
import { taskShape } from './goal-shape.js';

const schema = z.strictObject({ task: taskShape });

const BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `完成之后必须调用 nx-kv localtask done --id {{task.id}} --summary "<完成总结>" 汇报结果。`,
};

export class AckPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'ack';
  readonly order = 70;
  readonly group = 'get' as const;
  readonly tag = 'nx-kv.ack';
  readonly label = 'ack 完成总结';
  readonly dataSchema = schema;
  readonly templates = [BUILTIN];

  constructor(template = '') { super(template); }
  protected buildData() { return {} as never; }
}
