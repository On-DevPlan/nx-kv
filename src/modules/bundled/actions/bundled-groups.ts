// bundled.groups —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** bundled.groups 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

export class BundledGroupsAction extends ActionBase<typeof input> {
  @action({
    id: 'bundled.groups',
    cli: [['skill', 'groups'], ['bundled', 'groups']],
    http: ['GET', '/api/bundled/groups'],
    summary: '列出可装的 group（groups.json 的组名 → 它包含哪些 skill）',
    input,
    render: (d: any) => {
        const head: any = `可装的 group（来源: ${d.source}${d.defaultGroup ? ` · 默认组: ${d.defaultGroup}` : ''}）:`;
        const lines: any = [head];
        for (const g of d.groups) {
          lines.push(`  ${g}${d.summaries[g] ? '  —— ' + d.summaries[g] : ''}`);
          lines.push(`      skills: ${(d.groupSkills[g] || []).join(', ')}`);
        }
        if (!d.groups.length) lines.push('  （无）');
        return lines.join('\n');
      },
  })
  override async run(_ctx: ActionInput<this['_input']>) {

      return service.groupsInfo();
  
  }
}
