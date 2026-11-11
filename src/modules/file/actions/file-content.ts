// file.content —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** file.content 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  fileId: z.string(),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

export class FileContentAction extends ActionBase<typeof input> {
  @action({
    id: 'file.content',
    cli: ['file', 'content'],
    http: ['GET', '/api/file/content/:fileId'],
    summary: '取附件本体：面板内联预览；CLI 打印出图地址与本地路径',
    args: ['fileId'],
    input,
    render: (d: any) => service.renderContent(d),
    stream: true,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    // stream：req/res/url 由 ApiRouter 在 zod parse 之后塞进 input.__raw
    //（运行时注入，不在公共契约 schema 里——这里做局部展开让 __raw 可见）
    const raw = ctx as typeof ctx & { __raw?: unknown };
    return (raw.__raw
        ? service.serveContent(raw)
        : service.getFileAction(ctx.fileId, { group: ctx.group }));

  }
}
