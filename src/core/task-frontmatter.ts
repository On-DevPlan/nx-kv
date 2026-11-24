// 任务正文 frontmatter 的**最小读/剥**实现（#197 起归属在库内关联，正文只存 markdown）。
//
// 谁在用：迁移（v16-data）、legacy 导入（import-json/tasks）、附件摘要（attachmentdb/resources）——
// 三处原先各自内联同一份正则，#200 收拢到这里单点维护。
//
// 注意分层：core 是最底层，不能 import shared —— 本文件与 shared/frontmatter.ts（任务
// frontmatter 的完整实现）是**同口径的两份**，改这里要对照那边；shared 只多出
// 「渲染旧数据」场景所需的宽容度，读/剥语义一致。
//
// 只做两件事：
//   parseFrontmatterBody —— 读 `---` 块里的键值（单行值，无 YAML 依赖）
//   stripFrontmatterBody —— 剥掉头部块（块内没有任何键值行时视为普通分隔线，不剥）

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const FM_KV_RE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;

/** 读任务正文头部的 frontmatter 键值（无块/坏块都回空对象，不抛错）。 */
export function parseFrontmatterBody(src: unknown): Record<string, string> {
  const m = String(src ?? '').match(FM_RE);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = line.match(FM_KV_RE);
    if (kv) out[kv[1] ?? ''] = (kv[2] ?? '').trim();
  }
  return out;
}

/** 剥掉任务正文头部的 frontmatter（块内没有任何键值行时视为普通分隔线，原样返回）。 */
export function stripFrontmatterBody(src: unknown): string {
  return String(src ?? '').replace(FM_RE, (block: string, inner: string) => {
    const kv = String(inner || '').split(/\r?\n/).some((l) => FM_KV_RE.test(l));
    return kv ? '' : block;
  });
}
