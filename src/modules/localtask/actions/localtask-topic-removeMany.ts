// localtask.topic.removeMany —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { renderRemoveMany as _renderRemoveMany } from '../action-render.js';
const service: any = serviceNs;
const renderRemoveMany: any = _renderRemoveMany;

/** localtask.topic.removeMany 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  keys: z.array(z.string()).optional().describe("主题 key，逗号分隔"),
  cwds: z.array(z.string()).optional().describe("工作目录，逗号分隔"),
  all: z.boolean().optional().describe("清空全部主题（等待中仍跳过，除非 --force）"),
  force: z.boolean().optional().describe("连等待中的主题一起删"),
});

export class LocaltaskTopicRemoveManyAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.topic.removeMany',
    cli: ['localtask', 'topic', 'remove-many'],
    http: ['POST', '/api/localtasks/topics/remove'],
    summary: '批量删除主题（--keys/--cwds 逗号分隔，或 --all；等待中默认跳过，--force 连等待中删）',
    input,
    render: renderRemoveMany,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.removeTopics({ keys: ctx.keys, cwds: ctx.cwds, all: ctx.all, force: ctx.force });
  
  }
}
