// timegoal 模块 —— 命令族的 CLI/HTTP 声明。
//
// 与 localtask 完全独立：不挂顶级 tab（view: () => null）；面板上由
// localtask/view.jsx 内嵌消费 `/api/timegoals`，按 cwd 映射到主题卡里。
//
// 命令族：
//   set    POST   /api/timegoals        设/替换本目录 timegoal（含 prompt 原文、重置起点）
//   update PATCH  /api/timegoals        仅替换 prompt（保 duration/起点；agent 自我迭代用）
//   show   GET    /api/timegoals        不算时间，仅查询
//   check  GET    /api/timegoals/check  时间运算 + 原文回显 prompt
//   clear  DELETE /api/timegoals        清空本目录 timegoal
//   list   GET    /api/timegoals/all    所有有 timegoal 的目录
import * as service from './service.js';

const CWD = { type: 'string', required: true, hint: '工作目录（与 timegoal 一对一）' };

// ─── 渲染（人读）────────────────────────────────────────────────────────

function renderSet(d) {
  const head = `[timegoal] 主题「${d.name}」`;
  const verb = d.replaced ? '已替换' : '已设置';
  const g = d.goal;
  return [
    `${verb} ${head}（持续 ${g.durationSec} 秒 · 截止 ${g.deadline}）`,
    `完整提示词（已固化到 store，每轮 check 会原文回显给你）：`,
    g.prompt,
  ].join('\n');
}

function renderShow(d) {
  if (!d.hasGoal) return `[timegoal] 主题「${d.name}」暂无目标——先用 timegoal set 设定。`;
  const g = d.goal;
  return (
    `[timegoal] 主题「${g.name}」\n` +
    `  持续 ${g.durationSec} 秒\n` +
    `  起点 ${g.startedAt} · 截止 ${g.deadline}\n` +
    `  提示词：${g.prompt.length > 200 ? g.prompt.slice(0, 200) + '…' : g.prompt}`
  );
}

function renderCheck(d) {
  if (!d.hasGoal) {
    return `[timegoal] 主题「${d.name}」暂无目标。`;
  }
  const status = d.reached
    ? '已到点（reached:true）—— 这轮结束后停手并写最终总结'
    : `未到点（reached:false）· 剩余 ${d.remainingSec} 秒（已用 ${d.elapsedSec} 秒）`;
  // prompt 原文回显（人读只截断，--json 仍走完整原文）
  const prompt = d.prompt.length > 200 ? d.prompt.slice(0, 200) + '…' : d.prompt;
  return [
    `[timegoal] 主题「${d.name}」`,
    `  状态：${status}`,
    `  截止：${d.deadline}（now=${d.now}）`,
    `  本轮要遵循的提示词（原文）：`,
    prompt,
  ].join('\n');
}

function renderClear(d) {
  if (!d.cleared) return `[timegoal] 主题「${d.name}」本来就没目标，无需清空。`;
  return `[timegoal] 主题「${d.name}」目标已清空，可重新 set。`;
}

function renderUpdate(d) {
  const g = d.goal;
  return [
    `[timegoal] 主题「${g.name}」已更新（起点 ${g.startedAt} 未变，截止 ${g.deadline}）`,
    `当前提示词（每轮 check 会原文回显给你）：`,
    g.prompt,
  ].join('\n');
}

function renderList(d) {
  if (!d.count) return '（暂无任何目录的 timegoal）';
  const lines = [`共 ${d.count} 个 timegoal（按截止时刻升序）:`];
  for (const g of d.goals) {
    lines.push(`  · ${g.name.padEnd(8)} ${g.durationSec}s  截止 ${g.deadline}  ${g.cwd}`);
    if (g.prompt) lines.push(`        提示词: ${g.prompt.length > 80 ? g.prompt.slice(0, 80) + '…' : g.prompt}`);
  }
  return lines.join('\n');
}

// ─── 模块声明 ───────────────────────────────────────────────────────────

export default {
  id: 'timegoal',
  title: 'timegoal（= 持续运行 N 小时任务的时间目标；UI 嵌入在「本地任务」主题卡里）',
  order: 21,
  view: null, // UI 由 localtask/view.jsx 内嵌消费，不挂顶级 tab

  actions: [
    {
      id: 'timegoal.set',
      cli: ['timegoal', 'set'],
      http: ['POST', '/api/timegoals'],
      summary: '为本目录设置/替换 timegoal：duration + 完整全局提示词（原文固化到 store）',
      flags: {
        cwd: CWD,
        duration: { type: 'number', required: true, hint: '持续秒数（60-86400，最大 24 小时）' },
        prompt: { type: 'string', required: true, hint: '完整全局提示词（≤20000 字，每轮 check 会原文回显）' },
      },
      run: (ctx) =>
        service.setTimegoal({ cwd: ctx.cwd, durationSec: ctx.duration, prompt: ctx.prompt }),
      render: renderSet,
    },
    {
      id: 'timegoal.update',
      cli: ['timegoal', 'update'],
      http: ['PATCH', '/api/timegoals'],
      summary:
        '更新本目录 timegoal 的提示词（可选同时改时长，--duration；保留起点，不重置计时）',
      flags: {
        cwd: CWD,
        prompt: { type: 'string', required: true, hint: '新版提示词（≤20000 字）' },
        duration: { type: 'number', hint: '同时改时长（秒，60-86400）；省略则时长不变' },
      },
      run: (ctx) =>
        service.updateTimegoal({ cwd: ctx.cwd, prompt: ctx.prompt, durationSec: ctx.duration }),
      render: renderUpdate,
    },
    {
      id: 'timegoal.show',
      cli: ['timegoal', 'show'],
      http: ['GET', '/api/timegoals'],
      summary: '查看本目录当前 timegoal（不算时间）',
      flags: { cwd: CWD },
      run: (ctx) => service.showTimegoal({ cwd: ctx.cwd }),
      render: renderShow,
    },
    {
      id: 'timegoal.check',
      cli: ['timegoal', 'check'],
      http: ['GET', '/api/timegoals/check'],
      summary: '时间运算 + 原文回显 prompt：返回 reached / elapsedSec / remainingSec / prompt',
      flags: { cwd: CWD },
      run: (ctx) => service.checkTimegoal({ cwd: ctx.cwd }),
      render: renderCheck,
    },
    {
      id: 'timegoal.clear',
      cli: ['timegoal', 'clear'],
      http: ['DELETE', '/api/timegoals'],
      summary: '清空本目录 timegoal（无则 no_goal，不抛错）',
      flags: { cwd: CWD },
      run: (ctx) => service.clearTimegoal({ cwd: ctx.cwd }),
      render: renderClear,
    },
    {
      id: 'timegoal.list',
      cli: ['timegoal', 'list'],
      http: ['GET', '/api/timegoals/all'],
      summary: '列出所有有 timegoal 的目录（按截止升序）',
      run: () => service.listTimegoals(),
      render: renderList,
    },
  ],
};
