// setting.set —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** setting.set 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  gitRepoRoot: z.string().optional().describe("参考仓库存储根目录（非 C 盘；空 = clone 参考仓库被拒绝）"),
  gitDevRoot: z.string().optional().describe("导入布局时开发仓库的默认克隆根（空 = 只登记不克隆）"),
});

export class SettingSetAction extends ActionBase<typeof input> {
  @action({
    id: 'setting.set',
    cli: ['setting', 'set'],
    http: ['POST', '/api/setting'],
    summary: '改本机设置（只改传入项）',
    input,
    render: (d: any) => service.renderSettings(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.setSettings(ctx);
  
  }
}
