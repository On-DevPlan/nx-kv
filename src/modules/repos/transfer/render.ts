// 人读渲染（CLI 用；面板直接消费 JSON）。
import type { DiffImportResult } from './diff.js';
import type { RepoImportResult } from './import.js';

const STATUS_LABEL: Record<string, string> = { new: '新增', changed: '有差异', same: '一致', 'missing-local': '本地未拥有' };

export function renderDiff(d: DiffImportResult): string {
  const lines = [
    `差异检查（v${d.version}）: 新增 ${d.summary.new} · 有差异 ${d.summary.changed} · 一致 ${d.summary.same} · 本地未拥有 ${d.summary.missing}`,
  ];
  for (const r of d.repos) {
    const label = STATUS_LABEL[r.status] || r.status;
    const clone = r.canClone ? '（可克隆）' : '';
    lines.push(`  [${label}] ${r.key}${clone}`);
    for (const f of r.fields) {
      lines.push(`      ${f.field}: ${JSON.stringify(f.local)} → ${JSON.stringify(f.incoming)}`);
    }
  }
  for (const b of d.boards) {
    const label = STATUS_LABEL[b.status] || b.status;
    lines.push(`  [看板${label}] ${b.key}（${b.incoming.repos.length} 个成员）`);
    if (b.missingMembers.length) {
      lines.push(`      本地未拥有成员: ${b.missingMembers.map((m) => m.key).join('、')}`);
    }
  }
  for (const l of d.links) {
    lines.push(`  关系 ${l.ref} → ${l.to.map((t) => t.repo || t.board).join('、')}`);
  }
  if (d.docs && d.docs.length) {
    const docLabel: Record<string, string> = { new: '新增', changed: '有差异', same: '一致' };
    lines.push(`  文档（${d.docs.length} 份）: 新增 ${d.summary.docsNew} · 有差异 ${d.summary.docsChanged} · 一致 ${d.summary.docsSame}`);
    for (const x of d.docs.filter((x) => x.status !== 'same')) {
      lines.push(`    [文档${docLabel[x.status] || x.status}] ${x.refId}`);
    }
  }
  if (d.missing.length) lines.push(`  本地未拥有: ${d.missing.join('、')}`);
  const hasChange = d.summary.new || d.summary.changed || d.summary.docsNew || d.summary.docsChanged || d.missing.length;
  if (hasChange) lines.push('', '执行: nx-kv repo import <file> [--strategy ours|overwrite|duplicate] [--select <keys>]');
  else lines.push('', '本地与导入文件完全一致。');
  return lines.join('\n');
}

export function renderResult(d: RepoImportResult): string {
  const lines = [
    `导入完成（策略 ${d.strategy}）: 新建 ${d.created.length} · 覆盖 ${d.updated.length} · 另存 ${d.duplicated.length} · 跳过 ${d.skipped.length}`,
    `看板: 新建 ${d.boardsCreated} · 合并 ${d.boardsMerged}｜参考关系 ${d.links} 条`,
  ];
  if (d.docs && (d.docs.written.length || d.docs.skipped.length)) {
    lines.push(`文档: 写入 ${d.docs.written.length} · 跳过 ${d.docs.skipped.length}`);
    for (const w of d.docs.written.slice(0, 10)) lines.push(`  + ${w}`);
    for (const s of d.docs.skipped.slice(0, 10)) lines.push(`  = ${s.refId}（${s.why}）`);
  }
  if (d.pendingExternal && d.pendingExternal.length) {
    lines.push('待初始化（外部绑定路径缺失，接上后自动生效）:');
    for (const p of d.pendingExternal) lines.push(`  ${p.owner} → ${p.path}`);
  }
  if (d.cloned.length) {
    lines.push('克隆:');
    for (const c of d.cloned) lines.push(`  ${c.key}  →  ${c.dest}`);
  }
  if (d.duplicated.length) {
    lines.push('另存:');
    for (const c of d.duplicated) lines.push(`  ${c.key}  →  ${c.newKey}`);
  }
  if (d.skipped.length) {
    lines.push('跳过:');
    for (const c of d.skipped) lines.push(`  ${c.key}（${c.why}）`);
  }
  if (d.unmatched.length) {
    lines.push('未匹配:');
    for (const u of d.unmatched) lines.push(`  [${u.board}] ${u.entry} —— ${u.reason}`);
  }
  for (const w of d.warnings) lines.push(`⚠ ${w}`);
  return lines.join('\n');
}
