// localtask.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { renderAdd as _renderAdd } from '../action-render.js';
const renderAdd: any = _renderAdd;

/** localtask.add 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  text: z.string(),
  cwd: z.string().optional().describe("工作目录（作为主题；默认当前目录）。归属由 --project 决定：给了 --project 就用它推导落点，这里再给且不一致会报错"),
  summary: z.string().optional().describe("顺带刷新该主题的当前现状（可选）"),
  global: z.boolean().optional().describe("推到全局主题（共享池）：任何目录的 wait 在本地空时自动领取；--cwd 被忽略"),
  board: z.string().optional().describe("工作组（看板）id / key / 名称：任务正文自动带上 frontmatter（board + 组介绍引用），该任务才会出现在组面板里；必须同时给 --project 指明归属项目"),
  project: z.string().optional().describe("归属项目（仓库 key / 名称 / 路径）：任务挂在哪个项目上，落点目录由它推导，frontmatter 带上 project + 项目介绍引用；配 --board 时必须是该组成员"),
  duration: z.string().optional().describe("时间目标时长（2h / 90m / 5小时）：领取即计时，未到点不许标完成"),
  'goal-prompt': z.string().optional().describe("时间目标的附加要求（随 check 指令一起固化，可省）"),
  goalPrompt: z.string().optional().describe("同 --goal-prompt（驼峰写法）"),
  'block-by': z.string().optional().describe("DAG 依赖：逗号分隔的任务 id（如 12,13）——这些任务全部完成后本条才可领取"),
  blockBy: z.string().optional().describe("同 --block-by（驼峰 / HTTP body）"),
  gate: z.boolean().optional().describe("闸门任务：自身未完成（无 completedAt）时，队列里排在它后面的 pending 都不可领"),
  'fork-of': z.string().optional().describe("任务链（#69）：这条任务从哪条派生——裸数字=同主题父任务编号，或 \"key:id\"=跨主题；父任务必须存在"),
  forkOf: z.string().optional().describe("同 --fork-of（驼峰 / HTTP body）"),
  'fork-kind': z.string().optional().describe("派生种类：comment（评论/随手派生，默认）或 reopen（验收反馈重开）"),
  forkKind: z.string().optional().describe("同 --fork-kind（驼峰写法）"),
});

export class LocaltaskAddAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.add',
    cli: ['localtask', 'add'],
    http: ['POST', '/api/localtasks'],
    summary: '向某主题（工作目录）的队列回填一条任务（有 wait 在等则即时投递，否则排队）；--global 推到全局共享池；--duration 给任务带时间目标（领取即计时，完成前必须 check）；--board/--project 让任务带工作组语义（正文 frontmatter：board + project + 双方介绍引用），并落进该项目的队列；正文自带 frontmatter 时同样认归属——补介绍引用，落点跟到项目队列（显式给过 --cwd 时不挪窝）',
    args: ['text'],
    input,
    render: renderAdd,
  })
  override async run(ctx: ActionInput<this['_input']>) {

        // 派任务编排已迁 tasktool/add.js（任务工具语义归 tasktool；命令名不变）。
        // 落点判定（--board/--project 严格口径 / 正文 frontmatter fail-open）只此一份实现，
        // CLI、HTTP、面板提交同走这一条链路。
        const { submitTask } = await (import('../../tasktool/add.js') as any);
        const rawBlock: any = ctx.blockBy ?? ctx['block-by'];
        // 支持本地 id 与跨队列 "topicKey:id"（组编排边）；空 → undefined
        const { normalizeBlockBy } = await (import('../dag.js') as any);
        const blockBy: any = rawBlock != null && String(rawBlock).trim()
          ? normalizeBlockBy(String(rawBlock), 0)
          : [];
        return submitTask({
          text: ctx.text,
          cwd: ctx.cwd,
          summary: ctx.summary,
          global: ctx.global,
          board: ctx.board,
          project: ctx.project,
          duration: ctx.duration,
          goalPrompt: ctx.goalPrompt ?? ctx['goal-prompt'],
          blockBy: blockBy.length ? blockBy : undefined,
          blocksFollowing: !!ctx.gate,
          forkOf: ctx.forkOf ?? ctx['fork-of'],
          forkKind: ctx.forkKind ?? ctx['fork-kind'],
        });
    
  }
}
