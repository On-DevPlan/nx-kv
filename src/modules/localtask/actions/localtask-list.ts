// localtask.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { renderOverview as _renderOverview } from '../action-render.js';
const service: any = serviceNs;
const renderOverview: any = _renderOverview;

/** localtask.list 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

/**
 * localtask.list 的**出参视图**（跨语言契约，见 ActionMeta.output）。
 *
 * 刻意不声明 `tasks`：list 的语义是「主题清单 + 计数」，而真实返回里每个主题都挂着
 * 全部任务（实测某主题 194 条）。不声明，生成物里就没有这个字段，端侧首页也就不会
 * 被迫解码几 MB 的 JSON。
 */
const output = z.object({
  topics: z.array(
    z.object({
      key: z.string().describe('主题键（board/xxx 或 group/xxx）'),
      name: z.string().describe('主题名'),
      cwd: z.string().describe('主题绑定的工作目录'),
      summary: z.string().describe('一句话现状'),
      waiting: z.boolean().describe('是否处于等待中'),
      pending: z.int().describe('待领取数'),
      claimed: z.int().describe('进行中数'),
      done: z.int().describe('已完成数'),
      total: z.int().describe('任务总数'),
      repo: z
        .object({
          name: z.string(),
          key: z.string().describe('仓库键（github.com/owner/name）'),
          desc: z.string().optional(),
        })
        .nullable()
        .describe('所属仓库；纯本地目录的主题为 null'),
    }),
  ),
  waiting: z.int().describe('正在等待中的主题数'),
  settings: z.object({
    timeoutSec: z.int().describe('wait 的默认超时（秒）'),
    recommendedSec: z.int(),
    maxSec: z.int(),
    ackPromptList: z.array(z.string()).describe('交付文本里的收尾要求'),
  }),
});

export class LocaltaskListAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.list',
    cli: ['localtask', 'list'],
    http: ['GET', '/api/localtasks'],
    summary: '总览全部主题（工作目录、现状、是否等待中、待领取数）',
    input,
    output,
    render: renderOverview,
  })
  override async run(_ctx: ActionInput<this['_input']>) {

      return service.listTasks();
  
  }
}
