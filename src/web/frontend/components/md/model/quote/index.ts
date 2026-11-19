// 引用 / callout 语法：连续的 `>` 行合成一个块。
//
// 首行带 `[!TYPE] 标题` → 渲染成醒目色块（div.md-callout-<type>，GFM/Obsidian
// 口径）；无标记 → 普通 blockquote。
//
// 块级内容：引用里可以正常写列表 / 代码块 / 表格——去掉 `>` 前缀后交给 ctx.block
// 递归渲染。callout 是卡片视觉，**纯文本正文仍按行 `<br>` 拼接**（保持既有观感与
// 测试口径）；只有检测到块级语法时才走递归。
import type { BlockMatch, BlockRule } from '../types.js';

/** 去掉引用前缀后的行里，是否含块级语法的起头（决定走递归还是纯文本）。 */
const BLOCKY_RE = /^[ \t]*(?:[-*+]\s|\d+[.)]\s|```|\||#{1,6}\s|>)/m;

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
      const rest = q.slice(1);
      const bodyHtml = BLOCKY_RE.test(rest.join('\n'))
        ? ctx.block(rest)
        : splitParagraphs(rest)
            .map((p) => p.map((l) => ctx.inline(l)).join('<br>'))
            .join('<br><br>');
      const html =
        `<div class="md-callout md-callout-${ctx.esc(type)}">` +
        (title ? `<div class="md-callout-t">${ctx.inline(title)}</div>` : '') +
        `<div class="md-callout-b">${bodyHtml}</div></div>`;
      return { html, next: j };
    }
    // 普通引用：整段交回渲染流程（段落合并、列表、代码块都按正文语义走）
    return { html: `<blockquote>${ctx.block(q)}</blockquote>`, next: j };
  },
};

/** 按空行切成段落组（callout 纯文本正文用）。 */
function splitParagraphs(lines: string[]): string[][] {
  const paras: string[][] = [];
  let cur: string[] = [];
  for (const l of lines) {
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
  return paras;
}
