// 标题语法：`#` / `##` / `###` 行 → h1–h3（带滚动目录用的锚点 id）。
//
// 只认 1–3 级（与右侧目录 extractMdHeadings 一致）；4 级以上按段落处理。
import type { BlockMatch, BlockRule } from '../types.js';

export const headingSyntax: BlockRule = {
  id: 'heading',
  priority: 30,
  match(lines, i, ctx): BlockMatch | null {
    const line = lines[i] ?? '';
    const m = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!m) return null;
    const level = (m[1] ?? '#').length;
    const text = m[2] ?? '';
    const id = ctx.headingId(text.trim(), ctx.usedIds);
    return { html: `<h${level} id="${ctx.esc(id)}">${ctx.inline(text)}</h${level}>`, next: i + 1 };
  },
};
