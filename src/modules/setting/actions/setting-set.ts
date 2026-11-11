// setting.set —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { settingSetInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class SettingSetAction extends ActionBase {
  @action({
    id: 'setting.set',
    cli: ['setting', 'set'],
    http: ['POST', '/api/setting'],
    summary: '改本机设置（只改传入项）',
    input: settingSetInput,
    render: (d: any) => service.renderSettings(d),
  })
  async set(ctx: any) {

      return service.setSettings(ctx);
  
  }
}
