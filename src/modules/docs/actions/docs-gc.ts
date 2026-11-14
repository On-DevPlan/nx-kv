// docs.gc —— 清理没有正文的 ref（#114）。
//
// 口径：refs 行在、正文缺失或为空 → 这些条目在列表里只能标「无正文」，没有任何用途。
// 默认 **dry-run**（只报数量与 refId），`--apply` 才真删；删除前会先清掉宿主 ext 里
// 指向它们的主篇 / 文档集引用（否则「项目介绍」会指向一个不存在的 ref）。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { gcEmptyDocs as _gcEmptyDocs } from '../gc.js';
const gcEmptyDocs: any = _gcEmptyDocs;

/** docs.gc 的入参契约（CLI 与 HTTP 共用）。 */
const input = z.object({
  apply: z.boolean().optional().describe('真的删除（缺省 = 只列数量，不动数据）'),
});

export class DocsGcAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.gc',
    cli: ['docs', 'gc'],
    http: ['POST', '/api/docs/gc'],
    summary: 'GC 没有正文的文档（默认只报数；--apply 真删，并清掉宿主里指向它们的主篇/文档集引用）',
    input,
    render: (d: any) =>
      d.dryRun
        ? `将删除 ${d.count} 篇没有正文的文档（未落盘；加 --apply 执行）`
        : `已删除 ${d.count} 篇没有正文的文档${d.touchedHosts ? `，清理宿主引用 ${d.touchedHosts} 处` : ''}${d.failed?.length ? `；失败 ${d.failed.length} 篇` : ''}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return gcEmptyDocs({ apply: ctx.apply === true });
  }
}
