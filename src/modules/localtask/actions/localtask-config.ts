// localtask.config —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
//
// #152 起提示词模板不可再从这里写：模板正文的唯一真相是插件类
// （modules/promptplug/plugins/*.ts 的 `templates`），DB 不再存模板，
// 因此 ack / delivery-template / attach-template / block-templates 四组入参全部移除。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { PLUGIN_IDS as _PLUGIN_IDS } from '../../promptplug/index.js';
const service: any = serviceNs;
const PLUGIN_IDS: any = _PLUGIN_IDS;

/** localtask.config 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  timeout: z.number().optional().describe('超时秒数（1-600）'),
});

export class LocaltaskConfigAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.config',
    cli: ['localtask', 'config'],
    http: ['PATCH', '/api/localtasks/setting'],
    summary: '配置等待超时（秒）（系统上下文固定 XML 区块；提示词模板正文固定在插件类里，不再可配）',
    input,
    render: (s: any) => {
      return `已配置等待超时 ${s.timeoutSec} 秒（推荐 ${s.recommendedSec}，最大 ${s.maxSec}）· 提示词模板：${PLUGIN_IDS.length} 段全部内置（不可在此修改）`;
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    const patch: any = { timeoutSec: ctx.timeout };
    return service.updateSettings(patch);
  }
}
