// repo.bind-topics —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoBindTopicsInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class RepoBindTopicsAction extends ActionBase {
  @action({
    id: 'repo.bind-topics',
    cli: ['repo', 'bind-topics'],
    http: ['POST', '/api/repos/bind-topics'],
    summary: '把「未绑定」队列按路径前缀绑到真实仓库（先建 refs 再绑；默认预览，--apply 落盘）',
    input: repoBindTopicsInput,
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
  async bindTopics(ctx: any) {

      return service.bindTopicsToRepos({ repo: ctx.repo, apply: !!ctx.apply });
  
  }
}
