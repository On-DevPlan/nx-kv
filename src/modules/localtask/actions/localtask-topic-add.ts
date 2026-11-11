// localtask.topic.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskTopicAddInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskTopicAddAction extends ActionBase {
  @action({
    id: 'localtask.topic.add',
    cli: ['localtask', 'topic', 'add'],
    http: ['POST', '/api/localtasks/topic'],
    summary: '登记一个工作目录：空目录也常驻（prune 不清）；--summary 顺带写「现状摘要」（面板顶栏摘要的编辑入口）',
    input: localtaskTopicAddInput,
    render: (d: any) =>
      `${d.existed ? '已更新' : '已登记'}目录「${d.name}」${d.cwd}` +
      (d.existed ? '（原先已存在）' : ''),
  })
  async add(ctx: any) {

      return service.addTopic({ cwd: ctx.cwd, summary: ctx.summary });
  
  }
}
