// localtask.topic.removeMany —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskTopicRemoveManyInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { renderRemoveMany as _renderRemoveMany } from '../action-render.js';
const service: any = serviceNs;
const renderRemoveMany: any = _renderRemoveMany;

export class LocaltaskTopicRemoveManyAction extends ActionBase {
  @action({
    id: 'localtask.topic.removeMany',
    cli: ['localtask', 'topic', 'remove-many'],
    http: ['POST', '/api/localtasks/topics/remove'],
    summary: '批量删除主题（--keys/--cwds 逗号分隔，或 --all；等待中默认跳过，--force 连等待中删）',
    input: localtaskTopicRemoveManyInput,
    render: renderRemoveMany,
  })
  async removeMany(ctx: any) {

      return service.removeTopics({ keys: ctx.keys, cwds: ctx.cwds, all: ctx.all, force: ctx.force });
  
  }
}
