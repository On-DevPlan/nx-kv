// repo.doc.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoDocAddInput } from '../schemas.js';
import { addRepoDoc as _addRepoDoc } from '../../docs/refs.js';
const addRepoDoc: any = _addRepoDoc;

export class RepoDocAddAction extends ActionBase {
  @action({
    id: 'repo.doc.add',
    cli: ['repo', 'doc', 'add'],
    http: ['POST', '/api/repos/docs'],
    summary: '给项目加一篇介绍文档：--rel 自有树路径 / --path 外部绝对路径 / --ref <参考仓库key> --file <仓库内相对路径>（同 rel/path 重复添加 = 更新）',
    args: ['id'],
    input: repoDocAddInput,
    render: (d: any) => `已加一篇介绍文档（共 ${d.count} 篇）`,
  })
  async add(ctx: any) {

      return addRepoDoc(ctx.id, { rel: ctx.rel, path: ctx.path, ref: ctx.ref, file: ctx.file, note: ctx.note, tag: ctx.tag });
  
  }
}
