// action 的人读输出（render）函数（自 index.js 拆出）：CLI 与 HTTP 共用同一份措辞。
// STATUS_TAG 来自同构词表（src/shared/task-status.js）：CLI 与面板共用一份措辞。
import { STATUS_TAG } from '../../shared/task-status.js';
import { deliveryBodyText } from '../tasktool/delivery-text.js';

// 渲染入参都是 action 结果对象（HTTP/CLI body 透传）→ any。
export type RenderInput = any;

// 总览：每个主题（工作目录）一行，先看目录与现状再决定回填哪条
export function renderOverview(d: RenderInput): string {
  const lines: string[] = [`主题 ${d.topics.length} 个（等待中 ${d.waiting} · 默认超时 ${d.settings.timeoutSec}s）`];
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

export const renderTask = (t: RenderInput): string =>
  [
    `#${t.id}  [${STATUS_TAG[t.status] || t.status}]  ${t.text}`,
    `  创建: ${t.createdAt}`,
    t.consumedAt ? `  领取: ${t.consumedAt}` : '',
    // 附件清单（正文里的 ![名](fileId) 嵌入；本地已有 → 直接给绝对路径）
    ...(t.attachments || []).map(
      (a: any) => `  附件:   ${a.localPath || a.name}${a.localPath ? '' : `（未同步；nx-kv file sync --ids ${a.id}）`}`
    ),
  ]
    .filter(Boolean)
    .join('\n');

// `localtask attachments` 的人读输出（与 todo attachments 同构）
export function renderTaskAttachments(d: RenderInput): string {
  const lines: string[] = [
    `#${d.task.id}  附件 ${d.count} 个（正文内嵌 ${d.inlineCount ?? d.count} · 附件区 ${d.areaCount ?? 0}）· 本地目录: ${d.localDir}（自动下载 ${d.autoSync ? '开' : '关'}）`,
  ];
  if (!d.count) {
    lines.push('  （这条任务没有附件；localtask attach --no-embed 可只挂到附件区）');
    return lines.join('\n');
  }
  const groups = [
    { key: 'inline', label: '正文内嵌' },
    { key: 'area', label: '附件区' },
  ];
  for (const g of groups) {
    const rows = d.attachments.filter((a: any) => (a.area === 'area' ? 'area' : 'inline') === g.key);
    if (!rows.length) continue;
    lines.push(`  [${g.label}]`);
    for (const a of rows) {
      const docMark = a.role === 'doc' ? '  〔进原文〕' : '';
      const noteMark = a.note ? `  # ${a.note}` : '';
      lines.push(`  ${a.kind === 'image' ? '图片' : a.kind === 'url' ? '链接' : a.kind === 'task' ? '任务' : a.kind === 'ref' ? '文档' : '附件'}  ${a.name}  [${a.id}]${docMark}${noteMark}`);
      lines.push(`      ${a.localPath || a.url || a.target || '（未同步；nx-kv file sync --ids ' + a.id + '）'}`);
    }
  }
  return lines.join('\n');
}

export function renderDetach(d: RenderInput): string {
  const head = d.unlinked
    ? `已解除主题「${d.name}」#${d.task.id} 与附件 ${d.attachment} 的关系`
    : `主题「${d.name}」#${d.task.id} 本来就没有引用附件 ${d.attachment}`;
  const tail = d.purged
    ? '；资源已删除（含本机字节）'
    : d.purgeReason === 'in-use'
      ? '；资源仍被其他任务/文档引用，未删字节'
      : d.purgeReason === 'file-locked'
        ? '；文件被占用，未删字节（关系已解除）'
        : d.purgeReason === 'not-found'
          ? '；资源行不存在'
          : '';
  return head + tail;
}

export function renderAdd(d: RenderInput): string {
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

// `localtask chain` 的人读输出（#74）：同任务 history 节点为主；旧 forkOf 祖先/子任务为辅
const KIND_TAG: Record<string, string> = { origin: '起点', reopen: '反馈', comment: '评论', current: '当前' };
// T04：链 = task_links（每轮一条任务，seq 做节点 key）。节点没有 origin/comment
// 事件层了——每轮的"正文 + 反馈"完整活在那一轮的任务行上。
export function renderChain(d: RenderInput): string {
  const self = d.task;
  const lines: string[] = [
    `#${self.id}  [${STATUS_TAG[self.status] || self.status}]  ${d.name}  （R${d.round ?? 1}）`,
    `  ${self.text.split('\n').map((l: string) => l.trim()).find(Boolean) || ''}`,
  ];
  if (d.derivedFrom) lines.push(`  派生自: ${d.derivedFrom}`);
  const nodes = Array.isArray(d.nodes) ? d.nodes : [];
  if (nodes.length > 1) {
    lines.push(`  任务链（R1 → R${nodes.length}，共 ${nodes.length} 条）:`);
    for (const n of nodes) {
      const mark = n.current ? '●' : '○';
      const tag = `[${STATUS_TAG[n.status] || n.status}]`;
      lines.push(`    ${mark} #${n.id} ${tag} ${n.excerpt || '—'}`);
    }
  }
  if (d.childCount) lines.push(`  子任务: ${d.childCount} 条（派生链见各自 --chain）`);
  if (d.ancestors && d.ancestors.length) {
    lines.push(`  祖先链（${d.ancestors.length} 级）:`);
    for (const a of d.ancestors) {
      lines.push(
        a.missing
          ? `    ↑ ${a.ref}（已不在队列：软删或迁出）`
          : `    ↑ #${a.id} [${a.status}]${a.forkKind ? `（${KIND_TAG[a.forkKind] || a.forkKind}）` : ''} ${a.excerpt}`,
      );
    }
  }
  if (d.children && d.children.length) {
    lines.push(`  子任务（${d.children.length} 条）:`);
    for (const c of d.children) {
      lines.push(
        `    ↳ #${c.id} [${c.status}]${c.forkKind ? `（${KIND_TAG[c.forkKind] || c.forkKind}）` : ''} ${c.excerpt}` +
          (c.key !== d.key ? `  @ ${c.name}` : ''),
      );
    }
  }
  if (!nodes.length && !self.forkOf && !(d.ancestors && d.ancestors.length) && !(d.children && d.children.length)) {
    lines.push('  （这条任务还没有链节点）');
  }
  return lines.join('\n');
}

// wait 的人读输出：成功给任务（注明来自本地队列还是全局共享池），超时明确提示「本轮结束」
export function renderWait(r: RenderInput): string {
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
  return `${header}\n${deliveryBodyText(r)}`;
}

// 预览的人读输出：先给 agent 会收到的原文，再逐段标注来源与当前开关——
// 用户问的是「当前具体会获得怎么样的字符串」，那就把字符串原样摆出来。
export function renderPreview(d: RenderInput): string {
  const t = d.task || {};
  const lines: string[] = [
    `预览 ${t.id ? `#${t.id}` : '(草稿)'}（只读：不领取、不写盘、不启动计时）· 交付 ${d.segments.length} 段`,
  ];
  lines.push('── agent 执行 get 时会收到的原文 ──');
  lines.push(d.rendered || deliveryBodyText(d).replace(/^ {2}/gm, ''));
  if (d.segments.length) {
    lines.push('── 段落来源 ──');
    for (const s of d.segments) lines.push(`  · ${s.label}（${String(s.text || '').length} 字）`);
  }
  const sw = d.switches || {};
  lines.push(
    `── 开关 ── ack 提示词 ${sw.ack?.on ? `开（${sw.ack.count} 条）` : '关'}` +
      ` · 交付上下文 ${sw.deliveryTemplate?.custom ? '自定义' : '内置默认'}` +
      ` · 附件段 ${sw.attachTemplate?.custom ? '自定义' : '内置默认'}` +
      ` · 持续 get ${d.getLoop?.enabled ? `开（${d.getLoop.waitMinutes} 分钟）` : '关'}`,
  );
  return lines.join('\n');
}

// cancel 的人读输出：等待中→已关闭（主题与任务保留）；非等待中→无操作；全局→不可关闭
export function renderCancel(d: RenderInput): string {
  if (d.cancelled) return `已关闭主题「${d.name}」的等待：阻塞中的 wait 立即收尾，主题与任务保留。`;
  if (d.reason === 'global_not_waitable') return '全局主题是共享任务池（不是等待源），无从关闭。';
  if (d.reason === 'not_waiting') return `主题「${d.name || d.key}」不在等待中，无需关闭。`;
  return '已关闭。';
}

// 批量删除的人读输出：删除清单 + 跳过清单（等待中/受保护/不存在）
export function renderRemoveMany(d: RenderInput): string {
  const lines: string[] = [d.all ? `清空：删除 ${d.count} 个主题` : `已删除 ${d.count} 个主题`];
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
