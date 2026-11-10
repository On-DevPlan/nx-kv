// 写入类 action（自 index.js 拆出）：远程导入 / 派任务 add / 编辑 update。
import * as service from './service.js';
import { CWD, KEY } from './action-flags.js';
import { renderAdd } from './action-render.js';

export const submitActions = [
  {
    id: 'localtask.importRemote',
    cli: ['localtask', 'import-remote'],
    http: ['POST', '/api/localtasks/import-remote'],
    summary:
      '从远程清单（KV 后端）导入任务到本地队列：按内容定位远程那条 → 落进本地队列 → 远程那条标记为已完成（note 写明被哪个队列领走）',
    // 按**内容**定位远程任务，不按 id —— 远程 id 会被复用（todo 模块的硬约定）。
    // --ref 可给多次（面板一次勾选多条时走 HTTP 的 refs 数组）。
    flags: {
      ref: { type: 'array', hint: '远程任务内容（整串，可给多次）' },
      cwd: CWD,
      global: { type: 'boolean', hint: '导入到全局共享池（--cwd 被忽略）' },
      topic: { type: 'string', hint: '远程主题（消歧用）' },
      pick: { type: 'number', hint: '同内容多条时的编号（消歧用）' },
    },
    run: (ctx) =>
      service.importRemoteTasks({
        // ref（CLI 的 --ref，可给多次）与 refs（面板发的列表）**都传过去**：
        // HTTP body 里未声明的键会原样透传，两边各叫各的更顺手。
        ref: ctx.ref,
        refs: ctx.refs,
        cwd: ctx.cwd,
        global: ctx.global,
        topic: ctx.topic,
        pick: ctx.pick,
      }),
    render: (d) => {
      const lines = [d.message];
      for (const r of d.results || []) {
        if (r.error) lines.push(`  ✗ ${r.ref} —— ${r.error}`);
        else lines.push(`  ✓ ${r.ref} → 本地「${r.localTopic}」#${r.localId}${r.remoteDone ? '（远程已标记完成）' : '（远程未标记完成）'}`);
      }
      return lines.join('\n');
    },
  },
  {
    id: 'localtask.add',
    cli: ['localtask', 'add'],
    http: ['POST', '/api/localtasks'],
    summary:
      '向某主题（工作目录）的队列回填一条任务（有 wait 在等则即时投递，否则排队）；--global 推到全局共享池；--duration 给任务带时间目标（领取即计时，完成前必须 check）；--board/--project 让任务带工作组语义（正文 frontmatter：board + project + 双方介绍引用），并落进该项目的队列；正文自带 frontmatter 时同样认归属——补介绍引用，落点跟到项目队列（显式给过 --cwd 时不挪窝）',
    args: ['text'],
    flags: {
      cwd: {
        type: 'string',
        hint: '工作目录（作为主题；默认当前目录）。归属由 --project 决定：给了 --project 就用它推导落点，这里再给且不一致会报错',
      },
      summary: { type: 'string', hint: '顺带刷新该主题的当前现状（可选）' },
      global: {
        type: 'boolean',
        hint: '推到全局主题（共享池）：任何目录的 wait 在本地空时自动领取；--cwd 被忽略',
      },
      board: {
        type: 'string',
        hint: '工作组（看板）id / key / 名称：任务正文自动带上 frontmatter（board + 组介绍引用），该任务才会出现在组面板里；必须同时给 --project 指明归属项目',
      },
      project: {
        type: 'string',
        hint: '归属项目（仓库 key / 名称 / 路径）：任务挂在哪个项目上，落点目录由它推导，frontmatter 带上 project + 项目介绍引用；配 --board 时必须是该组成员',
      },
      duration: {
        type: 'string',
        hint: '时间目标时长（2h / 90m / 5小时）：领取即计时，未到点不许标完成',
      },
      'goal-prompt': { type: 'string', hint: '时间目标的附加要求（随 check 指令一起固化，可省）' },
      goalPrompt: { type: 'string', hint: '同 --goal-prompt（驼峰写法）' },
      'block-by': {
        type: 'string',
        hint: 'DAG 依赖：逗号分隔的任务 id（如 12,13）——这些任务全部完成后本条才可领取',
      },
      blockBy: { type: 'string', hint: '同 --block-by（驼峰 / HTTP body）' },
      gate: {
        type: 'boolean',
        hint: '闸门任务：自身未完成（无 completedAt）时，队列里排在它后面的 pending 都不可领',
      },
      'fork-of': {
        type: 'string',
        hint: '任务链（#69）：这条任务从哪条派生——裸数字=同主题父任务编号，或 "key:id"=跨主题；父任务必须存在',
      },
      forkOf: { type: 'string', hint: '同 --fork-of（驼峰 / HTTP body）' },
      'fork-kind': {
        type: 'string',
        hint: '派生种类：comment（评论/随手派生，默认）或 reopen（验收反馈重开）',
      },
      forkKind: { type: 'string', hint: '同 --fork-kind（驼峰写法）' },
    },
    run: async (ctx) => {
      // 派任务编排已迁 tasktool/add.js（任务工具语义归 tasktool；命令名不变）。
      // 落点判定（--board/--project 严格口径 / 正文 frontmatter fail-open）只此一份实现，
      // CLI、HTTP、面板提交同走这一条链路。
      const { submitTask } = await import('../tasktool/add.js');
      const rawBlock = ctx.blockBy ?? ctx['block-by'];
      // 支持本地 id 与跨队列 "topicKey:id"（组编排边）；空 → undefined
      const { normalizeBlockBy } = await import('./dag.js');
      const blockBy = rawBlock != null && String(rawBlock).trim()
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
    },
    render: renderAdd,
  },
  {
    id: 'localtask.update',
    cli: ['localtask', 'update'],
    http: ['PATCH', '/api/localtasks/item'],
    summary:
      '编辑任务内容（按 --id，定位到 --cwd 主题或 --key）；可同时改时间目标声明（--duration/--goal-prompt/--clear-goal，仅未领取时可改——领取即计时，起表后声明是既成事实）',
    flags: {
      id: { type: 'number', required: true, hint: '任务编号' },
      text: { type: 'string', hint: '改成这个内容；只改时间目标时可省' },
      cwd: CWD,
      key: KEY,
      duration: { type: 'string', hint: '时间目标时长（2h / 90m）：未领取时设/改声明；只带 --goal-prompt 不带时长会报错' },
      'goal-prompt': { type: 'string', hint: '时间目标附加要求（随 check 指令固化）；只改时长不带它则保留原附加要求' },
      goalPrompt: { type: 'string', hint: '同 --goal-prompt（驼峰写法，HTTP body 用）' },
      'clear-goal': { type: 'boolean', hint: '清掉时间目标声明（未领取时）' },
      clearGoal: { type: 'boolean', hint: '同 --clear-goal（驼峰写法，HTTP body 用）' },
      'block-by': { type: 'string', hint: '改 DAG 依赖（逗号分隔 id）；空串等同 --clear-block-by' },
      blockBy: { type: 'string', hint: '同 --block-by' },
      'clear-block-by': { type: 'boolean', hint: '清掉 blockBy 依赖' },
      clearBlockBy: { type: 'boolean', hint: '同 --clear-block-by' },
      gate: { type: 'boolean', hint: '设/清闸门（true=挡住后续；false=取消闸门）' },
    },
    run: async (ctx) => {
      const gp = ctx.goalPrompt ?? ctx['goal-prompt'];
      const cg = ctx.clearGoal ?? ctx['clear-goal'];
      const hasGoalInput = ctx.duration != null || gp != null || cg;
      const rawBlock = ctx.blockBy ?? ctx['block-by'];
      const clearBlockBy = !!(ctx.clearBlockBy ?? ctx['clear-block-by']);
      let blockBy;
      if (!clearBlockBy && rawBlock !== undefined) {
        // 本地 id + "topicKey:id"；数组 body（面板）与逗号串都走 normalizeBlockBy
        const { normalizeBlockBy } = await import('./dag.js');
        blockBy = normalizeBlockBy(
          Array.isArray(rawBlock) ? rawBlock : String(rawBlock || ''),
          ctx.id,
        );
      }
      // 改归属即搬家（任务 #43）：正文 effective project 变了 → 任务迁到新项目的队列。
      // 编排在 tasktool/update.js，与派任务（tasktool/add.js）同一套落点判定。
      const { updateTask: editTask } = await import('../tasktool/update.js');
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
    },
    render: (d) =>
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
  },
];
