// localtask.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskRemoveInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskRemoveAction extends ActionBase {
  @action({
    id: 'localtask.remove',
    cli: ['localtask', 'remove'],
    http: ['DELETE', '/api/localtasks/item'],
    summary: '删除一条任务（按 --id，定位到 --cwd 主题或 --key）；删除是**可恢复**的（软删除），加 --purge 彻底清除',
    input: localtaskRemoveInput,
    render: (d: any) =>
      d.purged
        ? `已彻底删除主题「${d.name}」#${d.removed.id}: ${d.removed.text}（不可恢复）`
        : `已删除主题「${d.name}」#${d.removed.id}: ${d.removed.text}（可用 localtask task restore 恢复）`,
  })
  async remove(ctx: any) {

      return service.removeTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key, purge: ctx.purge });
  
  }
}
