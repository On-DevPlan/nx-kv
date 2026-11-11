// setting.get —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { settingGetInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class SettingGetAction extends ActionBase {
  @action({
    id: 'setting.get',
    cli: ['setting', 'get'],
    http: ['GET', '/api/setting'],
    summary: '读本机设置（附件自动下载、附件目录、参考仓库存储根）',
    input: settingGetInput,
    render: (d: any) => service.renderSettings(d),
  })
  async get(_ctx: any) {

      return service.getSettings();
  
  }
}
