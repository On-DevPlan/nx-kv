// repo.doc.remove —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoDocRemoveInput } from '../schemas.js';
import { removeRepoDoc as _removeRepoDoc } from '../../docs/refs.js';
const removeRepoDoc: any = _removeRepoDoc;

export class RepoDocRemoveAction extends ActionBase {
  @action({
    id: 'repo.doc.remove',
    cli: ['repo', 'doc', 'remove'],
    http: ['DELETE', '/api/repos/docs'],
    summary: '从项目的介绍文档集里摘掉一篇（--index 从 1 起，1 = 主篇）',
    args: ['id'],
    input: repoDocRemoveInput,
    render: () => `已摘掉一篇介绍文档`,
  })
  async remove(ctx: any) {

      return removeRepoDoc(ctx.id, ctx.index);
  
  }
}
