// localtask.prune —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskPruneInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskPruneAction extends ActionBase {
  @action({
    id: 'localtask.prune',
    cli: ['localtask', 'prune'],
    http: ['POST', '/api/localtasks/prune'],
    summary: '清理旧脏数据（旧模型无目录主题、空主题；等待中一律保留）',
    input: localtaskPruneInput,
    render: (d: any) => {
      const head: any = d.dryRun ? '（预演）将清理' : '已清理';
      if (!d.count) return `${head} 0 个主题（无旧脏数据）。`;
      return `${head} ${d.count} 个主题：\n` + d.removed.map((r: any) => `  - [${r.reason}] ${r.name}${r.cwd ? `  ${r.cwd}` : ''}`).join('\n');
    },
  })
  async prune(ctx: any) {

      return service.pruneTopics({ allFinished: ctx['all-finished'], dryRun: ctx['dry-run'] });
  
  }
}
