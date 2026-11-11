// repo.knowledge —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoKnowledge as _repoKnowledge } from '../../docs/knowledge.js';
const repoKnowledge: any = _repoKnowledge;

/** repo.knowledge 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string().optional(),
  md: z.boolean().optional().describe("输出拼装好的单篇 markdown（字段名 md），get 封装直接可用"),
});

export class RepoKnowledgeAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.knowledge',
    cli: ['repo', 'knowledge'],
    http: ['GET', '/api/repos/knowledge'],
    summary: '取仓库完整知识：项目介绍 + 所属组（介绍/组内描述/绑定文档）+ 参考仓库（--md 拼成单篇 markdown；缺省当前目录）',
    args: ['id'],
    input,
    render: (d: any) => {
      if (d.md) return d.md;
      const lines: any = [`【${d.repo.name}】${d.repo.key}${d.repo.desc ? `  —— ${d.repo.desc}` : ''}`];
      if (d.intro && !d.intro.missing) lines.push(`  介绍: ${d.intro.docId}${d.intro.title ? `「${d.intro.title}」` : ''}`);
      else lines.push('  介绍:（还没有文档——desc 会在首次读取时播种为 md）');
      for (const b of d.boards) {
        lines.push(`  ◇ 组「${b.name}」`);
        if (b.intro && !b.intro.missing) lines.push(`    组介绍: ${b.intro.docId}`);
        if (b.note && !b.note.missing) lines.push(`    组内描述: ${b.note.docId}`);
        for (const l of b.docLinks) lines.push(`    绑定: ${l.docId}${l.tag ? `  [${l.tag}]` : ''}${l.note ? `  · ${l.note}` : ''}${l.missing ? '（缺失）' : ''}`);
        for (const x of b.externalDirs) lines.push(`    外部目录: ${x.path}（${x.files.length} 个文档，按需读盘）`);
      }
      if (d.refRepos.length) {
        lines.push('  参考仓库:');
        for (const r of d.refRepos) lines.push(`    ${r.name}${r.remote ? `（${r.remote}）` : ''}${r.note ? ` —— ${r.note.split('\n')[0]}` : ''}`);
      }
      for (const w of d.warnings) lines.push(`⚠ ${w}`);
      return lines.join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return repoKnowledge(ctx.id || process.cwd(), { md: ctx.md === true });
  
  }
}
