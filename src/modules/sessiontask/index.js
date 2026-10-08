// 实时任务输入模块：在一个对话里通过工具调用向 agent 实时回填任务，替代原始输入框。
//
// 声明了 `resource: 'sessiontask'`，故 CRUD 五操作齐备且两端可调用
// （tests/unit/registry.test.mjs 据此断言）。核心动作是纯 CLI 的
// `sessiontask wait --summary "<现状总结>"`——agent 把它放在本轮**最后一步**
// 调用：阻塞、自动打开浏览器弹窗，用户针对该现状回填后解除阻塞，把新任务返回给
// agent。现状总结即等待点 key：相同现状复用、不同现状分散答复。
//
// 与 todo 的区别：todo 管 KV 后端上的清单（需登录）；sessiontask 是**本机**
// 实时人机接力，数据存本地文件，不依赖后端登录态。
import * as service from './service.js';

const SUMMARY = { type: 'string', required: true, hint: '当前现状总结（作为等待点 key）' };

const STATUS_TAG = { pending: '待领取', consumed: '已领取' };

// 总览：每个等待点一行，先看现状再决定回填哪条
function renderOverview(d) {
  const lines = [`等待点 ${d.slots.length} 个（等待中 ${d.waiting}）`];
  if (!d.slots.length) {
    lines.push('（暂无等待点）');
    return lines.join('\n');
  }
  for (const s of d.slots) {
    const tag = s.waiting ? '[等待中]' : '[已结束]';
    lines.push(`  ${tag} ${s.summary}  · 待领取 ${s.pending}/${s.total}`);
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
    ? `已实时回填给等待中的 agent: ${head}`
    : `已排队（agent 下一次 wait 取走）: ${head}`;
}

// wait 的人读输出：成功给任务，超时明确提示「本轮结束」
function renderWait(r) {
  if (r.status === 'timeout') {
    return `等待超时（${Math.round(r.timeoutMs / 1000)} 秒未回填）：现状「${r.summary}」结束本轮。`;
  }
  const origin = r.queued ? '排队任务' : '实时回填';
  return `已取得下一条任务（${origin} · 现状「${r.summary}」）: #${r.task.id}\n  ${r.task.text.replace(/\n/g, '\n  ')}`;
}

export default {
  id: 'sessiontask',
  title: '实时任务（= Web「实时任务」页）',
  order: 20,
  view: () => import('./view.jsx'),

  // CRUD 资源声明：等待点任务的增删查改齐备，CLI 与面板都能调用
  resource: 'sessiontask',

  actions: [
    // ─── CRUD 五操作 ───────────────────────────────────────────
    {
      id: 'sessiontask.list',
      cli: ['sessiontask', 'list'],
      http: ['GET', '/api/sessiontasks'],
      summary: '总览全部等待点（现状、是否等待中、待领取数）',
      run: () => service.listTasks(),
      render: renderOverview,
    },
    {
      id: 'sessiontask.get',
      cli: ['sessiontask', 'get'],
      http: ['GET', '/api/sessiontasks/item'],
      summary: '查看单条任务（按 --id，定位到 --summary 现状）',
      flags: { id: { type: 'number', required: true, hint: '任务编号' }, summary: SUMMARY },
      run: (ctx) => service.getTask({ id: ctx.id, summary: ctx.summary }),
      render: renderTask,
    },
    {
      id: 'sessiontask.add',
      cli: ['sessiontask', 'add'],
      http: ['POST', '/api/sessiontasks'],
      summary: '针对某现状回填一条任务（有 wait 在等则即时投递，否则排队）',
      args: ['text'],
      flags: { summary: SUMMARY },
      run: (ctx) => service.addTask({ text: ctx.text, summary: ctx.summary }),
      render: renderAdd,
    },
    {
      id: 'sessiontask.update',
      cli: ['sessiontask', 'update'],
      http: ['PATCH', '/api/sessiontasks/item'],
      summary: '编辑任务内容（按 --id，定位到 --summary 现状）',
      flags: {
        id: { type: 'number', required: true, hint: '任务编号' },
        text: { type: 'string', required: true, hint: '改成这个内容' },
        summary: SUMMARY,
      },
      run: (ctx) => service.updateTask({ id: ctx.id, text: ctx.text, summary: ctx.summary }),
      render: (d) => `已更新 #${d.task.id}: ${d.task.text}`,
    },
    {
      id: 'sessiontask.remove',
      cli: ['sessiontask', 'remove'],
      http: ['DELETE', '/api/sessiontasks/item'],
      summary: '删除一条任务（按 --id，定位到 --summary 现状）',
      flags: { id: { type: 'number', required: true, hint: '任务编号' }, summary: SUMMARY },
      run: (ctx) => service.removeTask({ id: ctx.id, summary: ctx.summary }),
      render: (d) => `已删除 #${d.removed.id}: ${d.removed.text}`,
    },

    // ─── 阻塞等待（纯 CLI，agent 本轮最后一步）────────────────
    {
      id: 'sessiontask.wait',
      cli: ['sessiontask', 'wait'],
      http: null,
      summary: '针对当前现状阻塞等待用户回填（默认 120 秒，超时结束本轮）',
      flags: {
        summary: SUMMARY,
        timeout: { type: 'number', default: 120, hint: '阻塞上限（秒），默认 120' },
        'no-open': { type: 'boolean', hint: '不自动打开浏览器（测试用）' },
      },
      run: (ctx) =>
        service.waitForTask({
          summary: ctx.summary,
          timeoutMs: ctx.timeout * 1000,
          open: !ctx['no-open'],
        }),
      render: renderWait,
    },
  ],
};
