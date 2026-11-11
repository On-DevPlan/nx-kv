// localtask.reopen —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';

/** localtask.reopen 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  text: z.string().optional().describe("修改后的任务正文（Markdown）；不给则只重开不改内容"),
  kind: z.string().optional().describe("reopen（验收反馈，默认）或 comment（划选评论）"),
  quote: z.string().optional().describe("划选原文（comment 时）"),
  feedback: z.string().optional().describe("用户反馈原文；不给 text 时追加到当前正文末尾（#79，base = 服务端最新正文）"),
  feedbackHeading: z.string().optional().describe("追加反馈段的段名（缺省 comment=## 反馈修改 / reopen=## 验收反馈）"),
  feedbackBold: z.boolean().optional().describe("追加的反馈是否逐行加粗（缺省 comment=false / reopen=true）"),
});

export class LocaltaskReopenAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.reopen',
    cli: ['localtask', 'reopen'],
    http: ['POST', '/api/localtasks/reopen'],
    summary: '重开任务（验收反馈 / 重做 / 评论）：回写原任务正文，旧态压进 history；已完成则回到 pending 待再领',
    input,
    render: (d: any) =>
      `已重开 #${d.id} @ ${d.name}` +
      (d.before?.completedAt ? '（已完成→待领取）' : '') +
      (d.historyId != null ? `；链节点 #${d.historyId}` : '') +
      (d.moved && d.movedFrom ? `；已改归属项目，原 ${d.movedFrom.name} #${d.movedFrom.id}` : ''),
  })
  override async run(ctx: ActionInput<this['_input']>) {

        // 重开也可能带着改过的归属（--text 的 frontmatter.project 变了）→ 同样搬家
        const { reopenTask } = await (import('../../tasktool/update.js') as any);
        return reopenTask({
          id: ctx.id,
          cwd: ctx.cwd,
          key: ctx.key,
          text: ctx.text,
          kind: ctx.kind,
          quote: ctx.quote,
          feedback: ctx.feedback,
          feedbackHeading: ctx.feedbackHeading,
          feedbackBold: ctx.feedbackBold,
          // attachments 不在 schema 里，zod parse 会剥掉——恒为 undefined（#177 暴露；
          // CLI/生成的 client 都只发已声明键，行为不受影响）。保持原样不改行为。
          attachments: (ctx as Record<string, unknown>).attachments,
        });
    
  }
}
