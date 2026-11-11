// localtask.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { localtaskUpdateInput } from '../schemas.js';

export class LocaltaskUpdateAction extends ActionBase<typeof localtaskUpdateInput> {
  @action({
    id: 'localtask.update',
    cli: ['localtask', 'update'],
    http: ['PATCH', '/api/localtasks/item'],
    summary: '编辑任务内容（按 --id，定位到 --cwd 主题或 --key）；可同时改时间目标声明（--duration/--goal-prompt/--clear-goal，仅未领取时可改——领取即计时，起表后声明是既成事实）',
    input: localtaskUpdateInput,
    render: (d: any) =>
      (d.moved
        ? `已改归属项目：迁到主题「${d.name}」#${d.task.id}` +
          (d.movedFrom ? `（原 ${d.movedFrom.name} #${d.movedFrom.id}）` : '')
        : `已更新主题「${d.name}」#${d.task.id}`) +
      `: ${d.task.text}` +
      (d.goalChanged === 'set'
        ? `（时间目标：${d.task.timegoal.duration}${d.task.timegoal.prompt ? ' · 附加要求已固化' : ''}）`
        : d.goalChanged === 'cleared'
          ? '（时间目标已清除）'
          : '') +
      (d.task.blocksFollowing ? '（闸门）' : '') +
      (d.task.blockBy && d.task.blockBy.length ? `（依赖 #${d.task.blockBy.join(',#')}）` : ''),
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const gp: any = ctx.goalPrompt ?? ctx['goal-prompt'];
        const cg: any = ctx.clearGoal ?? ctx['clear-goal'];
        const hasGoalInput: any = ctx.duration != null || gp != null || cg;
        const rawBlock: any = ctx.blockBy ?? ctx['block-by'];
        const clearBlockBy: any = !!(ctx.clearBlockBy ?? ctx['clear-block-by']);
        let blockBy;
        if (!clearBlockBy && rawBlock !== undefined) {
          // 本地 id + "topicKey:id"；数组 body（面板）与逗号串都走 normalizeBlockBy
          const { normalizeBlockBy } = await (import('../dag.js') as any);
          blockBy = normalizeBlockBy(
            Array.isArray(rawBlock) ? rawBlock : String(rawBlock || ''),
            ctx.id,
          );
        }
        // 改归属即搬家（任务 #43）：正文 effective project 变了 → 任务迁到新项目的队列。
        // 编排在 tasktool/update.js，与派任务（tasktool/add.js）同一套落点判定。
        const { updateTask: editTask } = await (import('../../tasktool/update.js') as any);
        return editTask({
          id: ctx.id,
          text: ctx.text,
          cwd: ctx.cwd,
          key: ctx.key,
          goal: hasGoalInput ? { duration: ctx.duration, prompt: gp, clear: !!cg } : undefined,
          blockBy,
          clearBlockBy,
          blocksFollowing: ctx.gate,
        });
    
  }
}
