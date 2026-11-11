// bundled.groups —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { bundledGroupsInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class BundledGroupsAction extends ActionBase<typeof bundledGroupsInput> {
  @action({
    id: 'bundled.groups',
    cli: [['skill', 'groups'], ['bundled', 'groups']],
    http: ['GET', '/api/bundled/groups'],
    summary: '列出可装的 group（groups.json 的组名 → 它包含哪些 skill）',
    input: bundledGroupsInput,
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
