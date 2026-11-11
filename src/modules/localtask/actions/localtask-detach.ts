// localtask.detach —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { renderDetach as _renderDetach } from '../action-render.js';
const renderDetach: any = _renderDetach;

/** localtask.detach 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  attachment: z.string().describe("资源 id（见 localtask attachments）"),
  purge: z.boolean().optional().describe("连资源行与本机字节一起删（仍被其他任务/文档引用时拒绝删）"),
});

export class LocaltaskDetachAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.detach',
    cli: ['localtask', 'detach'],
    http: ['DELETE', '/api/localtasks/attach'],
    summary: '解除任务与附件的关系（默认只解除关系，资源进孤儿池）；--purge 在无人引用时连资源行与本机字节一起删',
    input,
    render: renderDetach,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const { detachTaskAttachment } = await (import('../../tasktool/attach.js') as any);
        return detachTaskAttachment({
          id: ctx.id,
          cwd: ctx.cwd,
          key: ctx.key,
          attachment: ctx.attachment,
          purge: ctx.purge,
        });
    
  }
}
