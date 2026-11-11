// repo.key.set —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoKeySetInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { badInput as _badInput } from '../../../core/errors.js';
const service: any = serviceNs;
const badInput: any = _badInput;

export class RepoKeySetAction extends ActionBase {
  @action({
    id: 'repo.key.set',
    cli: ['repo', 'key', 'set'],
    http: ['POST', '/api/repos/key'],
    summary: '设置自定义 key（全局唯一，不跟随远程地址自动变）；--follow 恢复为跟随 remote',
    args: ['id', 'key'],
    input: repoKeySetInput,
    render: (r: any) => `已设 key: ${r.name} -> ${r.key}${r.keyCustom ? '（自定义）' : '（跟随远程地址）'}`,
  })
  async set(ctx: any) {

        if (ctx.follow) {
          await service.updateRepo(ctx.id, { keyCustom: false, key: '' });
        } else {
          if (!ctx.key) throw badInput('请给自定义 key，或 --follow 恢复跟随远程地址');
          await service.updateRepo(ctx.id, { key: ctx.key, keyCustom: true });
        }
        return service.getRepo(ctx.id);
    
  }
}
