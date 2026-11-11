// localtask.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskAddInput } from '../schemas.js';
import { renderAdd as _renderAdd } from '../action-render.js';
const renderAdd: any = _renderAdd;

export class LocaltaskAddAction extends ActionBase {
  @action({
    id: 'localtask.add',
    cli: ['localtask', 'add'],
    http: ['POST', '/api/localtasks'],
    summary: '向某主题（工作目录）的队列回填一条任务（有 wait 在等则即时投递，否则排队）；--global 推到全局共享池；--duration 给任务带时间目标（领取即计时，完成前必须 check）；--board/--project 让任务带工作组语义（正文 frontmatter：board + project + 双方介绍引用），并落进该项目的队列；正文自带 frontmatter 时同样认归属——补介绍引用，落点跟到项目队列（显式给过 --cwd 时不挪窝）',
    args: ['text'],
    input: localtaskAddInput,
    render: renderAdd,
  })
  async add(ctx: any) {

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
