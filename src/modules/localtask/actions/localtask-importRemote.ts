// localtask.importRemote —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskImportRemoteInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class LocaltaskImportRemoteAction extends ActionBase {
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
  async importRemote(ctx: any) {

      return service.importRemoteTasks({
          // ref（CLI 的 --ref，可给多次）与 refs（面板发的列表）**都传过去**：
          // HTTP body 里未声明的键会原样透传，两边各叫各的更顺手。
          ref: ctx.ref,
          refs: ctx.refs,
          cwd: ctx.cwd,
          global: ctx.global,
          topic: ctx.topic,
          pick: ctx.pick,
        });
  
  }
}
