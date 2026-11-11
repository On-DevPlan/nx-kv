// todo.attach —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** todo.attach 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ref: z.string().describe("要挂附件的那条任务的内容（整串）"),
  path: z.string().optional().describe("本机文件路径（先上传再嵌入）"),
  fileId: z.string().optional().describe("已上传附件的 id（32 位 hex，可带扩展名）"),
  name: z.string().optional().describe("嵌入文字与本地文件名（默认取原文件名）"),
  kind: z.enum(["image", "file"]).optional().describe("用图片语法还是链接语法（默认按扩展名判断）"),
  accessLevel: z.enum(["public", "private", "protected"]).default('public'),
  topic: z.string().optional().describe("消歧：同内容有多条时用主题收窄"),
  pick: z.number().optional().describe("消歧：同内容多条时按编号选（配合报错里的列表）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class TodoAttachAction extends ActionBase<typeof input> {
  @action({
    id: 'todo.attach',
    cli: ['todo', 'attach'],
    http: ['POST', '/api/todo/attach'],
    summary: '给任务追加附件：--path 上传本机文件，或 --fileId 追加已上传附件，以 markdown 嵌入正文末尾',
    input,
    render: (d: any) => `已给 [${d.task.topic}] 追加附件（${d.kind === 'image' ? '图片' : '附件'}）\n  ${d.markdown}\n  正文: ${d.task.text}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.attachToTask(ctx.ref, ctx);
  
  }
}
