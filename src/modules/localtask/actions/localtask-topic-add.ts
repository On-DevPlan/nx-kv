// localtask.topic.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.topic.add 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  cwd: z.string().describe("工作目录（绝对路径或可解析的相对路径）"),
  summary: z.string().optional().describe("现状摘要（可选；已登记目录即更新）"),
});

export class LocaltaskTopicAddAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.topic.add',
    cli: ['localtask', 'topic', 'add'],
    http: ['POST', '/api/localtasks/topic'],
    summary: '登记一个工作目录：空目录也常驻（prune 不清）；--summary 顺带写「现状摘要」（面板顶栏摘要的编辑入口）',
    input,
    render: (d: any) =>
      `${d.existed ? '已更新' : '已登记'}目录「${d.name}」${d.cwd}` +
      (d.existed ? '（原先已存在）' : ''),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.addTopic({ cwd: ctx.cwd, summary: ctx.summary });
  
  }
}
