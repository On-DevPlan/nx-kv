// tasktool 模块的辅助函数/常量（legacy 形态里与 action 表同文件，迁来时一并搬到这里）。
//
// 参数与返回值暂用宽松类型（迁移期），服务层类型化推进时逐个收紧。
export function renderSet(d: any) {
  const head: any = `[timegoal] 主题「${d.name}」`;
  const verb: any = d.replaced ? '已替换' : '已设置';
  const g: any = d.goal;
  return [
    `${verb} ${head}（持续 ${fmtDur(g.durationSec)} · 截止 ${g.deadline}）`,
    `完整提示词（已固化到 store，每轮 check 会原文回显给你）：`,
    g.prompt,
  ].join('\n');
}

export function fmtDur(sec: any) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s >= 86400) return `${(s / 86400).toFixed(s % 86400 ? 1 : 0)} 天`;
  if (s >= 3600) return `${(s / 3600).toFixed(s % 3600 ? 1 : 0)} 小时`;
  if (s >= 60) return `${(s / 60).toFixed(s % 60 ? 1 : 0)} 分钟`;
  return `${s} 秒`;
}

export function renderUpdate(d: any) {
  const g: any = d.goal;
  return [
    `[timegoal] 主题「${g.name}」已更新（起点 ${g.startedAt} 未变，截止 ${g.deadline} · 持续 ${fmtDur(g.durationSec)}）`,
    `当前提示词（每轮 check 会原文回显给你）：`,
    g.prompt,
  ].join('\n');
}

export function renderShow(d: any) {
  if (!d.hasGoal) return `[timegoal] 主题「${d.name}」暂无目标——先用 timegoal set 设定。`;
  const g: any = d.goal;
  const state: any = d.reached
    ? `已到点${d.overtimeSec ? `（已超时 ${fmtDur(d.overtimeSec)}）` : ''}`
    : `剩余 ${fmtDur(d.remainingSec)}`;
  const arch: any = g.archived ? '（已归档，可 update 续上或 clear 清除）' : '';
  return (
    `[timegoal] 主题「${g.name}」\n` +
    `  持续 ${fmtDur(g.durationSec)}\n` +
    `  起点 ${g.startedAt} · 截止 ${g.deadline}\n` +
    `  状态：${state} ${arch}\n` +
    `  提示词：${g.prompt.length > 200 ? g.prompt.slice(0, 200) + '…' : g.prompt}`
  );
}

export function renderCheck(d: any) {
  if (!d.hasGoal) {
    return `[timegoal] 主题「${d.name}」暂无目标。`;
  }
  const status: any = d.reached
    ? `已到点（reached:true）${d.overtimeSec ? ` · 已超时 ${fmtDur(d.overtimeSec)}` : ''}—— 这轮结束后停手并写最终总结`
    : `未到点（reached:false）· 剩余 ${fmtDur(d.remainingSec)}（已用 ${fmtDur(d.elapsedSec)}）`;
  // 任务 #87：任务级 goal 的 prompt 是模板，这里优先展示**本轮实时渲染**的结果
  // （时间变量 + 任务实时原文都按当下取值）；目录级 goal 仍回显 store 原文。
  const full: any = d.promptRendered || d.prompt || '';
  const prompt: any = full.length > 2000 ? full.slice(0, 2000) + '…' : full;
  const lines: any = [
    `[timegoal] 主题「${d.name}」`,
    `  状态：${status}`,
    `  截止：${d.deadline}（now=${d.now}）`,
    `  现状：${d.summary}`,
    `  日志：本目录已记录 ${d.logCount} 次检查（${d.checkedAt}）`,
    `  本轮提示词（${d.promptRendered ? '实时渲染' : 'store 原文'}）：`,
    prompt,
  ];
  if (d.task && d.task.text) {
    const text: any = d.task.text.length > 2000 ? d.task.text.slice(0, 2000) + '…' : d.task.text;
    lines.push(`  任务 #${d.task.id} 实时原文：`, text);
  }
  return lines.join('\n');
}

export function renderClear(d: any) {
  if (!d.cleared) return `[timegoal] 主题「${d.name}」本来就没目标，无需清空。`;
  return `[timegoal] 主题「${d.name}」目标已清空，可重新 set。`;
}

export function renderList(d: any) {
  if (!d.count && !d.archivedCount) return '（暂无任何目录的 timegoal）';
  const lines: any = [];
  if (d.count) {
    lines.push(`共 ${d.count} 个进行中的 timegoal（按截止时刻升序）:`);
    for (const g of d.goals) {
      lines.push(`  · ${g.name.padEnd(8)} ${fmtDur(g.durationSec).padEnd(8)} 截止 ${g.deadline}  ${g.cwd}`);
      // 列表只带预览（完整 prompt 用 timegoal show --cwd 取）
      const preview: any = g.promptPreview || g.prompt;
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
