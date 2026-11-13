// repo.doc.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { addRepoDoc as _addRepoDoc } from '../../docs/refs.js';
const addRepoDoc: any = _addRepoDoc;

/** repo.doc.add 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
  ref: z.string().optional().describe("文档 refId（ref_<16hex>）"),
  path: z.string().optional().describe("外部绝对路径（登记成 origin=external 的 ref）"),
  note: z.string().optional().describe("这篇的说明"),
  tag: z.string().optional().describe("分类标签（如 qa；简介行渲染成小 chip；空串 = 清掉）"),
});

export class RepoDocAddAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.doc.add',
    cli: ['repo', 'doc', 'add'],
    http: ['POST', '/api/repos/docs'],
    summary: '给项目加一篇介绍文档：--ref <refId> | --path <外部绝对路径>（同 ref 重复添加 = 更新注解）',
    args: ['id'],
    input,
    render: (d: any) => `已加一篇介绍文档（共 ${d.count} 篇）`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return addRepoDoc(ctx.id, { ref: ctx.ref, path: ctx.path, note: ctx.note, tag: ctx.tag });
  
  }
}
