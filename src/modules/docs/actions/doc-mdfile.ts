// doc.mdfile —— 读一个本地 md 文件的正文（读时校验指纹）。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { readDocMdfile } from '../mdfile.js';

const input = z.object({
  attachment: z.string().describe('mdfile 的附件 id（见 docs mdfiles）'),
});

export class DocMdfileAction extends ActionBase<typeof input> {
  @action({
    id: 'doc.mdfile',
    cli: ['docs', 'mdfile'],
    http: ['GET', '/api/docs/mdfile'],
    summary: '读本地 md 文件的正文（只读原文件，核对指纹；文件缺失时返回空正文并标 missing）',
    args: ['attachment'],
    input,
    render: (d: { body: string; missing: boolean; stale: boolean; absPath: string }) => {
      if (d.missing) return `(文件不存在: ${d.absPath})`;
      const head = d.stale ? `(内容已变化，以下为磁盘当前内容: ${d.absPath})\n\n` : '';
      return head + (d.body || '(空)');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return readDocMdfile(ctx);
  }
}
