// bundled.install —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { bundledInstallInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { exclusive, renderScoped } from '../support.js';
const service: any = serviceNs;

export class BundledInstallAction extends ActionBase<typeof bundledInstallInput> {
  @action({
    id: 'bundled.install',
    cli: ['skill', 'install'],
    http: ['POST', '/api/bundled/install'],
    summary: '安装内置 skill 到 skills 目录（默认 nx-kv → ~/.claude/skills；--group <key> 一键装一组；--all 装全部并直接覆盖）',
    args: ['name'],
    input: bundledInstallInput,
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
