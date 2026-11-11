// repo.remote —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { repoRemoteInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import * as keysNs from '../keys.js';
import { gitOrigin as _gitOrigin } from '../git.js';
import { badInput as _badInput } from '../../../core/errors.js';
const service: any = serviceNs;
const keys: any = keysNs;
const gitOrigin: any = _gitOrigin;
const badInput: any = _badInput;

export class RepoRemoteAction extends ActionBase<typeof repoRemoteInput> {
  @action({
    id: 'repo.remote',
    cli: ['repo', 'remote'],
    http: ['POST', '/api/repos/remote'],
    summary: '登记/更新仓库的远程 git 地址（无 --url = 从目录 origin 读取存档并重算 key）',
    args: ['id'],
    input: repoRemoteInput,
    render: (r: any) => (r.items ? keys.renderRefresh(r) : `已登记远程地址: ${r.name} -> ${r.remote}（key: ${r.key}）`),
  })
  override async run(ctx: ActionInput<this['_input']>) {

        if (ctx.refresh) return keys.refreshKeys({ id: ctx.id, apply: false });
        let url: any = String(ctx.url || '').trim();
        if (!url) {
          const r: any = await service.getRepo(ctx.id);
          url = await gitOrigin(r.path);
          if (!url) throw badInput(`「${r.name}」目录没有 origin，也未给 --url —— 请手工给一个`);
        }
        return service.updateRepo(ctx.id, { remote: url });
    
  }
}
