// 引用 / callout 语法：连续的 `>` 行合成一个块。
//
// 首行带 `[!TYPE] 标题` → 渲染成醒目色块（div.md-callout-<type>，GFM/Obsidian
// 口径）；无标记 → 普通 blockquote。正文按空行分段（段间 <br><br>）、段内 <br>。
import type { BlockMatch, BlockRule } from '../types.js';

export const quoteSyntax: BlockRule = {
  id: 'quote',
  priority: 25,
  match(lines, i, ctx): BlockMatch | null {
    if (!(lines[i] ?? '').startsWith('>')) return null;
    const q: string[] = [];
    let j = i;
    while (j < lines.length && (lines[j] ?? '').startsWith('>')) {
      q.push((lines[j] ?? '').replace(/^>[ \t]?/, ''));
      j += 1;
    }
    const first = q[0] ?? '';
    const cm = first.match(/^\[!([A-Za-z][\w-]*)\][ \t]*(.*)$/);
    if (cm) {
      const type = String(cm[1] || '').toLowerCase();
      const title = String(cm[2] || '').trim();
      const paras: string[][] = [];
      let cur: string[] = [];
      for (const l of q.slice(1)) {
        if (!l.trim()) {
          if (cur.length) {
            paras.push(cur);
            cur = [];
          }
          continue;
        }
        cur.push(l);
      }
      if (cur.length) paras.push(cur);
      const bodyHtml = paras.map((p) => p.map((l) => ctx.inline(l)).join('<br>')).join('<br><br>');
      const html =
        `<div class="md-callout md-callout-${ctx.esc(type)}">` +
        (title ? `<div class="md-callout-t">${ctx.inline(title)}</div>` : '') +
        `<div class="md-callout-b">${bodyHtml}</div></div>`;
      return { html, next: j };
    }
    return { html: `<blockquote>${q.map((l) => ctx.inline(l)).join('<br>')}</blockquote>`, next: j };
  },
};
