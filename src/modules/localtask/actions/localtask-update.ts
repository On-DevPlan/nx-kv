// localtask.update —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';

/** localtask.update 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  id: z.number().describe("任务编号"),
  text: z.string().optional().describe("改成这个内容；只改时间目标时可省"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  duration: z.string().optional().describe("时间目标时长（2h / 90m）：未领取时设/改声明；只带 --goal-prompt 不带时长会报错"),
  'goal-prompt': z.string().optional().describe("时间目标附加要求（随 check 指令固化）；只改时长不带它则保留原附加要求"),
  goalPrompt: z.string().optional().describe("同 --goal-prompt（驼峰写法，HTTP body 用）"),
  'clear-goal': z.boolean().optional().describe("清掉时间目标声明（未领取时）"),
  clearGoal: z.boolean().optional().describe("同 --clear-goal（驼峰写法，HTTP body 用）"),
  'block-by': z.string().optional().describe("改 DAG 依赖（逗号分隔 id）；空串等同 --clear-block-by"),
  blockBy: z.string().optional().describe("同 --block-by"),
  'clear-block-by': z.boolean().optional().describe("清掉 blockBy 依赖"),
  clearBlockBy: z.boolean().optional().describe("同 --clear-block-by"),
  gate: z.boolean().optional().describe("设/清闸门（true=挡住后续；false=取消闸门）"),
});

export class LocaltaskUpdateAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.update',
    cli: ['localtask', 'update'],
    http: ['PATCH', '/api/localtasks/item'],
    summary: '编辑任务内容（按 --id，定位到 --cwd 主题或 --key）；可同时改时间目标声明（--duration/--goal-prompt/--clear-goal，仅未领取时可改——领取即计时，起表后声明是既成事实）',
    input,
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
