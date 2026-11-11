// repo.ref.check —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { repoRefCheckInput } from '../schemas.js';
import * as refNs from '../ref.js';
import { renderRefCheck as _renderRefCheck } from '../cli/render.js';
const ref: any = refNs;
const renderRefCheck: any = _renderRefCheck;

export class RepoRefCheckAction extends ActionBase {
  @action({
    id: 'repo.ref.check',
    cli: ['repo', 'ref', 'check'],
    http: ['GET', '/api/repos/ref/check'],
    summary: '检查参考仓库完整性：目录/.git/origin 一致性 + 组级/仓库级绑定死链（零副作用）',
    input: repoRefCheckInput,
    render: renderRefCheck,
  })
  async check(_ctx: any) {

      return ref.checkRefs();
  
  }
}
