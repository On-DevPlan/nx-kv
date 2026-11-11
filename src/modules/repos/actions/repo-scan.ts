// repo.scan —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { lastSeg as _lastSeg } from '../cli/render.js';
const service: any = serviceNs;
const lastSeg: any = _lastSeg;

/** repo.scan 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  root: z.string().optional(),
  depth: z.number().default(3),
  'dry-run': z.boolean().optional().describe("只列出发现的仓库，不登记"),
});

export class RepoScanAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.scan',
    cli: ['repo', 'scan'],
    http: ['POST', '/api/repos/scan'],
    summary: '扫描目录发现 git 仓库；--dry-run 只列出（发现模式，不登记）',
    args: ['root'],
    input,
    render: (d: any) => {
      const head: any = `${d.dryRun ? '发现（未登记）' : '扫描'} ${d.root}: ${d.scanned} 个 git 仓库`;
      if (!d.scanned) return `${head}\n（这个深度下没有找到）`;
      const lines: any = [head];
      for (const r of d.found) {
        lines.push(`  ${r.known ? '已登记' : '未登记'}  ${r.path}${r.name && r.name !== lastSeg(r.path) ? `  (${r.name})` : ''}`);
      }
      if (d.dryRun) {
        lines.push('', `确认要收进来的用: nx-kv repo add <path> --desc "一句话描述"`);
        lines.push('（`repo scan` 不带 --dry-run 会直接登记全部）');
      } else {
        lines.push('', `新登记 ${d.added.length} 个${d.skipped ? `，已在册 ${d.skipped} 个` : ''}`);
      }
      return lines.join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.scanRepos(ctx.root || process.cwd(), ctx.depth, { dryRun: ctx['dry-run'] === true });
  
  }
}
