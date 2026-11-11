// bundled.install —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { exclusive, renderScoped } from '../support.js';
const service: any = serviceNs;

/** bundled.install 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  name: z.string().optional(),
  group: z.string().optional().describe("groups.json 里的组名（与 <name> 互斥）"),
  to: z.string().optional(),
  force: z.boolean().optional(),
  all: z.boolean().optional().describe("装 assets/ 下的全部内置 skill（隐式覆盖，不需要 --force）"),
});

export class BundledInstallAction extends ActionBase<typeof input> {
  @action({
    id: 'bundled.install',
    cli: ['skill', 'install'],
    http: ['POST', '/api/bundled/install'],
    summary: '安装内置 skill 到 skills 目录（默认 nx-kv → ~/.claude/skills；--group <key> 一键装一组；--all 装全部并直接覆盖）',
    args: ['name'],
    input,
    render: (d: any) => {
        // 聚合形状用**显式字段**判别，不做形状嗅探（B04 §实现要点）：先 group 后 all
        if (d.group) return renderScoped(`group ${d.group}`, d);
        if (d.all) return renderScoped(`--all（${d.count} 个 skill，已覆盖）`, d);
        if (d.status === 'conflict') {
          const files: any = d.files.map((f: any) => `  ${f.file}  ${f.side}`).join('\n');
          return `目标已存在且内容不同（${d.count} 个文件）: ${d.path}\n${files}\n用 --force 覆盖，或先删除目标目录`;
        }
        if (d.skipped) return `已是最新，无需安装: ${d.path}`;
        return `${d.replaced ? '已更新' : '已安装'} ${d.name}（${d.files} 个文件）-> ${d.path}`;
      },
  })
  override async run(ctx: ActionInput<this['_input']>) {

          exclusive(ctx, 'skill install');
          return service.installBundledSkill({
            name: ctx.name || service.DEFAULT_SKILL_NAME,
            group: ctx.group,
            all: ctx.all,
            to: ctx.to,
            force: ctx.force,
          });
      
  }
}
