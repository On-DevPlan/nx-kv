// localtask.sync-queues —— 补齐仓库 / 组缺的队列 topic（#199）。
//
// 口径：**一个仓库 = 一条目录队列 topic**、**一个组 = 一条组 topic**。登记时就建好；
// 这里给「仓库管理」页一个显式入口（刷新按钮）与编排后的自动刷新用，补齐历史数据缺的。
//
// 幂等：只补不删、重复调用无副作用。返回值是本次**新补的条数**，便于面板 toast 与 CLI 核对。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.sync-queues 的入参契约。 */
const input = z.object({});

/** 出参视图：本次新补的队列条数（跨语言契约用）。 */
const output = z.object({
  repos: z.int().describe('本次新补建的仓库队列数'),
  groups: z.int().describe('本次新补建的组队列数'),
});

export class LocaltaskSyncQueuesAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.sync-queues',
    cli: ['localtask', 'sync-queues'],
    http: ['POST', '/api/localtask/queues/sync'],
    summary: '补齐仓库 / 组缺的队列 topic（幂等，只补不删）——仓库管理页的「刷新队列」与编排后自动刷新走它',
    input,
    output,
    render: (d: any) => `队列已同步：新补仓库队列 ${d.repos} 条、组队列 ${d.groups} 条`,
  })
  override async run(_ctx: ActionInput<this['_input']>) {
    return service.syncQueues();
  }
}
