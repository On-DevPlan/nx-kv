// docs.notebind —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { docsNotebindInput } from '../schemas.js';
import * as refsNs from '../refs.js';
import { renderNoteRef as _renderNoteRef } from '../render.js';
const refs: any = refsNs;
const renderNoteRef: any = _renderNoteRef;

export class DocsNotebindAction extends ActionBase {
  @action({
    id: 'docs.notebind',
    cli: ['docs', 'note-bind'],
    http: ['POST', '/api/docs/note-bind'],
    summary: '绑定组内仓库描述的文档覆盖（--board <看板> --repo <仓库> + --rel/--path/--reset；仓库须为该组成员）',
    args: ['board'],
    input: docsNotebindInput,
    render: renderNoteRef,
  })
  async notebind(ctx: any) {

      return refs.setNoteDocRef(ctx);
  
  }
}
