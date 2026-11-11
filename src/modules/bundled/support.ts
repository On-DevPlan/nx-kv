// bundled 模块的辅助函数/常量（legacy 形态里与 action 表同文件，迁来时一并搬到这里）。
//
// 参数与返回值暂用宽松类型（迁移期），服务层类型化推进时逐个收紧。
import { badInput } from '../../core/errors.js';

export function renderList(d: any) {
  const def: any = d.defaultGroup ? (d.groupSkills[d.defaultGroup] || []) : [];
  const w: any = Math.max(0, ...d.skills.map((s: any) => s.length));
  const lines: any = ['可装的 skill:'];
  for (const s of d.skills) {
    lines.push(def.includes(s) ? `  * ${s.padEnd(w)}  （默认 install）` : `  * ${s}`);
  }
  lines.push('可装的 group:');
  for (const g of d.groups) {
    lines.push(d.summaries[g] ? `  * ${g.padEnd(w)}  ${d.summaries[g]}` : `  * ${g}`);
  }
  if (d.source === 'assets-dirs') {
    lines.push('', '（assets/groups.json 缺失或损坏，已降级为目录扫描：每个内置 skill 各成一组）');
  }
  return lines.join('\n');
}

export function exclusive(ctx: any, cmd: any) {
  if (ctx.group !== undefined && ctx.group !== null && ctx.group !== '' && ctx.name) {
    throw badInput(`${cmd} 的 <name> 与 --group 只能给一个`);
  }
  // --all 是「全装」：再点名某个 skill 或某个组就是自相矛盾。
  // 放在这里而不是 service 里，因为 service 侧的 name 有默认值，分不出是用户给的还是补的。
  if (ctx.all) {
    if (ctx.name) throw badInput(`${cmd} 的 <name> 与 --all 只能给一个（--all 已装全部）`);
    if (ctx.group !== undefined && ctx.group !== null && ctx.group !== '') {
      throw badInput(`${cmd} 的 --group 与 --all 只能给一个（--all 已覆盖所有组）`);
    }
  }
}

export function renderScoped(label: any, d: any) {
  const done: any = d.skills.filter((r: any) => r.status === 'ok').length;
  const lines: any = [`${label}: ${done}/${d.skills.length} 已就绪`];
  for (const r of d.skills) {
    const what: any = r.status === 'conflict'
      ? `冲突（${r.count} 个文件不同）→ 用 --force 覆盖`
      : r.skipped ? '已是最新'
        : `${r.replaced ? '已更新' : '已安装'}（${r.files} 个文件）-> ${r.path}`;
    lines.push(`  ${r.name.padEnd(16)} ${what}`);
  }
  return lines.join('\n');
}

export function renderContent(d: any) {
  const i: any = d.install;
  const inst: any = i.status === 'conflict'
    ? `冲突: ${i.path}（${i.count} 个文件不同）—— 需要覆盖时用 nx-kv skill install --force`
    : i.skipped
      ? `已是最新: ${i.path}（无差异）`
      : i.replaced
        ? `已替换: ${i.path}`
        : `已安装: ${i.path}`;
  return [
    `# === ${d.skillName} skill context ===`,
    `# 以下内容来自 nx-kv skill \`${d.skillName}\` 的 ${d.ref}。`,
    '# 建议：把 sentinel 之后的正文完整复制到你自己可访问的路径，再按其内容操作。',
    '# --- begin skill content (do not modify this line) ---',
    '',
    d.content.replace(/\s*$/, ''),
    '',
    '-- install 状态 --',
    inst,
  ].join('\n');
}
