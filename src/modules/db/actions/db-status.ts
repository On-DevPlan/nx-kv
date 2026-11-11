// db.status —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { dbStatusInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class DbStatusAction extends ActionBase {
  @action({
    id: 'db.status',
    cli: ['db', 'status'],
    http: null,
    summary: '库状态：路径、user_version、各表行数、任务状态分布（只读，不升级）',
    input: dbStatusInput,
    render: (d: any) => service.renderStatus(d),
  })
  async status(_ctx: any) {

      return service.status();
  
  }
}
