// todo 模块的辅助函数/常量（legacy 形态里与 action 表同文件，迁来时一并搬到这里）。
//
// 参数与返回值暂用宽松类型（迁移期），服务层类型化推进时逐个收紧。
import { listGroups } from '../../core/kvapi.js';
import { badInput, notFound } from '../../core/errors.js';

export function renderTaskList(d: any) {
  const groups: any = [
    ['open', '待办'],
    ['done', '已完成'],
    ['freeze', '冻结'],
  ].filter(([k]: any) => d[k]);

  const lines: any = [];
  if (d.topic) lines.push(`topic=${d.topic}`);
  // 只在真同步过时才出现（见 service.listTodos）；失败数单独提出来，
  // 因为「清单读到了、附件没下下来」是使用者必须看见的一件事。
  if (d.attachmentsSync) {
    const s: any = d.attachmentsSync;
    lines.push(
      `附件同步: 目录 ${s.dir || '—'} · 下载 ${s.downloaded || 0} · 跳过 ${s.skipped || 0}` +
        (s.failures && s.failures.length ? ` · 失败 ${s.failures.length}` : '')
    );
  }
  for (const [key, label] of groups) {
    const items: any = d[key];
    if (!items) continue;
    if (!items.length) {
      lines.push(`${label}: （空）`);
      continue;
    }
    lines.push(`${label}（${items.length}）:`);
    const w: any = Math.max(...items.map((t: any) => String(t.id).length));
    for (const t of items) {
      const mark: any = key === 'done' ? `✓ ${shortTime(t.doneAt)}` : key === 'freeze' ? `❄ ${shortTime(t.frozenAt)}` : '';
      // id 只作展示位（对齐列的宽度由它决定），**操作时不要用它定位** ——
      // 定位一律用 --ref <内容>，见文件头的说明。
      lines.push(`  ${String(t.id).padStart(w)}  [${t.topic}] ${t.text}${mark ? '  ' + mark : ''}`);
      if (t.note) lines.push(`  ${' '.repeat(w)}    note: ${t.note.slice(0, 100)}`);
      for (const a of t.attachments || []) {
        lines.push(
          `  ${' '.repeat(w)}    ${a.kind === 'image' ? '图片' : '附件'}: ${a.localPath || a.name}${a.localPath ? '' : '（未同步）'}`
        );
      }
    }
  }
  return lines.join('\n');
}

export const shortTime: any = (s: any) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');

export const renderTask: any = (t: any) => [
    `[${t.topic}]  ${t.text}`,
    `  状态:   ${t.doneAt ? '已完成' : t.frozenAt ? '冻结' : '待办'}${t.bucket ? `（在 ${t.bucket}）` : ''}`,
    `  创建:   ${t.createdAt}`,
    t.doneAt ? `  完成:   ${t.doneAt}` : '',
    t.frozenAt ? `  冻结:   ${t.frozenAt}` : '',
    t.note ? `  备注:   ${t.note}` : '',
    ...(t.attachments || []).map(
      (a: any) => `  附件:   ${a.localPath || a.name}${a.localPath ? '' : `（未同步；nx-kv file sync --ids ${a.id}）`}`
    ),
  ]
    .filter(Boolean)
    .join('\n');

export function renderTaskAttachments(d: any) {
  const lines: any = [`[${d.task.topic}] ${d.task.text}`];
  if (!d.count) {
    lines.push('  （这条任务没有引用附件）');
    return lines.join('\n');
  }
  lines.push(`  本地目录: ${d.localDir}（自动下载 ${d.autoSync ? '开' : '关'}）`);
  for (const a of d.attachments) {
    lines.push(`  ${a.kind === 'image' ? '图片' : '附件'}  ${a.name}  [${a.id}]`);
    lines.push(`      ${a.localPath || '（未同步；nx-kv file sync --ids ' + a.id + '）'}`);
  }
  return lines.join('\n');
}

export const renderGroupLine: any = (g: any, current: any) => `${current ? '*' : ' '} ${String(g.id).padStart(4)}  ${g.name.padEnd(14)}  ${(g.myRole || '').padEnd(6)}  ${g.memberCount} 人  ${g.description || ''}`;

export async function findGroup(locator: any) {
  const s: any = String(locator ?? '').trim();
  if (!s) throw badInput('必须给出工作空间 id 或名称（nx-kv group list 可查看）');
  const groups: any = await listGroups();
  const hit: any = /^\d+$/.test(s)
    ? groups.find((g: any) => g.id === Number(s))
    : groups.find((g: any) => g.name.toLowerCase() === s.toLowerCase());
  if (!hit) {
    throw notFound(`工作空间不存在或无权访问: ${s}（nx-kv group list 查看可用项）`);
  }
  return hit;
}
