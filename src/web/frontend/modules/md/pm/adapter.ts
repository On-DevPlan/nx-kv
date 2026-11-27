// PM 内核 M1 适配层：块数组（md-blocks 的 split/join 空间）↔ PM 文档。
//
// 这是 body 字符串真相与单一 PM 文档之间的**唯一进出通道**（方案 §三）：
//   parse：liveBodyBlocks 产出的块数组 → doc(block+)；
//   serialize：doc → 块数组（调用方 joinMdBlocks 回正文）。
//
// M1 映射：
//   - 空块            → 空 paragraph（join 时 ZWSP 回编码，口径与旧编辑器一致）
//   - 标题块 #{1..6}  → heading 节点（块切分保证标题独占块；防御性处理多行）
//   - 段落块          → paragraph + hardBreak（块内软换行 = 行间 `<br>` 口径）
//   - 其余语法块      → rawBlock{syntax} 兜底（列表/引用/代码块/表格/公式/
//     图片/分隔线/脚注），原文逐字保真——M2 起逐语法升级为真节点。
// 序列化红线：除 paragraph 出口的「行首 # 转义」外零加工——兜底块字节原样，
// 段落经 inline 层的最小转义保证重解析稳定（见 inline.ts roundTripStable）。
import type { Node as PMNode, Schema } from 'prosemirror-model';
import { parseInline, serializeInline } from './inline.js';
import { mdNode, mdSchema, type RawSyntax } from './schema.js';

/**
 * 兜底块的 syntax 分类（仅作样式钩子与 M2 迁移清单；分类错误不影响保真——
 * 序列化永远按原文走）。首行形态判定，与 model/ 各块规则的识别口径对齐。
 */
function rawSyntaxOf(block: string): RawSyntax {
  const first = block.split('\n')[0] ?? '';
  const t = first.trimStart();
  if (/^\$\$/.test(t)) return 'math';
  if (t.startsWith('```')) return 'codeblock';
  if (t.startsWith('>')) return 'quote';
  // 列表：整段交替锚定（无锚定的 `\d+[.)]\s` 会把「见 1. 说明」误判成列表）
  if (/^(?:[-*+]|\d+[.)])\s/.test(t)) return 'list';
  if (/^\[\^/.test(t)) return 'footnote';
  if (t.startsWith('![')) return 'image';
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return 'divider';
  // 表格：首行含 | 且第二行是分隔行（tableSyntax 同款判定）
  const second = block.split('\n')[1] ?? '';
  if (first.includes('|') && /^\s*\|?\s*:?-{1,}:?/.test(second)) return 'table';
  return 'unknown';
}

/** 单块 → PM 顶层节点（标题块的后续行随标题内容字面承载，往返逐字节）。 */
function blockToPmNodes(block: string, schema: Schema): PMNode[] {
  if (!block) return [mdNode(schema, 'paragraph').create()];
  const hashes = /^#{1,6}(?=\s)/.exec(block)?.[0];
  if (hashes) {
    // splitMdBlocks 保证标题独占块；后续行（理论不存在）作为字面文本留在标题内，
    // 序列化原样还原——不拆第二节点，保 round-trip 逐字节。
    const level = Math.min(6, Math.max(1, hashes.length));
    const rest = block.slice(hashes.length).replace(/^[ \t]+/, '');
    const content = parseInline(rest, schema);
    if (content.length) return [mdNode(schema, 'heading').createChecked({ level }, content)];
    return [mdNode(schema, 'heading').createChecked({ level })];
  }
  const syntax = rawSyntaxOf(block);
  if (syntax !== 'unknown') {
    return [mdNode(schema, 'rawBlock').createChecked({ syntax }, schema.text(block))];
  }
  // 段落：逐行 inline 解析，行间 hardBreak（块内软换行 = `<br>` 口径）
  const lines = block.split('\n');
  const inline: PMNode[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) inline.push(mdNode(schema, 'hardBreak').createChecked());
    inline.push(...parseInline(line, schema));
  });
  return [mdNode(schema, 'paragraph').createChecked(null, inline)];
}

/** 块数组 → PM 文档（空数组给一个空段落，保证 doc 至少一个块）。 */
export function blocksToPmDoc(blocks: readonly string[], schema: Schema = mdSchema): PMNode {
  const nodes: PMNode[] = [];
  for (const block of blocks) nodes.push(...blockToPmNodes(block, schema));
  if (!nodes.length) nodes.push(mdNode(schema, 'paragraph').create());
  return mdNode(schema, 'doc').createChecked(null, nodes);
}

/** PM 顶层块节点 → markdown 文本（行首 # 转义在此出口统一处理）。 */
function pmBlockToMd(node: PMNode, schema: Schema): string {
  if (node.type.name === 'heading') {
    const level = Math.min(6, Math.max(1, Number(node.attrs.level) || 1));
    const inline = node.content ? node.content.content : [];
    return `${'#'.repeat(level)} ${serializeInline(inline, schema)}`;
  }
  if (node.type.name === 'rawBlock') {
    return node.textContent; // 兜底块：字节原样，零加工
  }
  // paragraph（及其他未知顶层块的兜底）：逐行保护行首 #
  const inline = node.content ? node.content.content : [];
  const text = serializeInline(inline, schema);
  return text
    .split('\n')
    .map((line) => (line.startsWith('#') ? `\\${line}` : line))
    .join('\n');
}

/** PM 文档 → 块数组（调用方 joinMdBlocks 回正文；空文档给 [''] 对齐 split 口径）。 */
export function pmDocToBlocks(doc: PMNode, schema: Schema = mdSchema): string[] {
  const blocks: string[] = [];
  doc.forEach((node) => blocks.push(pmBlockToMd(node, schema)));
  return blocks.length ? blocks : [''];
}
