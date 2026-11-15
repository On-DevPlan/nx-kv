// repo.ref.note —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as linkNote from '../link-note.js';
const link: any = linkNote;

/** repo.ref.note 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
  repo: z.string().optional().describe("开发仓库（id/路径/名称）—— 写仓库级绑定的描述"),
  board: z.string().optional().describe("组 id/key/名称（与 --repo 二选一）—— 写组级绑定的描述"),
  note: z.string().optional().describe("绑定描述（多行可含关键路径/关键词；留空 = 清除）"),
});

export class RepoRefNoteAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.ref.note',
    cli: ['repo', 'ref', 'note'],
    http: ['POST', '/api/repos/ref/note'],
    summary:
      '写/清绑定描述：这个参考在该组/该仓库里参考什么（#134：描述归档成该参考仓库的一篇文档，' +
      '在「<参考仓库名> · 文档列表」里可见可编辑；--note 留空 = 清除）',
    args: ['id'],
    input,
    render: (d: any) =>
      `${d.note ? '已写' : '已清除'}绑定描述: ${d.name} @ ${d.group ? `组「${d.group}」` : `仓库「${d.repo}」`}` +
      (d.refId ? `\n文档: ${d.docId || d.refId}（在它的文档列表里）` : ''),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return link.setLinkNote(ctx);
  
  }
}
