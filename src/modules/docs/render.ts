// 文档模块的 CLI 人读渲染：list/get/写回/seed/绑定/附件。
// 全是纯函数 —— 输入 action 的结构化结果，输出给人看的文本。
// 入参是 action 产出的结构化结果（外部 JSON 形状），按 any 处理。

// list/get 的人读渲染共用的标题行：rel 或 path，缺省标题来自正文首个 #
function docHead(d: any): string {
  const addr = d.rel ? d.rel : d.path || d.docId;
  const head = d.title ? `「${d.title}」` : '';
  const extra = d.summary && d.summary !== d.title ? ` · ${d.summary}` : '';
  return `${addr}${head}${extra}`;
}

export const renderList = (d: any): string => {
  const lines = [`自有文档 ${d.count} 个（~/.nx-kv/docs/，env NX_KV_DOCS_DIR 可覆盖）`];
  for (const x of d.docs) lines.push(`  ${x.rel}  ${x.title || x.name}`);
  if (d.external?.length) {
    lines.push(`外部文档 ${d.external.length} 个（只读引用）:`);
    for (const x of d.external) lines.push(`  ${x.path}`);
  }
  if (!d.count && !d.external?.length) {
    lines.push('（还没有文档——描述字符串会在首次读取时播种为 md，或直接 docs seed --apply）');
  }
  return lines.join('\n');
};

export const renderGet = (d: any): string => {
  if (d.missing) return `（文档不存在: ${d.rel || d.path}）`;
  if (d.dir) return `（外部目录绑定: ${d.path}，${d.files.length} 个文档）\n  ${d.files.slice(0, 20).join('\n  ')}`;
  const head = [`【${d.title || docHead(d)}】`, `  ${d.rel || d.path}${d.external ? '  （外部 · 可写回来源）' : ''}`, ''];
  return head.join('\n') + d.body;
};

export const renderWritten = (d: any): string =>
  `已写入 ${d.rel}（${d.bytes} 字节）${d.summary ? `\n摘要已回写: ${d.summary}` : ''}`;

export const renderSeed = (d: any): string => {
  if (d.written !== undefined) return `已播种 ${d.written} 份文档:\n  ${(d.items || []).join('\n  ') || '（无）'}`;
  if (!d.count) return '没有需要播种的文档（字符串字段都为空，或约定路径已有 md）';
  return `待播种 ${d.count} 份（--apply 执行）:\n  ${d.items.map((x: any) => `${x.rel}  ←「${x.title}」`).join('\n  ')}`;
};

export const renderRef = (d: any): string =>
  `${d.ref ? '已绑定' : '已拆绑定（回到约定路径）'}: ${d.kind} ${d.name} → ${d.ref ? (d.ref.rel ? 'rel:' + d.ref.rel : 'path:' + d.ref.path) : '约定路径'}`;

export const renderNoteRef = (d: any): string =>
  `${d.ref ? '已绑定' : '已拆绑定'}: 「${d.boardName}」× ${d.repoKey} → ${d.ref ? (d.ref.rel ? 'rel:' + d.ref.rel : 'path:' + d.ref.path) : '约定路径'}`;

export const renderLink = (d: any): string => {
  if (d.removed !== undefined) return `已移除组绑定: ${d.removed}（剩 ${d.count} 条）`;
  const lines = [`「${d.boardName}」的组绑定（${d.count} 条）:`];
  for (const l of d.links) {
    lines.push(`  ${l.rel ? 'rel:' + l.rel : 'path:' + l.path}${l.tag ? `  [${l.tag}]` : ''}${l.note ? `  · ${l.note}` : ''}`);
  }
  return lines.join('\n');
};

export const renderAttachments = (d: any): string => {
  if (!d.attachments.length) {
    return `「${d.locator}」没有登记资源（docs attach --no-embed 可只挂到附件区）`;
  }
  const areaOf = (role: unknown): string => (role === 'attach' ? '附件区' : '正文内嵌');
  const lines = [`「${d.locator}」的资源（${d.attachments.length}）`];
  for (const a of d.attachments) {
    const where = a.localPath || a.url || (a.kind === 'task' ? `task ${a.targetKey}#${a.targetSeq}` : a.targetKey);
    lines.push(`  ${a.id}  [${a.kind}/${a.role} · ${areaOf(a.role)}]  ${a.name || '-'}  ${where || ''}`);
  }
  return lines.join('\n');
};

export const renderAttach = (d: any): string =>
  `已附加 ${d.attachmentId}（${d.kind}）到「${d.ref}」· ${d.area === 'area' ? '附件区（未写正文）' : '正文内嵌'}${d.markdown ? `\n嵌入: ${d.markdown}` : ''}`;

export const renderDetach = (d: any): string => {
  const head = d.unlinked
    ? `已解除「${d.ref}」与附件 ${d.attachment} 的关系`
    : `「${d.ref}」本来就没有引用附件 ${d.attachment}`;
  const tail = d.purged
    ? '；资源已删除（含本机字节）'
    : d.purgeReason === 'in-use'
      ? '；资源仍被其他任务/文档引用，未删字节'
      : d.purgeReason === 'file-locked'
        ? '；文件被占用，未删字节'
        : '';
  return head + tail;
};
