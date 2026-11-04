// 本地任务（localtask）模块：本机按「工作目录（cwd）」划分的任务队列——提交（add）、
// 领取（wait）、查看/编辑/删除/调序（list/get/update/remove/reorder）与主题管理。
// 阻塞等待只是当前的一个子功能：agent 在一个对话里需要用户继续给任务时，不必结束
// 本轮、等用户去原始输入框打字，而是把
// `localtask wait --cwd "<工作目录>" --summary "<当前现状>"` 作为本轮**最后一步**调用：
// 命令阻塞、自动打开浏览器弹窗，用户回填后解除阻塞、把新任务作为结果返回，agent 接着干。
//
// 声明了 `resource: 'localtask'`，故 CRUD 五操作齐备且两端可调用
// （tests/unit/registry.test.mjs 据此断言）。工作目录即主题、主题拥有任务队列：
// 同目录共用队列、不同目录互不串，任务可在主题队列里堆积。
//
// 与 todo 的区别：todo 管 KV 后端上的清单（需登录）；localtask 是**本机**
// 任务队列，数据存本地文件，不依赖后端登录态。
import * as service from './service.js';
import * as move from './move.js';
import { badInput } from '../../core/errors.js';

const CWD = { type: 'string', hint: '工作目录（作为主题；默认当前目录）' };
const SUMMARY = { type: 'string', required: true, hint: '当前现状（agent 当前状态，展示给用户）' };
// 任务级寻址的 key flag：全局主题没有 cwd，只能按 key 定位（__GLOBAL__）
const KEY = { type: 'string', hint: '主题 key（与 --cwd 二选一；全局任务池固定 __GLOBAL__）' };

const STATUS_TAG = { pending: '待领取', consumed: '已领取' };

// 总览：每个主题（工作目录）一行，先看目录与现状再决定回填哪条
function renderOverview(d) {
  const lines = [`主题 ${d.topics.length} 个（等待中 ${d.waiting} · 默认超时 ${d.settings.timeoutSec}s）`];
  if (!d.topics.length) {
    lines.push('（暂无主题）');
    return lines.join('\n');
  }
  for (const t of d.topics) {
    const tag = t.isGlobal ? '[全局池]' : t.waiting ? '[等待中]' : '[已结束]';
    const head = t.cwd ? `${t.name}  ${t.cwd}` : t.name;
    lines.push(`  ${tag} ${head}  · 待领取 ${t.pending}/${t.total}`);
    if (t.summary) lines.push(`        现状: ${t.summary}`);
  }
  return lines.join('\n');
}

const renderTask = (t) =>
  [
    `#${t.id}  [${STATUS_TAG[t.status] || t.status}]  ${t.text}`,
    `  创建: ${t.createdAt}`,
    t.consumedAt ? `  领取: ${t.consumedAt}` : '',
    // 附件清单（正文里的 ![名](fileId) 嵌入；本地已有 → 直接给绝对路径）
    ...(t.attachments || []).map(
      (a) => `  附件:   ${a.localPath || a.name}${a.localPath ? '' : `（未同步；nx-kv file sync --ids ${a.id}）`}`
    ),
  ]
    .filter(Boolean)
    .join('\n');

// `localtask attachments` 的人读输出（与 todo attachments 同构）
function renderTaskAttachments(d) {
  const lines = [
    `#${d.task.id}  附件 ${d.count} 个 · 本地目录: ${d.localDir}（自动下载 ${d.autoSync ? '开' : '关'}）`,
  ];
  if (!d.count) {
    lines.push('  （这条任务没有引用附件）');
    return lines.join('\n');
  }
  for (const a of d.attachments) {
    lines.push(`  ${a.kind === 'image' ? '图片' : '附件'}  ${a.name}  [${a.id}]`);
    lines.push(`      ${a.localPath || '（未同步；nx-kv file sync --ids ' + a.id + '）'}`);
  }
  return lines.join('\n');
}

function renderAdd(d) {
  const where = d.isGlobal ? '全局任务（共享池）' : `主题「${d.name}」`;
  const head = `#${d.task.id} [${d.task.status}] ${d.task.text}`;
  const ignored = d.ignoredCwd
    ? `\n注意：--global 优先，你给的 --cwd「${d.ignoredCwd}」未生效（任务进了全局池）。`
    : '';
  const body = d.delivered
    ? `已实时投递给等待中的 agent（${where}）: ${head}`
    : `已排入${where}队列（agent 下一次 wait 取走）: ${head}`;
  return body + ignored;
}

// wait 的人读输出：成功给任务（注明来自本地队列还是全局共享池），超时明确提示「本轮结束」
function renderWait(r) {
  if (r.status === 'timeout') {
    // 两种"取消"要分清楚：时间目标到点（预算用完，agent 该收尾写总结了）
    // vs 用户在面板点了「关闭等待」。
    if (r.reason === 'goal_expired') {
      return `时间目标已到点，本局预算用完（没有下一条任务）：主题「${r.cwd}」现状「${r.summary}」结束本轮。`;
    }
    const tail = r.cancelled ? '（用户在面板点了「关闭」）' : '';
    return `等待超时（${Math.round(r.timeoutMs / 1000)} 秒未回填）${tail}：主题「${r.cwd}」现状「${r.summary}」结束本轮。`;
  }
  // 「实时回填 / 排队任务」按 **delivered** 判，不要按 queued 反推：
  // 跨进程轮询捡走的那条是 queued:false + delivered:false —— 它其实来自队列，
  // 只是被 500ms 的轮询取到了；按 queued 反推会把它说成「实时回填」，是假的。
  const how = r.delivered ? '实时回填' : '排队任务';
  const origin = (r.source === 'global' ? '全局任务池' : '本目录队列') + ` · ${how}`;
  const header = `已取得下一条任务（${origin} · 主题「${r.cwd}」现状「${r.summary}」）: #${r.task.id}`;
  const indent = (s) => String(s).replace(/\n/g, '\n  ');
  // instruction（模板渲染的收尾指令）与任务正文分区打印：正文块照旧；
  // instruction 自包含正文（模板含 {{task.text}}，服务端给出 coversBody 标志）时
  // 直接替掉正文块——两种排布都不丢内容。无 instruction → 与旧输出逐字节一致。
  if (r.instruction && r.coversBody) {
    return `${header}\n  ${indent(r.instruction)}`;
  }
  const body = `${header}\n  ${indent(r.task.text)}`;
  return r.instruction ? `${body}\n  ── 收尾指令 ──\n  ${indent(r.instruction)}` : body;
}

// cancel 的人读输出：等待中→已关闭（主题与任务保留）；非等待中→无操作；全局→不可关闭
function renderCancel(d) {
  if (d.cancelled) return `已关闭主题「${d.name}」的等待：阻塞中的 wait 立即收尾，主题与任务保留。`;
  if (d.reason === 'global_not_waitable') return '全局主题是共享任务池（不是等待源），无从关闭。';
  if (d.reason === 'not_waiting') return `主题「${d.name || d.key}」不在等待中，无需关闭。`;
  return '已关闭。';
}

// 批量删除的人读输出：删除清单 + 跳过清单（等待中/受保护/不存在）
function renderRemoveMany(d) {
  const lines = [d.all ? `清空：删除 ${d.count} 个主题` : `已删除 ${d.count} 个主题`];
  for (const r of d.removed) lines.push(`  - ${r.name}${r.cwd ? `  ${r.cwd}` : ''}`);
  if (d.skipped.length) {
    lines.push(`跳过 ${d.skipped.length} 个：`);
    for (const s of d.skipped) {
      const why = s.reason === 'waiting' ? '等待中' : s.reason === 'protected' ? '全局共享池' : s.reason === 'has_pending' ? `有 ${s.pending || 0} 条未领取任务` : '不存在';
      lines.push(`  - [${why}] ${s.name || s.key}`);
    }
  }
  if (!d.removed.length && !d.skipped.length) lines.push('（没有匹配的主题）');
  return lines.join('\n');
}

export default {
  id: 'localtask',
  title: '本地任务（= Web「本地任务」页）',
  order: 20,

  // CRUD 资源声明：主题任务的增删查改齐备，CLI 与面板都能调用
  resource: 'localtask',

  actions: [
    // ─── CRUD 五操作 ───────────────────────────────────────────
    {
      id: 'localtask.list',
      cli: ['localtask', 'list'],
      http: ['GET', '/api/localtasks'],
      summary: '总览全部主题（工作目录、现状、是否等待中、待领取数）',
      run: () => service.listTasks(),
      render: renderOverview,
    },
    {
      id: 'localtask.get',
      // CRUD get（查看单条）。CLI 动词让位给「领取」语义：`localtask get` 现在是
      // 领任务（见 localtask.claim），查看走 `localtask show`。HTTP 路由不变。
      cli: ['localtask', 'show'],
      http: ['GET', '/api/localtasks/item'],
      summary: '查看单条任务（按 --id，定位到 --cwd 主题或 --key）；正文引用附件时带附件清单与本地路径（自动下载跟随本机设置）',
      flags: { id: { type: 'number', required: true, hint: '任务编号' }, cwd: CWD, key: KEY },
      run: async (ctx) => {
        const task = await service.getTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
        // 附件标注（任务 #15）：解析正文嵌入 + 按设置自动下载 + 标本地路径。
        // fail-open：标注坏了照常返回任务本体。
        const { annotateTaskDelivery } = await import('../tasktool/attach.js');
        const att = await annotateTaskDelivery(task).catch(() => null);
        return att
          ? { ...task, attachments: att.task.attachments, ...(att.sync ? { attachmentsSync: att.sync } : {}) }
          : task;
      },
      render: renderTask,
    },
    {
      // 领取（todo.md 的「get」）：默认直接领——队列有任务立即返回，没有立即空手而回
      // （不阻塞）；项目开启「持续 get」（repo getLoop）后升级为 waitgoal：
      // 无任务自动唤起阻塞窗口（打开页面 + 项目配置的分钟数），领到的交付文本
      // 自带「继续 get 直到超时」的项目模板。
      id: 'localtask.claim',
      cli: ['localtask', 'get'],
      http: null, // 与 wait 同族：阻塞语义只走 CLI（agent 本轮的领取动作）
      summary:
        '领取任务：有任务立即领（含任务级 timegoal 的 check 指令）；没任务默认立即返回 timeout，项目开启「持续 get」后自动唤起阻塞窗口等人回填',
      flags: {
        cwd: CWD,
        summary: { type: 'string', hint: '当前现状（agent 状态，展示给用户）' },
        timeout: { type: 'number', hint: '阻塞上限（秒）；仅项目开启「持续 get」时有意义' },
        'no-open': { type: 'boolean', hint: '不自动打开浏览器（测试用）' },
      },
      run: async (ctx) => {
        const { getTask } = await import('../tasktool/get.js');
        return getTask({ cwd: ctx.cwd, summary: ctx.summary, timeoutSec: ctx.timeout, open: !ctx['no-open'] });
      },
      render: renderWait, // 返回形状与 wait 同构（ok/timeout），复用同一份人读渲染
    },
    {
      // 修改反馈 → 重新进入执行循环：任务回到 pending，agent 可再次领取。
      id: 'localtask.reopen',
      cli: ['localtask', 'reopen'],
      http: ['POST', '/api/localtasks/reopen'],
      summary:
        '重开任务（用户的修改反馈）：任务回到待领取，领取时间作废（新一轮重新计时）；--text 可带上修改后的正文（Markdown）',
      flags: {
        id: { type: 'number', required: true, hint: '任务编号' },
        cwd: CWD,
        key: KEY,
        text: { type: 'string', hint: '修改后的任务正文（Markdown）；不给则只重开不改内容' },
      },
      run: (ctx) => service.reopenTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key, text: ctx.text }),
      render: (d) => `已重开任务 #${d.id} @ ${d.name}（回到待领取，第 ${d.task.reopenCount} 次重开）`,
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
        progress: { type: 'string', hint: '完成度/下一步（≤2000 字，一并写入日志）' },
      },
      run: (ctx) =>
        service.completeTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key, summary: ctx.summary, progress: ctx.progress }),
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
      },
      run: async (ctx) => {
        // 派任务编排已迁 tasktool/add.js（任务工具语义归 tasktool；命令名不变）。
        // 落点判定（--board/--project 严格口径 / 正文 frontmatter fail-open）只此一份实现，
        // CLI、HTTP、面板提交同走这一条链路。
        const { submitTask } = await import('../tasktool/add.js');
        return submitTask({
          text: ctx.text,
          cwd: ctx.cwd,
          summary: ctx.summary,
          global: ctx.global,
          board: ctx.board,
          project: ctx.project,
          duration: ctx.duration,
          goalPrompt: ctx.goalPrompt ?? ctx['goal-prompt'],
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
      },
      run: (ctx) => {
        const gp = ctx.goalPrompt ?? ctx['goal-prompt'];
        const cg = ctx.clearGoal ?? ctx['clear-goal'];
        const hasGoalInput = ctx.duration != null || gp != null || cg;
        return service.updateTask({
          id: ctx.id,
          text: ctx.text,
          cwd: ctx.cwd,
          key: ctx.key,
          goal: hasGoalInput ? { duration: ctx.duration, prompt: gp, clear: !!cg } : undefined,
        });
      },
      render: (d) =>
        `已更新主题「${d.name}」#${d.task.id}: ${d.task.text}` +
        (d.goalChanged === 'set'
          ? `（时间目标：${d.task.timegoal.duration}${d.task.timegoal.prompt ? ' · 附加要求已固化' : ''}）`
          : d.goalChanged === 'cleared'
            ? '（时间目标已清除）'
            : ''),
    },
    {
      // 附件追加（与云端 todo attach 同构）：--path 落**本机附件仓**（零云端）→ 嵌入正文末尾；
      // --fileId 引用已有附件（本机仓 / 云端 id）。面板编辑器贴同一条语法（components/md/attachments.js）。
      id: 'localtask.attach',
      cli: ['localtask', 'attach'],
      http: ['POST', '/api/localtasks/attach'],
      summary: '给任务追加附件：--path 存本机附件仓（不碰云端），或 --fileId 引用已有附件，以 markdown 嵌入正文末尾（不替换正文）',
      flags: {
        id: { type: 'number', required: true, hint: '任务编号' },
        cwd: CWD,
        key: KEY,
        path: { type: 'string', hint: '本机文件路径（落 ~/.nx-kv/attachments/local/ 再嵌入）' },
        fileId: { type: 'string', hint: '已有附件的 id（32 位 hex，可带扩展名；本机仓或云端）' },
        name: { type: 'string', hint: '嵌入文字与本地文件名（默认取原文件名）' },
        kind: { type: 'string', hint: 'image | file（不给按文件名/扩展名判）' },
      },
      run: async (ctx) => {
        const { attachToTask } = await import('../tasktool/attach.js');
        return attachToTask({
          id: ctx.id,
          cwd: ctx.cwd,
          key: ctx.key,
          path: ctx.path,
          fileId: ctx.fileId,
          name: ctx.name,
          kind: ctx.kind,
        });
      },
      render: (d) =>
        `已附加 ${d.fileId}（${d.kind === 'image' ? '图片' : '文件'}）到主题「${d.name}」#${d.task.id}\n嵌入: ${d.markdown}`,
    },
    {
      id: 'localtask.attachments',
      cli: ['localtask', 'attachments'],
      http: ['GET', '/api/localtasks/attachments'],
      summary: '列出某条任务引用的附件（正文里的 ![名](fileId) 嵌入），以及本地是否已有（给 agent 直接读本地文件）',
      flags: { id: { type: 'number', required: true, hint: '任务编号' }, cwd: CWD, key: KEY },
      run: async (ctx) => {
        const { listTaskAttachments } = await import('../tasktool/attach.js');
        return listTaskAttachments({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
      },
      render: renderTaskAttachments,
    },
    {
      id: 'localtask.remove',
      cli: ['localtask', 'remove'],
      http: ['DELETE', '/api/localtasks/item'],
      summary: '删除一条任务（按 --id，定位到 --cwd 主题或 --key）；删除是**可恢复**的（软删除），加 --purge 彻底清除',
      flags: {
        id: { type: 'number', required: true, hint: '任务编号' },
        cwd: CWD,
        key: KEY,
        purge: { type: 'boolean', hint: '彻底删除（不可恢复）；不加就是软删除，可 restore 回来' },
      },
      run: (ctx) => service.removeTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key, purge: ctx.purge }),
      render: (d) =>
        d.purged
          ? `已彻底删除主题「${d.name}」#${d.removed.id}: ${d.removed.text}（不可恢复）`
          : `已删除主题「${d.name}」#${d.removed.id}: ${d.removed.text}（可用 localtask task restore 恢复）`,
    },
    {
      id: 'localtask.removeMany',
      cli: ['localtask', 'remove-many'],
      http: ['DELETE', '/api/localtasks/items'],
      summary:
        '批量删除任务（按 --ids，定位到 --cwd 主题或 --key）：一次落盘，逐条软删除（可 restore 恢复）；缺失的编号不阻断其余删除',
      flags: {
        ids: { type: 'array', required: true, hint: '任务编号，逗号分隔或给多次' },
        cwd: CWD,
        key: KEY,
        purge: { type: 'boolean', hint: '彻底删除（不可恢复）；不加就是软删除' },
      },
      run: (ctx) => service.removeTasks({ ids: ctx.ids, cwd: ctx.cwd, key: ctx.key, purge: ctx.purge }),
      render: (d) => {
        const done = d.removed.map((x) => `#${x.id}`).join(' ');
        const head = d.count
          ? `${d.purged ? '已彻底删除' : '已删除'}主题「${d.name}」${d.count} 条（${done}）`
          : `主题「${d.name}」没有可删的任务`;
        const tail = d.missing.length ? `；未找到 #${d.missing.join(' #')}` : '';
        const how = d.count && !d.purged ? '；可用 localtask task restore 恢复' : '';
        return head + tail + how;
      },
    },
    {
      id: 'localtask.task.restore',
      cli: ['localtask', 'task', 'restore'],
      http: ['POST', '/api/localtasks/tasks/restore'],
      summary: '恢复一条被删除（软删除）的任务（撤销删除）',
      flags: { id: { type: 'number', required: true, hint: '任务编号' }, cwd: CWD, key: KEY },
      run: (ctx) => service.restoreTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key }),
      render: (d) =>
        d.restored
          ? `已恢复主题「${d.name}」#${d.task.id}: ${d.task.text}`
          : `主题「${d.name}」#${d.task.id} 本来就没被删除，无需恢复。`,
    },

    // ─── 主题删除（单个 / 批量）──────────────────────────────
    {
      id: 'localtask.topic.add',
      cli: ['localtask', 'topic', 'add'],
      http: ['POST', '/api/localtasks/topic'],
      summary: '登记一个工作目录：空目录也常驻（prune 不清）；--summary 顺带写「现状摘要」（面板顶栏摘要的编辑入口）',
      flags: { cwd: { type: 'string', required: true, hint: '工作目录（绝对路径或可解析的相对路径）' }, summary: { type: 'string', hint: '现状摘要（可选；已登记目录即更新）' } },
      run: (ctx) => service.addTopic({ cwd: ctx.cwd, summary: ctx.summary }),
      render: (d) =>
        `${d.existed ? '已更新' : '已登记'}目录「${d.name}」${d.cwd}` +
        (d.existed ? '（原先已存在）' : ''),
    },
    {
      id: 'localtask.topic.remove',
      cli: ['localtask', 'topic', 'remove'],
      http: ['DELETE', '/api/localtasks/topic'],
      summary: '删除整个主题（含全部任务；按 --cwd 或 --key，等待中需 --force）',
      flags: {
        cwd: { type: 'string', hint: '工作目录（与 --key 二选一）' },
        key: { type: 'string', hint: '主题 key（与 --cwd 二选一）' },
        force: { type: 'boolean', hint: '连等待中的主题也删（agent 将超时收尾）' },
      },
      run: (ctx) => service.removeTopic({ cwd: ctx.cwd, key: ctx.key, force: ctx.force }),
      render: (d) =>
        `已删除主题「${d.name}」（待领取/共 ${d.topic.pending}/${d.topic.total} 条任务一并删除）`,
    },
    {
      id: 'localtask.topic.removeMany',
      cli: ['localtask', 'topic', 'remove-many'],
      http: ['POST', '/api/localtasks/topics/remove'],
      summary: '批量删除主题（--keys/--cwds 逗号分隔，或 --all；等待中默认跳过，--force 连等待中删）',
      flags: {
        keys: { type: 'array', hint: '主题 key，逗号分隔' },
        cwds: { type: 'array', hint: '工作目录，逗号分隔' },
        all: { type: 'boolean', hint: '清空全部主题（等待中仍跳过，除非 --force）' },
        force: { type: 'boolean', hint: '连等待中的主题一起删' },
      },
      run: (ctx) =>
        service.removeTopics({ keys: ctx.keys, cwds: ctx.cwds, all: ctx.all, force: ctx.force }),
      render: renderRemoveMany,
    },

    {
      id: 'localtask.config',
      cli: ['localtask', 'config'],
      http: ['PATCH', '/api/localtasks/setting'],
      summary:
        '配置等待超时（秒）/ 收尾指令（wait 返回时渲染进 instruction 字段或追加正文，可配多条）',
      flags: {
        timeout: { type: 'number', hint: '超时秒数（1-600）' },
        suffix: {
          type: 'string',
          hint: '收尾指令（整体替换为这一条）。占位符：{{goal.name}} {{goal.remainingHuman}} {{goal.deadline}} {{goal.prompt}} {{task.id}} {{task.text}} {{source}} {{summary}} {{cwd}} {{name}}；段落 {{#goal}}…{{/goal}}/{{#task}}…{{/task}}（上下文缺失整段消失）。含 {{ 渲染进 instruction、task.text 保持原文；纯文本（无 {{）维持旧追加行为；置空关闭；不支持字面 {{ 转义（与 --reset-suffix/--no-suffix 互斥）',
        },
        'reset-suffix': { type: 'boolean', hint: '恢复默认收尾指令（单条）' },
        'no-suffix': { type: 'boolean', hint: '清空并关闭收尾指令' },
        'suffix-add': {
          type: 'string',
          hint: '追加一条收尾指令（与既有各条并存，按空行拼接交付；≤2000 字）——与 --suffix/--no-suffix/--reset-suffix 互斥',
        },
        'suffix-remove': {
          type: 'number',
          hint: '按序号删除一条收尾指令（--json settings.taskSuffixList 的 1 基序号）——与 --suffix/--no-suffix/--reset-suffix 互斥',
        },
      },
      run: async (ctx) => {
        const patch = { timeoutSec: ctx.timeout };
        const add = ctx['suffix-add'];
        const removeN = ctx['suffix-remove'];
        if (add !== undefined || removeN !== undefined) {
          // 按条增删要在**现有列表**上操作——与整体替换类 flag 互斥，避免同一次调用
          // 又替换又增删时序号语义说不清。
          if (ctx['no-suffix'] || ctx['reset-suffix'] || ctx.suffix !== undefined) {
            throw badInput('--suffix-add / --suffix-remove 不能与 --suffix / --no-suffix / --reset-suffix 同用');
          }
          const cur = (await service.getSettings()).taskSuffixList;
          if (removeN !== undefined) {
            const n = Number(removeN);
            if (!Number.isInteger(n) || n < 1 || n > cur.length) {
              throw badInput(`--suffix-remove 需为 1-${cur.length} 的序号（当前 ${cur.length} 条）`);
            }
            cur.splice(n - 1, 1);
          }
          if (add !== undefined && String(add).trim()) cur.push(String(add));
          patch.taskSuffix = cur;
        } else if (ctx['no-suffix']) patch.taskSuffix = [];
        else if (ctx['reset-suffix']) patch.taskSuffix = [service.DEFAULT_TASK_SUFFIX];
        else if (ctx.suffix !== undefined) patch.taskSuffix = ctx.suffix;
        return service.updateSettings(patch);
      },
      render: (s) => {
        const x = s.suffixEnabled
          ? `收尾指令已开启（${s.taskSuffixList.length} 条）`
          : '收尾指令已关闭';
        return `已配置等待超时 ${s.timeoutSec} 秒（推荐 ${s.recommendedSec}，最大 ${s.maxSec}）· ${x}`;
      },
    },

    {
      id: 'localtask.prune',
      cli: ['localtask', 'prune'],
      http: ['POST', '/api/localtasks/prune'],
      summary: '清理旧脏数据（旧模型无目录主题、空主题；等待中一律保留）',
      flags: {
        'all-finished': { type: 'boolean', hint: '连同已全部领取、无待领的主题一起清' },
        'dry-run': { type: 'boolean', hint: '只报告将清理哪些，不实际删除' },
      },
      run: (ctx) => service.pruneTopics({ allFinished: ctx['all-finished'], dryRun: ctx['dry-run'] }),
      render: (d) => {
        const head = d.dryRun ? '（预演）将清理' : '已清理';
        if (!d.count) return `${head} 0 个主题（无旧脏数据）。`;
        return `${head} ${d.count} 个主题：\n` + d.removed.map((r) => `  - [${r.reason}] ${r.name}${r.cwd ? `  ${r.cwd}` : ''}`).join('\n');
      },
    },

    {
      id: 'localtask.reorder',
      cli: ['localtask', 'reorder'],
      http: ['PATCH', '/api/localtasks/reorder'],
      summary: '调整待领取任务优先级（--id <编号> 移到 --before-id <编号> 前或 --after-id <编号> 后）',
      flags: {
        id: { type: 'number', required: true, hint: '要移动的任务编号' },
        beforeId: { type: 'number', hint: '插到该编号之前（与 afterId 二选一）' },
        afterId: { type: 'number', hint: '插到该编号之后（与 beforeId 二选一）' },
        // 连字符写法也认：help 文案一直写的是 --before-id / --after-id，
        // 但真去敲会报「未知参数」——文档与实现对不上，用户第一次用就踩。
        'before-id': { type: 'number', hint: '同 --beforeId（连字符写法）' },
        'after-id': { type: 'number', hint: '同 --afterId（连字符写法）' },
        cwd: CWD,
        key: KEY,
      },
      run: (ctx) =>
        service.reorderTasks({
          id: ctx.id,
          beforeId: ctx.beforeId !== undefined ? ctx.beforeId : ctx['before-id'],
          afterId: ctx.afterId !== undefined ? ctx.afterId : ctx['after-id'],
          cwd: ctx.cwd,
          key: ctx.key,
        }),
      render: (d) => {
        const order = d.topic.tasks.filter((x) => x.status !== 'consumed').map((x) => `#${x.id}`);
        return `主题「${d.name}」待领取顺序：${order.join(' -> ') || '（无待领取）'}`;
      },
    },

    // ─── 本机 ⇄ 云端 迁移（面板与 CLI 同构，原型设计稿 §5/§7.3）───
    {
      id: 'task.move',
      cli: ['task', 'move'],
      http: ['POST', '/api/task/move'],
      summary:
        '在本机队列与云端清单之间迁移任务（先写目标端、成功才改源端；--undo 按返回的 target-id 精确撤销）',
      flags: {
        from: { type: 'string', enum: ['local', 'cloud'], hint: '迁移源' },
        to: { type: 'string', enum: ['local', 'cloud'], hint: '迁移目标' },
        // 源/目标定位：local 侧用 --id + (--cwd|--key)；cloud 侧用 --topic + --text
        id: { type: 'number', hint: '本机任务编号（from=local 时必填）' },
        cwd: CWD,
        key: KEY,
        topic: { type: 'string', hint: '云端主题（= 目录名；from=cloud 必填，to=cloud 缺省用目录名）' },
        text: { type: 'string', hint: '云端任务内容（from=cloud 时按内容定位）' },
        pick: { type: 'number', hint: '云端同内容多条时的编号（消歧）' },
        merge: { type: 'boolean', hint: '目标端已有同内容时合并到已有条目（不新增）' },
        group: { type: 'number', hint: '云端工作空间 id（默认取当前）' },
        undo: { type: 'boolean', hint: '撤销一次迁移（配合 --target-id 与原 move 参数）' },
        'target-id': { type: 'number', hint: '撤销用：迁移时返回的 targetId' },
        'tombstone-id': { type: 'number', hint: '撤销 local→cloud 时可显式指定本机迁出条目编号（缺省用 --id）' },
      },
      run: (ctx) =>
        move.moveTask({
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
        }),
      render: (d) => {
        if (d.undone) {
          return d.from === 'local'
            ? `已撤销: 云端「${d.topic}」的条目已删除，本机「${d.dirName}」#${d.tombstoneId} 回到待领取`
            : `已撤销: 本机「${d.dirName}」#${d.targetId} 已移除，云端「${d.topic}」已恢复`;
        }
        const head =
          d.from === 'local'
            ? `本机「${d.dirName}」#${d.tombstoneId} → 云端「${d.topic}」（${d.merged ? `合并到已有条目 #${d.targetId}` : `新待办 #${d.targetId}`}）`
            : `云端「${d.topic}」 → 本机「${d.dirName}」（待领取首位 #${d.targetId}）`;
        const tail = d.from === 'local' ? `\n原位置留有迁出记录（可在面板跳转/移除；task move --undo 撤销）` : '';
        return head + (d.dupCount ? `\n（目标端原有 ${d.dupCount} 条同内容）` : '') + tail;
      },
    },

    // ─── 阻塞等待（纯 CLI，agent 本轮最后一步）────────────────
    {
      id: 'localtask.wait',
      cli: ['localtask', 'wait'],
      http: null,
      summary:
        '针对某主题（按 cwd 目录名识别）阻塞等待用户回填（默认 3 分钟，最大 10 分钟）；本地空时自动领取全局共享池的任务',
      flags: {
        cwd: CWD,
        summary: SUMMARY,
        timeout: { type: 'number', hint: '阻塞上限（秒）；缺省用页面配置（推荐 180，最大 600）' },
        'no-open': { type: 'boolean', hint: '不自动打开浏览器（测试用）' },
      },
      run: async (ctx) => {
        // wait 编排已迁 tasktool/wait.js（任务工具语义归 tasktool；命令名不变）
        const { waitForTask } = await import('../tasktool/wait.js');
        return waitForTask({
          cwd: ctx.cwd,
          summary: ctx.summary,
          timeoutSec: ctx.timeout,
          open: !ctx['no-open'],
        });
      },
      render: renderWait,
    },

    {
      id: 'localtask.cancel',
      cli: ['localtask', 'cancel'],
      http: ['POST', '/api/localtasks/cancel'],
      summary: '关闭某主题的等待：阻塞中的 wait 立即收尾（与超时同一出口，带 cancelled 标记；不删主题与任务）',
      flags: {
        cwd: { type: 'string', hint: '工作目录（与 --key 二选一）' },
        key: { type: 'string', hint: '主题 key（与 --cwd 二选一）' },
      },
      run: (ctx) => service.cancelWait({ cwd: ctx.cwd, key: ctx.key }),
      render: renderCancel,
    },

    {
      // 探测常驻面板上当前正打开的「实时任务」标签数（活动 SSE 连接数）。
      // wait 开页前先经此端点：有活标签就复用、不再 openBrowser 新开页（避免 Edge 重复开标签）；
      // 没有活标签时才开页深链。探测失败 / 旧版无此端点时 service 保守返回 0，不阻塞 wait。
      id: 'localtask.presence',
      cli: ['localtask', 'presence'],
      http: ['GET', '/api/localtasks/presence'],
      summary: '探测主面板上当前打开的「实时任务」标签数（活动 SSE 连接数；用于 wait 不重复开页）',
      // HTTP 形态读**本进程**的计数（只有 serve 进程里才有 SSE 连接）；
      // CLI 形态去问常驻主面板 —— 否则 CLI 永远报 0（这条命令形同虚设）。
      run: (ctx, opts) =>
        opts && opts.transport === 'http'
          ? service.httpPanelPresence()
          : service.queryPanelPresence(),
      render: (d) =>
        `主面板当前有 ${d.clients} 个活动标签` +
        (d.source === 'self' ? '（主面板没在跑或探测失败，这里是本进程内计数）' : ''),
    },

    {
      // 等待生命周期事件流：SSE 端点（带 cwd/key 过滤），由 watchEvents 派生 waiting/reminder/resolved。
      // action 标 stream:true → api.js 透传 req/res，run 自己接管响应不走 sendJson。
      id: 'localtask.events',
      cli: ['localtask', 'events'],
      http: ['GET', '/api/localtasks/events'],
      summary: '等待事件流：waiting 开始 / reminder 30s·10s / resolved delivered|timeout（SSE 长连接）',
      flags: {
        cwd: { type: 'string', hint: '工作目录过滤（与 --key 二选一）' },
        key: { type: 'string', hint: '主题 key 过滤（与 --cwd 二选一）' },
        timeout: { type: 'number', hint: '最多监听多少秒后自动结束（默认不限）' },
        limit: { type: 'number', hint: '最多输出多少条事件后自动结束（默认不限）' },
      },
      stream: true,
      // 按传输方式分流：
      //   HTTP → SSE（req/res 透传，api.js 只在 HTTP 下注入 ctx.__raw）
      //   CLI  → 逐行 NDJSON（以前 CLI 跑这条命令必崩：ctx.__raw 是 undefined）
      run: (ctx, opts) =>
        opts && opts.transport === 'http'
          ? service.streamEventsSSE(ctx.__raw.req, ctx.__raw.res, { cwd: ctx.cwd, key: ctx.key })
          : service.streamEventsNDJSON({
              cwd: ctx.cwd,
              key: ctx.key,
              timeoutSec: ctx.timeout,
              limit: ctx.limit,
            }),
    },
  ],
};
