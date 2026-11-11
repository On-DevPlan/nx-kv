// repo.scan —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoScanInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { lastSeg as _lastSeg } from '../cli/render.js';
const service: any = serviceNs;
const lastSeg: any = _lastSeg;

export class RepoScanAction extends ActionBase {
  @action({
    id: 'repo.scan',
    cli: ['repo', 'scan'],
    http: ['POST', '/api/repos/scan'],
    summary: '扫描目录发现 git 仓库；--dry-run 只列出（发现模式，不登记）',
    args: ['root'],
    input: repoScanInput,
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
  async scan(ctx: any) {

      return service.scanRepos(ctx.root || process.cwd(), ctx.depth, { dryRun: ctx['dry-run'] === true });
  
  }
}
