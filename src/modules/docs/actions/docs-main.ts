// docs.main —— 把某一篇设为宿主的**主篇**（#144）。
//
// 与 docs.bind 的分工：
//   · `docs bind` 是「指定主篇指针」的老命令，只换指针、不动附加篇（CLI 专用）；
//   · `docs main` 是**换位**：目标从附加篇摘出、原主篇退回附加篇，两边都不丢归属。
//     面板的「⋯ → 设为主篇」走这条（面板只认真实语义，不制造孤儿文档）。
//
// 宿主：`--repo <仓库>` 或 `--board <组>`（二选一）；目标是 `--ref <refId>` 或 `--path`。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as refsNs from '../refs.js';
const refs: any = refsNs;

/** docs.main 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  repo: z.string().optional().describe('仓库（id / key / 名称）——与 --board 二选一'),
  board: z.string().optional().describe('项目组（id / key / 名称）——与 --repo 二选一'),
  ref: z.string().optional().describe('文档 refId（ref_<16hex>）'),
  path: z.string().optional().describe('外部文件绝对路径（会登记成 origin=external 的 ref）'),
});

export class DocsMainAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.main',
    cli: ['docs', 'main'],
    http: ['POST', '/api/docs/main'],
    summary: '把某一篇设为主篇：原主篇退回附加篇（不丢归属），目标从附加篇摘出（不会出现两份）',
    input,
    render: (d: any) => (
      d && d.alreadyMain
        ? `已经是主篇: ${d.name}`
        : `已设为主篇: ${d.name}（原主篇${d.previous ? ` ${d.previous} ` : ' '}退回附加篇；列表共 ${d.count} 篇）`
    ),
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return refs.setDocMain(ctx);
  }
}
