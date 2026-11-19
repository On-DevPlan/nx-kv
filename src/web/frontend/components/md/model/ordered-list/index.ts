// 有序列表语法：连续的 `1. ` 行 → `<ol><li>…</li></ol>`。
//
// 原渲染器只认无序 `- `，有序列表会掉成段落；这里补上。一条规则一次性消费
// 连续的有序项，避免依赖跨行状态机。
import type { BlockMatch, BlockRule } from '../types.js';

const ITEM_RE = /^\s*(\d+)[.)]\s+(.*)$/;

export const orderedListSyntax: BlockRule = {
  id: 'ordered-list',
  priority: 40,
  match(lines, i, ctx): BlockMatch | null {
    if (!ITEM_RE.test(lines[i] ?? '')) return null;
    const items: string[] = [];
    let j = i;
    while (j < lines.length) {
      const m = ITEM_RE.exec(lines[j] ?? '');
      if (!m) break;
      items.push(`<li>${ctx.inline(m[2] ?? '')}</li>`);
      j += 1;
    }
    return { html: `<ol>${items.join('')}</ol>`, next: j };
  },
};
