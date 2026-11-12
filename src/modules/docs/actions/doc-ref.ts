// doc.ref.add —— 新建一个直接 ref（desc + 归属），不涉及任何文件 / 路径。
//
// 口径（v7 / 任务 #97）：ref 是 DB 实体（refs + ref_bodies + ref_bindings），
// 身份就是 refId；新建时只给 desc 与宿主，正文为空、可立即编辑。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { createRef as _createRef } from '../service.js';

const createRef: any = _createRef;

/** doc.ref.add 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  desc: z.string().optional().describe('短描述（列表 / 提示词模板的快速定位标签）'),
  owner: z.enum(['repo', 'group', 'group_repo']).optional().describe('归属类型：仓库 / 组 / 组下的仓库'),
  repo: z.string().optional().describe('仓库 locator（id / key / 名称；owner=repo 或 group_repo 时必填）'),
  group: z.string().optional().describe('组 locator（id / key / 名称；owner=group 或 group_repo 时必填）'),
});

export class DocRefAddAction extends ActionBase<typeof input> {
  @action({
    id: 'doc.ref.add',
    cli: ['docs', 'ref', 'add'],
    http: ['POST', '/api/docs/ref'],
    summary: '新建文档条目（desc + 归属；正文为空、直接可编辑；不创建任何文件）',
    input,
    render: (d: any) =>
      `已新建 ${d.refId}${d.desc ? `「${d.desc}」` : ''}` +
      (d.bindings?.length
        ? `\n归属: ${d.bindings.map((b: any) => `${b.type}${b.groupKey ? '@' + b.groupKey : ''}`).join('、')}`
        : ''),
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return createRef({ desc: ctx.desc, owner: ctx.owner, repo: ctx.repo, group: ctx.group });
  }
}
