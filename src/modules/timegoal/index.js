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
// 时长 flag 走 string：这样 CLI 与 HTTP 两端都能收「5h / 90m / 2d」这种真实写法，
// 纯数字仍然按秒解释（10800 向后兼容）。校验统一在 service.parseDuration。
const DURATION = { type: 'string', required: true, hint: '持续时长（10800 秒 / 5h / 90m / 2d / 5小时）' };
const DURATION_OPT = { type: 'string', hint: '同时改时长（10800 / 5h / 90m / 2d）；省略则时长不变' };

// 秒 → 人话："5 小时" / "90 分钟" / "45 秒"
function fmtDur(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s >= 86400) return `${(s / 86400).toFixed(s % 86400 ? 1 : 0)} 天`;
  if (s >= 3600) return `${(s / 3600).toFixed(s % 3600 ? 1 : 0)} 小时`;
  if (s >= 60) return `${(s / 60).toFixed(s % 60 ? 1 : 0)} 分钟`;
  return `${s} 秒`;
}

// ─── 渲染（人读）────────────────────────────────────────────────────────

function renderSet(d) {
  const head = `[timegoal] 主题「${d.name}」`;
  const verb = d.replaced ? '已替换' : '已设置';
  const g = d.goal;
  return [
    `${verb} ${head}（持续 ${fmtDur(g.durationSec)} · 截止 ${g.deadline}）`,
    `完整提示词（已固化到 store，每轮 check 会原文回显给你）：`,
    g.prompt,
  ].join('\n');
}

function renderShow(d) {
  if (!d.hasGoal) return `[timegoal] 主题「${d.name}」暂无目标——先用 timegoal set 设定。`;
  const g = d.goal;
  const state = d.reached
    ? `已到点${d.overtimeSec ? `（已超时 ${fmtDur(d.overtimeSec)}）` : ''}`
    : `剩余 ${fmtDur(d.remainingSec)}`;
  const arch = g.archived ? '（已归档，可 update 续上或 clear 清除）' : '';
  return (
    `[timegoal] 主题「${g.name}」\n` +
    `  持续 ${fmtDur(g.durationSec)}\n` +
    `  起点 ${g.startedAt} · 截止 ${g.deadline}\n` +
    `  状态：${state} ${arch}\n` +
    `  提示词：${g.prompt.length > 200 ? g.prompt.slice(0, 200) + '…' : g.prompt}`
  );
}

function renderCheck(d) {
  if (!d.hasGoal) {
    return `[timegoal] 主题「${d.name}」暂无目标。`;
  }
  const status = d.reached
    ? `已到点（reached:true）${d.overtimeSec ? ` · 已超时 ${fmtDur(d.overtimeSec)}` : ''}—— 这轮结束后停手并写最终总结`
    : `未到点（reached:false）· 剩余 ${fmtDur(d.remainingSec)}（已用 ${fmtDur(d.elapsedSec)}）`;
  // prompt 原文回显（人读只截断，--json 仍走完整原文）
  const prompt = d.prompt.length > 200 ? d.prompt.slice(0, 200) + '…' : d.prompt;
  return [
    `[timegoal] 主题「${d.name}」`,
    `  状态：${status}`,
    `  截止：${d.deadline}（now=${d.now}）`,
    `  现状：${d.summary}`,
    `  完成度 / 下一步：${d.progress}`,
    `  日志：本目录已记录 ${d.logCount} 次检查（${d.checkedAt}）`,
    `  本轮提示词（store 原文）：`,
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
    `[timegoal] 主题「${g.name}」已更新（起点 ${g.startedAt} 未变，截止 ${g.deadline} · 持续 ${fmtDur(g.durationSec)}）`,
    `当前提示词（每轮 check 会原文回显给你）：`,
    g.prompt,
  ].join('\n');
}

function renderList(d) {
  if (!d.count && !d.archivedCount) return '（暂无任何目录的 timegoal）';
  const lines = [];
  if (d.count) {
    lines.push(`共 ${d.count} 个进行中的 timegoal（按截止时刻升序）:`);
    for (const g of d.goals) {
      lines.push(`  · ${g.name.padEnd(8)} ${fmtDur(g.durationSec).padEnd(8)} 截止 ${g.deadline}  ${g.cwd}`);
      // 列表只带预览（完整 prompt 用 timegoal show --cwd 取）
      const preview = g.promptPreview || g.prompt;
      if (preview) lines.push(`        提示词: ${preview.length > 80 ? preview.slice(0, 80) + '…' : preview}`);
    }
  }
  if (d.archivedCount) {
    // 归档区：到点自动归档的旧目标。clear / prune 可彻底清除。
    lines.push(`另有 ${d.archivedCount} 个已到点自动归档（clear 某个目录或 timegoal prune 可彻底清除）:`);
    for (const g of d.archived || []) {
      lines.push(`  · ${g.name.padEnd(8)} ${fmtDur(g.durationSec).padEnd(8)} 截止 ${g.deadline}  归档于 ${g.archivedAt}`);
    }
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
        duration: DURATION,
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
        duration: DURATION_OPT,
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
      summary:
        '时间运算 + 原文回显 prompt + 写入一次状态日志；每次必须提供当前现状 --summary 与完成度/下一步 --progress',
      flags: {
        cwd: CWD,
        summary: { type: 'string', required: true, hint: '当前现状（每次 check 记录到日志，≤2000 字）' },
        progress: { type: 'string', required: true, hint: '完成度/本轮成果/下一步（写入日志，≤2000 字）' },
      },
      run: (ctx) => service.checkTimegoal({ cwd: ctx.cwd, summary: ctx.summary, progress: ctx.progress }),
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
      summary: '列出所有有 timegoal 的目录（按截止升序；已到点的单列在归档区）',
      run: () => service.listTimegoals(),
      render: renderList,
    },
    {
      id: 'timegoal.log',
      cli: ['timegoal', 'log'],
      http: ['GET', '/api/timegoals/log'],
      summary: '查看本目录 timegoal 的检查日志（每轮 check 的现状 + 完成度）',
      flags: { cwd: CWD },
      run: (ctx) => service.getTimegoalLog({ cwd: ctx.cwd }),
      render: (d) => {
        if (!d.hasGoal) return `[timegoal] 主题「${d.name}」暂无目标，也没有日志。`;
        if (!d.count) return `[timegoal] 主题「${d.name}」暂无检查日志。`;
        const lines = [`[timegoal] 主题「${d.name}」检查日志（保留 ${d.count} 条）:`];
        if (d.truncated) {
          lines.push(`  ⚠ 总共检查过 ${d.totalEntries} 轮，日志只保留最近 ${d.count} 条（更早的已丢弃）`);
        }
        for (const e of d.entries) {
          lines.push(`  ${e.checkedAt}  ${e.reached ? '已到点' : `剩 ${fmtDur(e.remainingSec)}`}`);
          lines.push(`      现状：${e.summary}`);
          lines.push(`      下一步：${e.progress}`);
        }
        return lines.join('\n');
      },
    },
    {
      id: 'timegoal.prune',
      cli: ['timegoal', 'prune'],
      http: ['POST', '/api/timegoals/prune'],
      summary: '彻底清除已到点 / 已归档的时间目标（到点本身已自动归档，这里是连归档区一起清）',
      run: () => service.pruneExpired(),
      render: (d) =>
        d.count
          ? `已彻底清除 ${d.count} 个到点/已归档的时间目标：\n` +
            d.removed.map((g) => `  - ${g.name}  ${g.cwd}  截止 ${g.deadline}`).join('\n')
          : '没有到点或已归档的时间目标（还在跑的不动手）。',
    },
  ],
};
