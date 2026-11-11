// repo.bind —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoBindInput } from '../schemas.js';
import * as refNs from '../ref.js';
import { renderBind as _renderBind } from '../cli/render.js';
const ref: any = refNs;
const renderBind: any = _renderBind;

export class RepoBindAction extends ActionBase {
  @action({
    id: 'repo.bind',
    cli: ['repo', 'bind'],
    http: ['POST', '/api/repos/bind'],
    summary: '绑定参考仓库到组或单个开发仓库（两类并存；--board 组级、--repo 仓库级；--remove 摘除）',
    args: ['id'],
    input: repoBindInput,
    render: renderBind,
  })
  async bind(ctx: any) {

      return ref.bindTarget(ctx);
  
  }
}
