// file.content —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { fileContentInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class FileContentAction extends ActionBase<typeof fileContentInput> {
  @action({
    id: 'file.content',
    cli: ['file', 'content'],
    http: ['GET', '/api/file/content/:fileId'],
    summary: '取附件本体：面板内联预览；CLI 打印出图地址与本地路径',
    args: ['fileId'],
    input: fileContentInput,
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
