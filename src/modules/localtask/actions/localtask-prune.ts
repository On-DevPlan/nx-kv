// localtask.prune —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.prune 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  'all-finished': z.boolean().optional().describe("连同已全部领取、无待领的主题一起清"),
  'dry-run': z.boolean().optional().describe("只报告将清理哪些，不实际删除"),
});

export class LocaltaskPruneAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.prune',
    cli: ['localtask', 'prune'],
    http: ['POST', '/api/localtasks/prune'],
    summary: '清理旧脏数据（旧模型无目录主题、空主题；等待中一律保留）',
    input,
    render: (d: any) => {
      const head: any = d.dryRun ? '（预演）将清理' : '已清理';
      if (!d.count) return `${head} 0 个主题（无旧脏数据）。`;
      return `${head} ${d.count} 个主题：\n` + d.removed.map((r: any) => `  - [${r.reason}] ${r.name}${r.cwd ? `  ${r.cwd}` : ''}`).join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.pruneTopics({ allFinished: ctx['all-finished'], dryRun: ctx['dry-run'] });
  
  }
}
