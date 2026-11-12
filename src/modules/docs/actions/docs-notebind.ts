// docs.notebind —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as refsNs from '../refs.js';
import { renderNoteRef as _renderNoteRef } from '../render.js';
const refs: any = refsNs;
const renderNoteRef: any = _renderNoteRef;

/** docs.notebind 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  board: z.string(),
  repo: z.string().describe("仓库（id / key / 路径 / 名称）"),
  rel: z.string().optional().describe("自有树内路径"),
  path: z.string().optional().describe("外部文件/目录绝对路径（只读）"),
  reset: z.boolean().optional().describe("拆掉覆盖，回到约定路径"),
});

export class DocsNotebindAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.notebind',
    cli: ['docs', 'note-bind'],
    // 仅 CLI：成员描述覆盖同理，绑定走约定路径推导；前端加绑/解绑走宿主文档集接口
    summary: '绑定组内仓库描述的文档覆盖（--board <看板> --repo <仓库> + --rel/--path/--reset；仓库须为该组成员）',
    args: ['board'],
    input,
    render: renderNoteRef,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return refs.setNoteDocRef(ctx);
  
  }
}
