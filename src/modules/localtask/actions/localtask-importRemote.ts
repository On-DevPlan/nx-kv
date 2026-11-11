// localtask.importRemote —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { localtaskImportRemoteInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskImportRemoteAction extends ActionBase<typeof localtaskImportRemoteInput> {
  @action({
    id: 'localtask.importRemote',
    cli: ['localtask', 'import-remote'],
    http: ['POST', '/api/localtasks/import-remote'],
    summary: '从远程清单（KV 后端）导入任务到本地队列：按内容定位远程那条 → 落进本地队列 → 远程那条标记为已完成（note 写明被哪个队列领走）',
    input: localtaskImportRemoteInput,
    render: (d: any) => {
      const lines: any = [d.message];
      for (const r of d.results || []) {
        if (r.error) lines.push(`  ✗ ${r.ref} —— ${r.error}`);
        else lines.push(`  ✓ ${r.ref} → 本地「${r.localTopic}」#${r.localId}${r.remoteDone ? '（远程已标记完成）' : '（远程未标记完成）'}`);
      }
      return lines.join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.importRemoteTasks({
          // ref（CLI 的 --ref，可给多次）与 refs（面板发的列表）**都传过去**。
          // 注意：refs 不在 schema 里，zod parse 会剥掉未声明键——它恒为 undefined
          //（#177 类型化后暴露；CLI/生成的 client 都只发已声明键，行为不受影响）。
          // 想启用面板直发列表，就把 refs 声明进 schema，而不是靠透传。
          ref: ctx.ref,
          refs: (ctx as Record<string, unknown>).refs,
          cwd: ctx.cwd,
          global: ctx.global,
          topic: ctx.topic,
          pick: ctx.pick,
        });
  
  }
}
