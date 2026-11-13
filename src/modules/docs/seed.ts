// 文档派生摘要（正文 → 一句话）。
//
// v8 起不再有「约定路径 / 迁移种子 / 摘要回写」：描述的唯一权威是 ref 正文，
// 列表需要摘要时现场派生（brief.ts），不再往字符串字段写影子副本。
import { parseFrontmatter } from '../../core/frontmatter.js';

/** 摘要 = frontmatter description 优先，否则首个非标题非引用非空行，截 120 字 */
export function summaryFromMd(body: unknown): string {
  const fm = parseFrontmatter(String(body || ''));
  if (fm.description) return fm.description.slice(0, 120);
  for (const raw of String(body || '').split('\n')) {
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('>')) continue;
    return t.slice(0, 120);
  }
  return '';
}
