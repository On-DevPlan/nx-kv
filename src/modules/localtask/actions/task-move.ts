// task.move —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { taskMoveInput } from '../schemas.js';
import * as moveNs from '../move.js';
const move: any = moveNs;

export class TaskMoveAction extends ActionBase<typeof taskMoveInput> {
  @action({
    id: 'task.move',
    cli: ['task', 'move'],
    http: ['POST', '/api/task/move'],
    summary: '在本机队列与云端清单之间迁移任务（先写目标端、成功才改源端；--undo 按返回的 target-id 精确撤销）',
    input: taskMoveInput,
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
