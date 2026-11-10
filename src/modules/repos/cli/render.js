// CLI 人读渲染与布局读取（Web 端拿 JSON，用不到渲染；readLayout 是 import 双入口的共用件）。
import { badInput } from '../../../core/errors.js';

// ---- 看板的 CLI 人读渲染 ----
// 用户要的「快速判断看板里的 repo 和 desc」：按主题分组，一行 = 仓库名 + 一句话描述。
export function renderBoardList(d) {
  const lines = [];
  for (const b of d.boards) {
    lines.push(`【${b.name}】${b.repos.length} 个仓库${b.desc ? ` —— ${b.desc}` : ''}`);
    for (const r of b.repos) {
      const miss = r.present === false ? '  [本地未拥有]' : '';
      lines.push(`  ${r.name.padEnd(18)} ${r.desc || '-'}${miss}`);
    }
  }
  if (d.unassigned.length) {
    lines.push('【未分组】');
    for (const r of d.unassigned) lines.push(`  ${r.name.padEnd(18)} ${r.desc || '-'}`);
  }
  if (!lines.length) return '（还没有看板与仓库，用 board add <名称> 建主题、repo add 登记仓库）';
  return lines.join('\n');
}

export function renderBoard(b) {
  const lines = [`【${b.name}】${b.desc || ''} —— ${b.repos.length} 个仓库`];
  for (const r of b.repos) {
    const miss = r.present === false ? '  [本地未拥有]' : '';
    lines.push(`  ${r.name.padEnd(18)} ${r.desc || '-'}${miss}`);
  }
  return lines.join('\n');
}

export const lastSeg = (p) => String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).slice(-1)[0] || '';

// import / import --diff 两个 action 共用的取布局逻辑：
// CLI 给文件路径（- = stdin），面板直接 POST {json}。
// v4 起文件可以是导出的 zip 本体（PK 魔数）→ 拆包取 layout.json + docs/**，
// 文档条目随布局一起走完 diff 与导入两条链路。
export async function readLayout(ctx) {
  let json = typeof ctx.json === 'string' ? ctx.json : '';
  const docsFiles = [];
  if (!json && ctx.file) {
    const { readFileSync } = await import('node:fs');
    const buf = readFileSync(ctx.file === '-' ? 0 : ctx.file);
    const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    if (isZip) {
      const { readZip } = await import('../../../core/zip.js');
      for (const e of readZip(buf)) {
        if (e.name === 'layout.json') json = e.data.toString('utf8');
        else if (e.name.startsWith('docs/') && /\.md$/i.test(e.name)) {
          docsFiles.push({ rel: e.name.slice('docs/'.length), data: e.data });
        }
      }
      if (!json) throw badInput('zip 里没有 layout.json —— 认 repo export 的导出包');
    } else {
      json = buf.toString('utf8');
    }
  }
  if (!json) throw badInput('请给布局文件（layout.json 或导出的 zip；- 读 stdin），或在面板里粘贴 JSON');
  return { json, docsFiles };
}

// ---- CLI 人读渲染（Web 端拿 JSON，用不到这些） ----

export function renderRepoList(list) {
  if (!list.length) return '（暂无仓库，用 repo add <path> 登记）';
  const lines = [`共 ${list.length} 个仓库`];
  for (const r of list) {
    const tag = r.type === 'ref' ? ' [参考]' : '';
    lines.push(`${r.name.padEnd(18)} ${r.key}${tag}`);
    lines.push(`  ${' '.repeat(16)} ${r.path}`);
  }
  return lines.join('\n');
}

export function renderRepo(r) {
  const lines = [
    `${r.name}${r.type === 'ref' ? '  [参考]' : ''}${r.desc ? '  ' + r.desc : ''}`,
    `  id:    ${r.id}`,
    `  key:   ${r.key}${r.keyCustom ? '（自定义）' : ''}`,
    `  路径:  ${r.path}`,
  ];
  if (r.remote) lines.push(`  远程:  ${r.remote}`);
  if (r.remotes?.length > 1) lines.push(`  全部远程: ${r.remotes.join(' , ')}`);
  lines.push(
    `  登记:  ${(r.addedAt || '').slice(0, 10)}`,
    `  更新:  ${(r.updatedAt || '').slice(0, 10)}`
  );
  if (r.boards?.length) {
    lines.push(`  看板:  ${r.boards.map((b) => b.name).join('、')}`);
  }
  if (r.notes) lines.push('  备注:  ' + r.notes);
  return lines.join('\n');
}

// ---- 参考仓库的人读渲染 ----

export function renderClone(r) {
  const lines = [`已克隆并登记参考仓库: ${r.name}`, `  目录: ${r.dest || r.path}`, `  远程: ${r.url || r.remote}`];
  if (r.linked?.length) {
    lines.push(`  绑定: ${r.linked.map((l) => (l.kind === 'board' ? `看板 ${l.id}` : `仓库 ${l.id}`)).join('、')}`);
  }
  return lines.join('\n');
}

export function renderRefSync(d) {
  const word = { updated: '已更新', upToDate: '已是最新', conflict: '冲突（需人工处理，不自动 merge）', missing: '目录缺失', error: '失败' };
  const lines = [`同步 ${d.synced} 个参考仓库:`];
  for (const r of d.results) {
    lines.push(`  ${word[r.status] || r.status}  ${r.name}${r.output && r.status !== 'upToDate' ? '  — ' + r.output.split('\n')[0] : ''}`);
  }
  if (!d.synced) lines.push('（还没有参考仓库，用 repo ref clone <url>）');
  return lines.join('\n');
}

export function renderRefCheck(d) {
  if (!d.total) return '（还没有参考仓库 —— clone 一个: repo ref clone <url>）';
  const lines = [`检查 ${d.total} 个参考仓库${d.problems ? `，${d.problems} 个有问题` : '，全部正常'}:`];
  for (const r of d.refs) {
    lines.push(`  ${r.ok ? '✓' : '✗'}  ${r.name}  ${r.remote || '(无远程地址)'}`);
    for (const i of r.issues) lines.push(`      ${i}`);
  }
  return lines.join('\n');
}

export function renderBind(d) {
  return d.removed
    ? `已摘除绑定: ${d.name}（${d.count} 条；剩 ${d.linked.length} 条）`
    : `已绑定 ${d.name} → ${d.added.length ? d.added.join('、') : '（已存在）'}（共 ${d.linked.length} 条绑定）`;
}

// 分层查询的人读渲染：第一层自己的参考，第二层按看板命名空间分组。
export function renderRefsOf(d) {
  const line = (r) => `  ${r.name}${r.note ? `  （${r.note.split('\n')[0]}）` : ''}  ${r.remote || ''}`;
  const out = [`【${d.repo.name}】${d.repo.path}`];
  if (d.direct.length) {
    out.push('  本仓库直接绑定:');
    for (const r of d.direct) out.push(line(r));
  } else {
    out.push('  本仓库直接绑定:（无）');
  }
  if (d.boards.length) {
    for (const b of d.boards) {
      out.push(`  ◇ 看板「${b.name}」${b.desc ? ` —— ${b.desc.split('\n')[0]}` : ''}`);
      if (b.refs.length) for (const r of b.refs) out.push(line(r));
      else out.push('    （该组暂无绑定的参考仓库）');
    }
  } else {
    out.push('  （该仓库不属于任何看板 —— 没有组级参考可继承）');
  }
  return out.join('\n');
}
