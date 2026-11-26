// repo.dirs —— 列已登记仓库下某目录的子目录（只读；#276 面包屑选子目录）。
//
// 守卫在服务层（repos/service/dirs.ts）：路径必须落在已登记仓库内。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as dirsNs from '../service/dirs.js';
const dirs: any = dirsNs;

/** repo.dirs 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  path: z.string().describe('要列子目录的绝对路径（必须落在已登记仓库内）'),
});

export class RepoDirsAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.dirs',
    cli: ['repo', 'dirs'],
    http: ['GET', '/api/repos/dirs'],
    summary: '列已登记仓库下某目录的子目录（只读；面包屑选子目录用）',
    args: ['path'],
    input,
    render: (d: any) => {
      if (d.error) return `无法列目录: ${d.error}`;
      if (!d.dirs.length) return `（没有子目录）${d.path}`;
      return [`${d.path}`, ...d.dirs.map((x: any) => `  ${x.name}`)].join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    try {
      const r = await dirs.listRepoDirs(ctx.path);
      return { path: r.path, dirs: r.dirs };
    } catch (e) {
      return { path: ctx.path, dirs: [], error: (e as Error).message || String(e) };
    }
  }
}
