// template.reorder —— #151：topic 管理页拖拽排序落库。
//
// 契约（zod schema）声明在本文件，业务在服务层。ids 是 newtask 类目模板的
// 完整期望顺序（前端拖完后按新序传进来）；不在 ids 里的行被挪到末尾。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** template.reorder 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ids: z.array(z.string()).describe("模板 id 的完整有序数组（CLI 用 --ids a,b,c 逗号分隔）"),
});

export class TemplateReorderAction extends ActionBase<typeof input> {
  @action({
    id: 'template.reorder',
    cli: ['template', 'reorder'],
    http: ['PATCH', '/api/templates/reorder'],
    summary: '调整任务模板顺序（--ids a,b,c 按新序落库 sort_order；未列出的模板保持原位）',
    input,
    render: (d: any) => `模板顺序已更新（共 ${(d.templates || []).length} 条）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.reorderTemplates({ ids: ctx.ids });
  }
}
