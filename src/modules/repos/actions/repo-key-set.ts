// repo.key.set —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { badInput as _badInput } from '../../../core/errors.js';
const service: any = serviceNs;
const badInput: any = _badInput;

/** repo.key.set 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.string(),
  key: z.string().optional(),
  follow: z.boolean().optional().describe("取消自定义：key 重新跟随远程地址派生"),
});

export class RepoKeySetAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.key.set',
    cli: ['repo', 'key', 'set'],
    http: ['POST', '/api/repos/key'],
    summary: '设置自定义 key（全局唯一，不跟随远程地址自动变）；--follow 恢复为跟随 remote',
    args: ['id', 'key'],
    input,
    render: (r: any) => `已设 key: ${r.name} -> ${r.key}${r.keyCustom ? '（自定义）' : '（跟随远程地址）'}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        if (ctx.follow) {
          await service.updateRepo(ctx.id, { keyCustom: false, key: '' });
        } else {
          if (!ctx.key) throw badInput('请给自定义 key，或 --follow 恢复跟随远程地址');
          await service.updateRepo(ctx.id, { key: ctx.key, keyCustom: true });
        }
        return service.getRepo(ctx.id);
    
  }
}
