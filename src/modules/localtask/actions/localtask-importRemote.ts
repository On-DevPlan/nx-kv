// localtask.importRemote —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

/** localtask.importRemote 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  ref: z.array(z.string()).optional().describe("远程任务内容（整串，可给多次）"),
  cwd: z.string().optional(),
  global: z.boolean().optional().describe("导入到全局共享池（--cwd 被忽略）"),
  topic: z.string().optional().describe("远程主题（消歧用）"),
  pick: z.number().optional().describe("同内容多条时的编号（消歧用）"),
});

export class LocaltaskImportRemoteAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.importRemote',
    cli: ['localtask', 'import-remote'],
    http: ['POST', '/api/localtasks/import-remote'],
    summary: '从远程清单（KV 后端）导入任务到本地队列：按内容定位远程那条 → 落进本地队列 → 远程那条标记为已完成（note 写明被哪个队列领走）',
    input,
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
