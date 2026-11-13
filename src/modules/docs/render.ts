// 文档模块的 CLI 人读渲染：list/get/写回/seed/绑定/附件。
// 全是纯函数 —— 输入 action 的结构化结果，输出给人看的文本。
// 入参是 action 产出的结构化结果（外部 JSON 形状），按 any 处理。

const KIND_NOTE: Record<string, string> = {
  legacy: '历史空壳',
  external: '外部文件镜像',
  empty: '正文缺失',
};

export const renderList = (d: any): string => {
  const withBody = (d.docs || []).filter((x: any) => x.hasBody).length;
  const lines = [`文档 ${d.count} 个（${withBody} 个有正文；正文只存库内）`];
  for (const x of d.docs) {
    // ref 是 DB 实体：列表以 desc（缺省标题）为主标签，地址用 refId，不展示路径
    const label = x.desc || x.title || x.name || '未命名文档';
    const tag = x.hasBody ? '' : `  （无正文 · ${KIND_NOTE[x.kind] || '正文缺失'}）`;
    lines.push(`  ${label}  [${x.refId || x.docId}]${tag}`);
  }
  if (d.external?.length) {
    lines.push(`外部文档 ${d.external.length} 个（只读引用）:`);
    for (const x of d.external) lines.push(`  ${x.path}`);
  }
  if (!d.count && !d.external?.length) {
    lines.push('（还没有文档——在宿主面板点 ＋ 新建，正文写入库内）');
  }
  return lines.join('\n');
};

export const renderGet = (d: any): string => {
  if (d.missing) {
    // 有 kind = 「条目存在但没有正文」（历史空壳 / 外部镜像 / 正文缺失）；
    // 没有 kind = 外部路径本身不存在。
    const who = d.desc || d.title || d.refId || d.docId || d.path;
    if (d.kind) {
      const kind = KIND_NOTE[d.kind] ? ` · ${KIND_NOTE[d.kind]}` : '';
      return `（无正文${kind}: ${who}${d.reason ? ` — ${d.reason}` : ''}）`;
    }
    return `（文档不存在: ${who}）`;
  }
  if (d.dir) return `（外部目录绑定: ${d.path}，${d.files.length} 个文档）\n  ${d.files.slice(0, 20).join('\n  ')}`;
  const title = d.desc || d.title || '未命名文档';
  const head = [`【${title}】`, `  ${d.refId || d.docId}${d.external ? '  （外部 · 可写回来源）' : ''}`, ''];
  return head.join('\n') + d.body;
};

export const renderWritten = (d: any): string => {
  const who = d.desc || d.refId || d.path || d.docId;
  const descLine = d.desc !== undefined ? `\n描述: ${d.desc || '（空）'}` : '';
  return `已写入 ${who}（${d.bytes} 字节）${d.summary ? `\n摘要: ${d.summary}` : ''}${descLine}`;
};

export const renderRef = (d: any): string =>
  `${d.ref ? '已绑定' : '已解绑'}: ${d.kind} ${d.name} → ${d.ref ? 'ref:' + d.ref.ref : '（空）'}`;

export const renderNoteRef = (d: any): string =>
  `${d.ref ? '已绑定' : '已解绑'}: 「${d.boardName}」× ${d.repoKey} → ${d.ref ? 'ref:' + d.ref.ref : '（空）'}`;

export const renderLink = (d: any): string => {
  if (d.removed !== undefined) return `已移除组绑定: ${d.removed}（剩 ${d.count} 条）`;
  const lines = [`「${d.boardName}」的组绑定（${d.count} 条）:`];
  for (const l of d.links) {
    lines.push(`  ref:${l.ref}${l.tag ? `  [${l.tag}]` : ''}${l.note ? `  · ${l.note}` : ''}`);
  }
  return lines.join('\n');
};

export const renderAttachments = (d: any): string => {
  if (!d.attachments.length) {
    return `「${d.refId}」没有登记资源（docs attach --no-embed 可只挂到附件区）`;
  }
  const areaOf = (role: unknown): string => (role === 'attach' ? '附件区' : '正文内嵌');
  const lines = [`「${d.refId}」的资源（${d.attachments.length}）`];
  for (const a of d.attachments) {
    const where = a.localPath || a.url || (a.kind === 'mdfile' ? a.absPath
      : a.kind === 'task' ? `task ${a.targetKey}#${a.targetSeq}` : a.targetKey);
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
