// task.move —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as moveNs from '../move.js';
const move: any = moveNs;

/** task.move 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  from: z.enum(["local", "cloud"]).optional().describe("迁移源"),
  to: z.enum(["local", "cloud"]).optional().describe("迁移目标"),
  id: z.number().optional().describe("本机任务编号（from=local 时必填）"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  topic: z.string().optional().describe("云端主题（= 目录名；from=cloud 必填，to=cloud 缺省用目录名）"),
  text: z.string().optional().describe("云端任务内容（from=cloud 时按内容定位）"),
  pick: z.number().optional().describe("云端同内容多条时的编号（消歧）"),
  merge: z.boolean().optional().describe("目标端已有同内容时合并到已有条目（不新增）"),
  group: z.number().optional().describe("云端工作空间 id（默认取当前）"),
  undo: z.boolean().optional().describe("撤销一次迁移（配合 --target-id 与原 move 参数）"),
  'target-id': z.number().optional().describe("撤销用：迁移时返回的 targetId"),
  'tombstone-id': z.number().optional().describe("撤销 local→cloud 时可显式指定本机迁出条目编号（缺省用 --id）"),
});

export class TaskMoveAction extends ActionBase<typeof input> {
  @action({
    id: 'task.move',
    cli: ['task', 'move'],
    http: ['POST', '/api/task/move'],
    summary: '在本机队列与云端清单之间迁移任务（先写目标端、成功才改源端；--undo 按返回的 target-id 精确撤销）',
    input,
    render: (d: any) => {
      if (d.undone) {
        return d.from === 'local'
          ? `已撤销: 云端「${d.topic}」的条目已删除，本机「${d.dirName}」#${d.tombstoneId} 回到待领取`
          : `已撤销: 本机「${d.dirName}」#${d.targetId} 已移除，云端「${d.topic}」已恢复`;
      }
      const head: any =
        d.from === 'local'
          ? `本机「${d.dirName}」#${d.tombstoneId} → 云端「${d.topic}」（${d.merged ? `合并到已有条目 #${d.targetId}` : `新待办 #${d.targetId}`}）`
          : `云端「${d.topic}」 → 本机「${d.dirName}」（待领取首位 #${d.targetId}）`;
      const tail: any = d.from === 'local' ? `\n原位置留有迁出记录（可在面板跳转/移除；task move --undo 撤销）` : '';
      return head + (d.dupCount ? `\n（目标端原有 ${d.dupCount} 条同内容）` : '') + tail;
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return move.moveTask({
          from: ctx.from,
          to: ctx.to,
          id: ctx.id,
          cwd: ctx.cwd,
          key: ctx.key,
          topic: ctx.topic,
          text: ctx.text,
          pick: ctx.pick,
          merge: ctx.merge,
          group: ctx.group,
          undo: ctx.undo,
          'target-id': ctx['target-id'],
          'tombstone-id': ctx['tombstone-id'],
        });
  
  }
}
