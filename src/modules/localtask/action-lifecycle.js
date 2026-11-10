// 任务生命周期 action（自 index.js 拆出）：克隆/派生 → 领取/预览 → 重开/完成/时间目标日志。
import * as service from './service.js';
import { badInput } from '../../core/errors.js';
import { CWD, KEY } from './action-flags.js';
import { renderWait, renderPreview } from './action-render.js';

export const lifecycleActions = [
  {
    // 克隆（#70）：以现任务为模板快速复制内容成一条新任务。**不建派生链**——
    // forkOf 留空（那条语义属于 reopen 反馈 / 评论派生），时间目标与依赖也不继承；
    // 源任务不动，克隆后两条并存。
    id: 'localtask.clone',
    cli: ['localtask', 'clone'],
    http: ['POST', '/api/localtasks/clone'],
    summary:
      '克隆任务：复制正文内容为一条新任务（同主题；全局任务仍进全局池）。不带派生链、不继承时间目标与依赖——开新活用',
    flags: { id: { type: 'number', required: true, hint: '任务编号' }, cwd: CWD, key: KEY },
    run: (ctx) => service.cloneTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key }),
    render: (d) =>
      `已克隆 #${d.from.id} → #${d.task.id} @ ${d.name}（内容复制，无派生链；${d.delivered ? '已实时投递' : '待领取'}）`,
  },
  {
    // Fork（#67）：克隆的原文复制 + 派生链。clone 有时被当成新活后，原任务的
    // 评论/反馈链就看不到了；fork 把新任务挂到源任务下（task_links type=comment），
    // 链在任务链弹窗里继续可见。正文逐字复制，源任务不动。
    id: 'localtask.fork',
    cli: ['localtask', 'fork'],
    http: ['POST', '/api/localtasks/fork'],
    summary:
      'Fork 任务：复制正文内容为新任务，并把它挂到源任务的任务链下（保留评论/反馈链）；不继承时间目标与依赖',
    flags: { id: { type: 'number', required: true, hint: '任务编号' }, cwd: CWD, key: KEY },
    run: (ctx) => service.forkTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key }),
    render: (d) =>
      `已 Fork #${d.from.id} → #${d.task.id} @ ${d.name}（内容复制 + 保留任务链；${d.delivered ? '已实时投递' : '待领取'}）`,
  },
  {
    // 领取（todo.md 的「get」）：默认直接领——队列有任务立即返回，没有立即空手而回
    // （不阻塞）；项目开启「持续 get」（repo getLoop）后升级为 waitgoal：
    // 无任务自动唤起阻塞窗口（打开页面 + 项目配置的分钟数），领到的交付文本
    // 自带「继续 get 直到超时」的项目模板。
    id: 'localtask.claim',
    cli: ['localtask', 'get'],
    // HTTP 与 CLI 同源（#82 之前的缺口：serve 一开着，CLI 打不开库就谁也领不了）。
    // 两条路径语义一致，唯一差别是**阻塞**：HTTP 请求不允许挂住（持续 get 的阻塞
    // 窗口只属于 agent 本轮的 CLI 领取），所以走 HTTP 时强制 instant（无任务立即
    // 返回 timeout）。幂等性：领取是「取走下一条 pending」的消费动作——重复调用
    // 返回的是**再下一条**待领取任务（不是同一条）；队列空时固定返回
    // `{ status: 'timeout', instant: true }`，因此重试安全（不会重复消费同一条）。
    http: ['POST', '/api/localtasks/claim'],
    summary:
      '领取任务：有任务立即领（含任务级 timegoal 的 check 指令）；没任务默认立即返回 timeout，项目开启「持续 get」后自动唤起阻塞窗口等人回填',
    flags: {
      cwd: CWD,
      // #171：现状参数已取消——**保留 flag 只为不打断旧调用**（传了也不生效）
      summary: { type: 'string', hint: '已废弃：当前现状不再收（面板上没有对应输入界面）' },
      timeout: { type: 'number', hint: '阻塞上限（秒）；仅项目开启「持续 get」时有意义' },
      'no-open': { type: 'boolean', hint: '不自动打开浏览器（测试用）' },
      param: { type: 'array', hint: '外部参数（平面扩展）：k=v，可重复或逗号分隔；进交付模板 ctx，模板里 {{k}} / {{params.k}} 取' },
    },
    run: async (ctx, meta) => {
      const { getTask } = await import('../tasktool/get.js');
      const { parseParams } = await import('../tasktool/params.js');
      // HTTP：不阻塞、不开浏览器（面板/脚本调用不该挂住请求，也不该弹窗）
      const viaHttp = !!(meta && meta.transport === 'http');
      return getTask({
        cwd: ctx.cwd,
        timeoutSec: viaHttp ? undefined : ctx.timeout,
        open: viaHttp ? false : !ctx['no-open'],
        instant: viaHttp ? true : undefined,
        params: parseParams(ctx.param),
      });
    },
    render: renderWait, // 返回形状与 wait 同构（ok/timeout），复用同一份人读渲染
  },
  {
    // 预览（任务 #65）：编辑页「更多 → 预览 get 提示词」的接口层。
    // **只读**：不领取、不写盘、不启动时间目标计时、不为附件发网。
    // 它与真实领取走同一条 buildTaskDelivery（见 tasktool/preview.js 的三条纪律），
    // 所以预览出来的字符串就是 agent 会拿到的那一份。
    id: 'localtask.preview',
    cli: ['localtask', 'preview'],
    http: ['POST', '/api/localtasks/preview'],
    summary:
      '预览一条任务在 get/wait 时的交付提示词（只读：不领取、不写盘、不启动计时、不为附件发网）；草稿用 --text 直接预览',
    flags: {
      id: { type: 'number', hint: '任务编号（草稿预览可省，改给 --text）' },
      cwd: CWD,
      key: KEY,
      text: { type: 'string', hint: '直接预览这段正文（草稿未落库时用；给了就不读库存）' },
      param: { type: 'array', hint: '外部参数（平面扩展）：k=v，与 get 的 --param 同语义' },
    },
    run: async (ctx) => {
      const { previewTaskDelivery } = await import('../tasktool/preview.js');
      const { parseParams } = await import('../tasktool/params.js');
      const draftText = ctx.text === undefined || ctx.text === null ? '' : String(ctx.text);
      if (!draftText.trim() && (ctx.id === undefined || ctx.id === null)) {
        throw badInput('需要 --id <任务编号>（预览库存任务）或 --text <正文>（预览草稿）');
      }
      const task = draftText.trim()
        ? { id: 0, text: draftText, status: 'draft' }
        : await service.getTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
      // 任务级 timegoal 按主题 key 寻址：没显式给 key 就从 cwd 归一化出来
      const topicKey = ctx.key || service.normalizeCwd(ctx.cwd).key;
      return previewTaskDelivery({
        task,
        cwd: ctx.cwd,
        key: topicKey,
        summary: '',
        params: parseParams(ctx.param),
      });
    },
    render: renderPreview,
  },
  {
    // 修改反馈 / 重做 / 划选评论 → **就地重开原任务**（#74），历史进 history 链。
    id: 'localtask.reopen',
    cli: ['localtask', 'reopen'],
    http: ['POST', '/api/localtasks/reopen'],
    summary:
      '重开任务（验收反馈 / 重做 / 评论）：回写原任务正文，旧态压进 history；已完成则回到 pending 待再领',
    flags: {
      id: { type: 'number', required: true, hint: '任务编号' },
      cwd: CWD,
      key: KEY,
      text: { type: 'string', hint: '修改后的任务正文（Markdown）；不给则只重开不改内容' },
      kind: { type: 'string', hint: 'reopen（验收反馈，默认）或 comment（划选评论）' },
      quote: { type: 'string', hint: '划选原文（comment 时）' },
      feedback: { type: 'string', hint: '用户反馈原文；不给 text 时追加到当前正文末尾（#79，base = 服务端最新正文）' },
      feedbackHeading: { type: 'string', hint: '追加反馈段的段名（缺省 comment=## 反馈修改 / reopen=## 验收反馈）' },
      feedbackBold: { type: 'boolean', hint: '追加的反馈是否逐行加粗（缺省 comment=false / reopen=true）' },
    },
    run: async (ctx) => {
      // 重开也可能带着改过的归属（--text 的 frontmatter.project 变了）→ 同样搬家
      const { reopenTask } = await import('../tasktool/update.js');
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
        attachments: ctx.attachments,
      });
    },
    render: (d) =>
      `已重开 #${d.id} @ ${d.name}` +
      (d.before?.completedAt ? '（已完成→待领取）' : '') +
      (d.historyId != null ? `；链节点 #${d.historyId}` : '') +
      (d.moved && d.movedFrom ? `；已改归属项目，原 ${d.movedFrom.name} #${d.movedFrom.id}` : ''),
  },
  {
    // 完成门禁：带时间目标的任务未到点拒绝标记完成（提示派 sub agent 重提需求）。
    id: 'localtask.done',
    cli: ['localtask', 'done'],
    http: ['POST', '/api/localtasks/done'],
    summary:
      '标记任务完成：--summary 完成总结必填；带时间目标的任务未到点会被拒绝（blocked），到点自动记录最终 check',
    flags: {
      id: { type: 'number', required: true, hint: '任务编号' },
      cwd: CWD,
      key: KEY,
      summary: { type: 'string', required: true, hint: '完成总结（记为本轮终态 + timegoal 日志）' },
      // #171：进度参数已取消——保留 flag 只为不打断旧调用（传了也不生效）
      progress: { type: 'string', hint: '已废弃：完成度/下一步不再收（面板上没有对应输入界面）' },
    },
    run: (ctx) =>
      service.completeTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key, summary: ctx.summary }),
    render: (d) => {
      if (d.status === 'blocked') {
        const why = d.reason === 'not_claimed' ? d.hint : `时间未到（剩 ${d.remainingHuman || Math.round((d.remainingSec || 0) / 60) + ' 分钟'}，截止 ${d.deadline}）——${d.hint}`;
        return `[blocked] 任务 #${d.id} 暂不能标完成：${why}`;
      }
      if (d.already) return `任务 #${d.id} 之前已完成（${d.completedAt}），无需重复标记。`;
      const goal = d.goal && d.goal.recorded ? '（最终 check 已记录）' : '';
      return `已标记完成: #${d.id} @ ${d.name}（${d.completedAt}）${goal}`;
    },
  },
  {
    id: 'localtask.timegoalLog',
    cli: ['localtask', 'timegoal-log'],
    http: ['GET', '/api/localtasks/timegoal-log'],
    summary: '查看任务级时间目标的每轮 check 记录（时间、已用/剩余、是否到点、当轮总结与进度）',
    flags: { id: { type: 'number', required: true, hint: '任务编号' }, cwd: CWD, key: KEY },
    run: async (ctx) => {
      const topicKey = ctx.key || service.normalizeCwd(ctx.cwd).key;
      const { getTaskGoalLog } = await import('../tasktool/timegoal.js');
      return getTaskGoalLog({ topicKey, taskId: ctx.id });
    },
    render: (d) => {
      if (!d.hasGoal) return `#${d.seq || ''} 没有任务级时间目标记录。`;
      const lines = [`#${d.seq} 时间目标 check 记录 ${d.count} 轮（${d.duration} · ${d.startedAt} → ${d.deadline}）`];
      if (!d.count) lines.push('  （还没有 check 记录）');
      d.entries.forEach((e, i) => {
        lines.push(
          `  R${i + 1}  ${e.checkedAt}  已用 ${e.elapsedSec}s · 剩余 ${e.remainingSec}s${e.reached ? ' · 已到点' : ''}`,
        );
        if (e.summary) lines.push(`      ${e.summary}`);
        if (e.progress) lines.push(`      进度: ${e.progress}`);
      });
      return lines.join('\n');
    },
  },
];
