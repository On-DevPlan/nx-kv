// repo.ref.note —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoRefNoteInput } from '../schemas.js';
import * as refNs from '../ref.js';
const ref: any = refNs;

export class RepoRefNoteAction extends ActionBase<typeof repoRefNoteInput> {
  @action({
    id: 'repo.ref.note',
    cli: ['repo', 'ref', 'note'],
    http: ['POST', '/api/repos/ref/note'],
    summary: '写/清绑定描述：这个参考在该组/该仓库里参考什么（--note 留空 = 清除）',
    args: ['id'],
    input: repoRefNoteInput,
    render: (d: any) => `${d.note ? '已写' : '已清除'}绑定描述: ${d.name} @ ${d.group ? `组「${d.group}」` : `仓库「${d.repo}」`}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return ref.setLinkNote(ctx);
  
  }
}
