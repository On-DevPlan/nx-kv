// localtask.detach —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { localtaskDetachInput } from '../schemas.js';
import { renderDetach as _renderDetach } from '../action-render.js';
const renderDetach: any = _renderDetach;

export class LocaltaskDetachAction extends ActionBase<typeof localtaskDetachInput> {
  @action({
    id: 'localtask.detach',
    cli: ['localtask', 'detach'],
    http: ['DELETE', '/api/localtasks/attach'],
    summary: '解除任务与附件的关系（默认只解除关系，资源进孤儿池）；--purge 在无人引用时连资源行与本机字节一起删',
    input: localtaskDetachInput,
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
