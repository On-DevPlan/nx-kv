// repo.doc.list —— 2026-11-19 归位到 docs 域（实现在 docs/refs.ts 与 docs/knowledge.ts，
// 此前声明留在 repos 造成 repos→docs 的跨域依赖）。action id / cli / http 契约不变。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { listRepoDocs as _listRepoDocs } from '../refs.js';
const listRepoDocs: any = _listRepoDocs;

/** repo.doc.list 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
});

export class RepoDocListAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.doc.list',
    cli: ['repo', 'doc', 'list'],
    http: ['GET', '/api/repos/docs'],
    summary: '列出项目的介绍文档集（主篇 + 其余各篇，refId + desc）',
    args: ['id'],
    input,
    render: (d: any) => {
      const one: any = (x: any, i: any) => `  ${i}. ${x.title || x.desc || x.ref}${x.note ? `  # ${x.note}` : ''}${x.missing ? '  (缺正文)' : ''}`;
      const lines: any = [`【${d.repo.name}】介绍文档 ${d.count} 篇`];
      // 描述是**列表**：主篇 + 登记的补充（#58）
      let n: any = 0;
      if (d.main) lines.push(one(d.main, ++n));
      for (const x of d.links || []) lines.push(one(x, ++n));
      return lines.join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return listRepoDocs(ctx.id);
  
  }
}
