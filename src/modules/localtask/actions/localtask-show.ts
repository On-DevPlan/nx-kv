// localtask.show —— 查看单条任务（CLI `localtask show` / HTTP GET /api/localtasks/show）。
//
// id / cli / http 三层同词表，都以 CLI 动词 **show** 为基准（按 --id，只读不领）。
// CRUD 词表的「查（单条）」位（X.get）对本资源由 registry.test.mjs 的 crudIdOf
// 覆盖映射到本条——因为 `localtask get` 在 CLI 语义里是「领取」，查单条的
// 用户动词是 show。要「领活」调 claim 模块的 localtask.get。
//
// 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { renderTask as _renderTask } from '../ui/action-render.js';
import { taskView } from '../ui/contract-views.js';
const service: any = serviceNs;
const renderTask: any = _renderTask;

/** localtask.show 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

export class LocaltaskShowAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.show',
    cli: ['localtask', 'show'],
    http: ['GET', '/api/localtasks/show'],
    summary: '查看单条任务（按 --id，定位到 --cwd 主题或 --key）；正文引用附件时带附件清单与本地路径（自动下载跟随本机设置）',
    input,
    output: taskView,
    render: renderTask,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const task: any = await service.getTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
        // 附件标注（任务 #15）：解析正文嵌入 + 按设置自动下载 + 标本地路径。
        // fail-open：标注坏了照常返回任务本体。
        const { annotateTaskDelivery } = await (import('../ops/attach.js') as any);
        const att: any = await annotateTaskDelivery(task).catch(() => null);
        return att
          ? { ...task, attachments: att.task.attachments }
          : task;

  }
}
