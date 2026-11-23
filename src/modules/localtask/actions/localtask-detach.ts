// localtask.detach —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { renderDetach as _renderDetach } from '../ui/action-render.js';
const renderDetach: any = _renderDetach;

/** localtask.detach 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  attachment: z.string().describe("资源 id（见 localtask attachments）"),
});

export class LocaltaskDetachAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.detach',
    cli: ['localtask', 'detach'],
    http: ['DELETE', '/api/localtasks/attach'],
    summary: '解除任务与附件的关系（#189：只解除关联，资源进孤儿池；清理走库级 GC，不在这里删资源）',
    input,
    render: renderDetach,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const { detachTaskAttachment } = await (import('../ops/attach.js') as any);
        return detachTaskAttachment({
          id: ctx.id,
          cwd: ctx.cwd,
          key: ctx.key,
          attachment: ctx.attachment,
        });
    
  }
}
