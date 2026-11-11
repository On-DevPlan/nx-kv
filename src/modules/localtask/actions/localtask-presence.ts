// localtask.presence —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput, type ActionRunMeta } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.presence 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

export class LocaltaskPresenceAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.presence',
    cli: ['localtask', 'presence'],
    http: ['GET', '/api/localtasks/presence'],
    summary: '探测主面板上当前打开的「实时任务」标签数（活动 SSE 连接数；用于 wait 不重复开页）',
    input,
    render: (d: any) =>
      `主面板当前有 ${d.clients} 个活动标签` +
      (d.source === 'self' ? '（主面板没在跑或探测失败，这里是本进程内计数）' : ''),
  })
  override async run(_ctx: ActionInput<this['_input']>, opts: ActionRunMeta = {}) {

      return opts && opts.transport === 'http'
          ? service.httpPanelPresence()
          : service.queryPanelPresence();
  
  }
}
