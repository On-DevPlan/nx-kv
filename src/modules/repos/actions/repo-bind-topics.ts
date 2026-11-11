// repo.bind-topics —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** repo.bind-topics 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  repo: z.string().optional().describe("仓库 id / key / 路径 / 名称（缺省 = 全部登记仓库）"),
  apply: z.boolean().optional().describe("真正落盘（省略 = 只预览命中计划）"),
});

export class RepoBindTopicsAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.bind-topics',
    cli: ['repo', 'bind-topics'],
    http: ['POST', '/api/repos/bind-topics'],
    summary: '把「未绑定」队列按路径前缀绑到真实仓库（先建 refs 再绑；默认预览，--apply 落盘）',
    input,
    render: (d: any) => {
      const lines: any = [
        `${d.apply ? '已绑定' : '绑定预览（未落盘）'}: 扫描 ${d.scanned} 条未绑定队列，命中 ${d.bound.length} 条`,
      ];
      for (const b of d.bound) lines.push(`  ${b.topicKey}  ${b.cwd || b.name} → ${b.repoName}（${b.repoKey}）`);
      if (d.left.length) {
        lines.push(`留在哨兵（对不上任何仓库路径）: ${d.left.length} 条`);
        for (const t of d.left.slice(0, 10)) lines.push(`  ${t.topicKey}  ${t.cwd || '(全局池)'}`);
      }
      if (d.refs) lines.push(`refs 索引: 新增 ${d.refs.refs} / 约定绑定 ${d.refs.bindings}`);
      if (!d.apply && d.bound.length) lines.push('', '落盘: nx-kv repo bind-topics --apply');
      return lines.join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.bindTopicsToRepos({ repo: ctx.repo, apply: !!ctx.apply });
  
  }
}
