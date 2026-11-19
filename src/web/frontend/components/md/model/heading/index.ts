// 标题语法：`#` … `######` 行 → h1–h6（带滚动目录用的锚点 id）。
//
// 渲染支持全部 6 级（CommonMark）；右侧滚动目录仍只抽 1–3 级（extractMdHeadings），
// 更深的层级在长文里会淹没导航，那是**目录**的取舍，不该限制渲染能力。
import type { BlockMatch, BlockRule } from '../types.js';

export const headingSyntax: BlockRule = {
  id: 'heading',
  priority: 30,
  match(lines, i, ctx): BlockMatch | null {
    const line = lines[i] ?? '';
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) return null;
    const level = (m[1] ?? '#').length;
    const text = m[2] ?? '';
    const id = ctx.headingId(text.trim(), ctx.usedIds);
    return { html: `<h${level} id="${ctx.esc(id)}">${ctx.inline(text)}</h${level}>`, next: i + 1 };
  },
};
