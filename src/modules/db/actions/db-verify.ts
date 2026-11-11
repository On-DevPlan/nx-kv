// db.verify —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** db.verify 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

export class DbVerifyAction extends ActionBase<typeof input> {
  @action({
    id: 'db.verify',
    cli: ['db', 'verify'],
    http: null,
    summary: '逐项校验：版本/行数/状态分布/正文哈希/seq 对应/外键/完整性',
    input,
    render: (d: any) => service.renderVerify(d),
  })
  override async run(_ctx: ActionInput<this['_input']>) {

      return service.verify();
  
  }
}
