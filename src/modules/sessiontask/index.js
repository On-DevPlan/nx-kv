// 实时任务输入模块：在一个对话里通过工具调用向 agent 实时回填任务，替代原始输入框。
//
// 声明了 `resource: 'sessiontask'`，故 CRUD 五操作齐备且两端可调用
// （tests/unit/registry.test.mjs 据此断言）。核心动作是纯 CLI 的
// `sessiontask wait --cwd "<工作目录>" --summary "<当前现状>"`——agent 把它放在本轮
// **最后一步**调用：阻塞、自动打开浏览器弹窗，用户回填后解除阻塞，把新任务返回给
// agent。工作目录即主题、主题拥有任务队列：同目录共用队列、不同目录互不串，任务可
// 在主题队列里堆积。
//
// 与 todo 的区别：todo 管 KV 后端上的清单（需登录）；sessiontask 是**本机**
// 实时人机接力，数据存本地文件，不依赖后端登录态。
import * as service from './service.js';

const CWD = { type: 'string', hint: '工作目录（作为主题；默认当前目录）' };
const SUMMARY = { type: 'string', required: true, hint: '当前现状（agent 当前状态，展示给用户）' };

const STATUS_TAG = { pending: '待领取', consumed: '已领取' };

// 总览：每个主题（工作目录）一行，先看目录与现状再决定回填哪条
function renderOverview(d) {
  const lines = [`主题 ${d.topics.length} 个（等待中 ${d.waiting} · 默认超时 ${d.settings.timeoutSec}s）`];
  if (!d.topics.length) {
    lines.push('（暂无主题）');
    return lines.join('\n');
  }
  for (const t of d.topics) {
    const tag = t.waiting ? '[等待中]' : '[已结束]';
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
  ]
    .filter(Boolean)
    .join('\n');

function renderAdd(d) {
  const head = `#${d.task.id} [${d.task.status}] ${d.task.text}`;
  return d.delivered
    ? `已实时回填给等待中的 agent（主题 ${d.name}）: ${head}`
    : `已排入主题「${d.name}」队列（agent 下一次 wait 取走）: ${head}`;
}

// wait 的人读输出：成功给任务，超时明确提示「本轮结束」
function renderWait(r) {
  if (r.status === 'timeout') {
    return `等待超时（${Math.round(r.timeoutMs / 1000)} 秒未回填）：主题「${r.cwd}」现状「${r.summary}」结束本轮。`;
  }
  const origin = r.queued ? '排队任务' : '实时回填';
  return (
    `已取得下一条任务（${origin} · 主题「${r.cwd}」现状「${r.summary}」）: #${r.task.id}\n` +
    `  ${r.task.text.replace(/\n/g, '\n  ')}`
  );
}

export default {
  id: 'sessiontask',
  title: '实时任务（= Web「实时任务」页）',
  order: 20,
  view: () => import('./view.jsx'),

  // CRUD 资源声明：主题任务的增删查改齐备，CLI 与面板都能调用
  resource: 'sessiontask',

  actions: [
    // ─── CRUD 五操作 ───────────────────────────────────────────
    {
      id: 'sessiontask.list',
      cli: ['sessiontask', 'list'],
      http: ['GET', '/api/sessiontasks'],
      summary: '总览全部主题（工作目录、现状、是否等待中、待领取数）',
      run: () => service.listTasks(),
      render: renderOverview,
    },
    {
      id: 'sessiontask.get',
      cli: ['sessiontask', 'get'],
      http: ['GET', '/api/sessiontasks/item'],
      summary: '查看单条任务（按 --id，定位到 --cwd 主题）',
      flags: { id: { type: 'number', required: true, hint: '任务编号' }, cwd: CWD },
      run: (ctx) => service.getTask({ id: ctx.id, cwd: ctx.cwd }),
      render: renderTask,
    },
    {
      id: 'sessiontask.add',
      cli: ['sessiontask', 'add'],
      http: ['POST', '/api/sessiontasks'],
      summary: '向某主题（工作目录）的队列回填一条任务（有 wait 在等则即时投递，否则排队）',
      args: ['text'],
      flags: { cwd: CWD, summary: { type: 'string', hint: '顺带刷新该主题的当前现状（可选）' } },
      run: (ctx) => service.addTask({ text: ctx.text, cwd: ctx.cwd, summary: ctx.summary }),
      render: renderAdd,
    },
    {
      id: 'sessiontask.update',
      cli: ['sessiontask', 'update'],
      http: ['PATCH', '/api/sessiontasks/item'],
      summary: '编辑任务内容（按 --id，定位到 --cwd 主题）',
      flags: {
        id: { type: 'number', required: true, hint: '任务编号' },
        text: { type: 'string', required: true, hint: '改成这个内容' },
        cwd: CWD,
      },
      run: (ctx) => service.updateTask({ id: ctx.id, text: ctx.text, cwd: ctx.cwd }),
      render: (d) => `已更新主题「${d.name}」#${d.task.id}: ${d.task.text}`,
    },
    {
      id: 'sessiontask.remove',
      cli: ['sessiontask', 'remove'],
      http: ['DELETE', '/api/sessiontasks/item'],
      summary: '删除一条任务（按 --id，定位到 --cwd 主题）',
      flags: { id: { type: 'number', required: true, hint: '任务编号' }, cwd: CWD },
      run: (ctx) => service.removeTask({ id: ctx.id, cwd: ctx.cwd }),
      render: (d) => `已删除主题「${d.name}」#${d.removed.id}: ${d.removed.text}`,
    },

    {
      id: 'sessiontask.config',
      cli: ['sessiontask', 'config'],
      http: ['PATCH', '/api/sessiontasks/setting'],
      summary: '配置等待超时（秒；推荐 180=3 分钟，最大 600=10 分钟，超上限自动截断）',
      flags: { timeout: { type: 'number', required: true, hint: '超时秒数（1-600）' } },
      run: (ctx) => service.updateSettings({ timeoutSec: ctx.timeout }),
      render: (s) => `已配置等待超时 ${s.timeoutSec} 秒（推荐 ${s.recommendedSec}，最大 ${s.maxSec}）`,
    },

    {
      id: 'sessiontask.prune',
      cli: ['sessiontask', 'prune'],
      http: ['POST', '/api/sessiontasks/prune'],
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

    // ─── 阻塞等待（纯 CLI，agent 本轮最后一步）────────────────
    {
      id: 'sessiontask.wait',
      cli: ['sessiontask', 'wait'],
      http: null,
      summary: '针对某主题（按 cwd 目录名识别）阻塞等待用户回填（默认 3 分钟，最大 10 分钟）',
      flags: {
        cwd: CWD,
        summary: SUMMARY,
        timeout: { type: 'number', hint: '阻塞上限（秒）；缺省用页面配置（推荐 180，最大 600）' },
        'no-open': { type: 'boolean', hint: '不自动打开浏览器（测试用）' },
      },
      run: (ctx) =>
        service.waitForTask({
          cwd: ctx.cwd,
          summary: ctx.summary,
          timeoutSec: ctx.timeout,
          open: !ctx['no-open'],
        }),
      render: renderWait,
    },
  ],
};
