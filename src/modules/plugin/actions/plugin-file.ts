// plugin.file —— 给插件页读项目文件（只允许已登记 repo，限制大小，二进制不返回正文）。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { readRepoFile } from '../fs.js';

const input = z.object({
  repoKey: z.string().describe('仓库 key'),
  path: z.string().describe('仓库内相对文件路径'),
  maxBytes: z.number().int().optional().describe('最多读取字节数（默认 256KB，上限 1MB）'),
});

export class PluginFileAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.file',
    cli: ['plugin', 'file'],
    http: ['GET', '/api/plugins/file'],
    summary: '读取已登记仓库内的文件（插件页用；二进制/超大文件会标记）',
    input,
    render: (d: any) => {
      if (d?.binary) return `[binary] ${d.path}  ${d.size} bytes`;
      return String(d?.content || '');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return readRepoFile(ctx);
  }
}
