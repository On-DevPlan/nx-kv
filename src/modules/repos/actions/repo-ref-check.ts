// repo.ref.check —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as refNs from '../ref.js';
import { renderRefCheck as _renderRefCheck } from '../cli/render.js';
const ref: any = refNs;
const renderRefCheck: any = _renderRefCheck;

/** repo.ref.check 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

export class RepoRefCheckAction extends ActionBase<typeof input> {
  @action({
    id: 'repo.ref.check',
    cli: ['repo', 'ref', 'check'],
    http: ['GET', '/api/repos/ref/check'],
    summary: '检查参考仓库完整性：目录/.git/origin 一致性 + 组级/仓库级绑定死链（零副作用）',
    input,
    render: renderRefCheck,
  })
  override async run(_ctx: ActionInput<this['_input']>) {

      return ref.checkRefs();
  
  }
}
