// 数学公式语法：块级 `$$ … $$`（可跨行）+ 行内 `$ … $`。
//
// 块级规则：以 `$$` 开头即接管，直到闭合 `$$`；单行 `$$…$$` 直接成块。
// 行内规则：在**已转义**的 HTML 串上识别 `$…$`（跳过 `<code>`/`<a>` 内部，避免
// 误伤代码与链接里的美元号）。
//
// 渲染委托给同目录 latex.ts（零依赖轻量实现，含 matrix 矩阵）。
import type { BlockMatch, BlockRule, InlineRule } from '../types.js';
import { renderLatex, stripMathDelims } from './latex.js';

/** 块级公式：`$$` 独占行或同行闭合。 */
export const mathBlockSyntax: BlockRule = {
  id: 'math',
  priority: 15,
  match(lines, i): BlockMatch | null {
    const line = lines[i] ?? '';
    const t = line.trim();
    if (!t.startsWith('$$')) return null;

    // 单行 $$...$$（且不是仅 "$$" 开头后紧跟内容无闭合）
    if (t.length > 4 && t.endsWith('$$') && !t.startsWith('$$$$')) {
      const expr = stripMathDelims(t);
      return { html: `<div class="md-math-block">${renderLatex(expr)}</div>`, next: i + 1 };
    }

    // 多行：收集到下一个单独的 `$$`
    const body: string[] = [];
    let j = i + 1;
    const firstInline = t.slice(2).trim(); // "$$ x" 同行起头的内容
    if (firstInline) body.push(firstInline);
    let closed = false;
    while (j < lines.length) {
      const cur = lines[j] ?? '';
      if (cur.trim() === '$$') {
        closed = true;
        j += 1;
        break;
      }
      body.push(cur);
      j += 1;
    }
    if (!closed && !body.length) return null;
    return { html: `<div class="md-math-block">${renderLatex(body.join('\n'))}</div>`, next: j };
  },
};

/** 行内公式：`$…$`（跳过标签与代码内部）。 */
export const mathInlineRule: InlineRule = (html: string): string => {
  const parts = html.split(/(<[^>]*>)/);
  let skip = 0;
  const out: string[] = [];
  for (const p of parts) {
    if (p.startsWith('<')) {
      const tag = /^<(\/?)\s*([a-zA-Z][\w-]*)/.exec(p);
      const name = (tag && tag[2] ? tag[2] : '').toLowerCase();
      if (name === 'code' || name === 'a') {
        if (tag && tag[1] === '/') skip = Math.max(0, skip - 1);
        else if (!p.endsWith('/>')) skip += 1;
      }
      out.push(p);
      continue;
    }
    if (skip > 0) {
      out.push(p);
      continue;
    }
    out.push(p.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_m, expr: string) => `<span class="md-math-inline">${renderLatex(expr.trim())}</span>`));
  }
  return out.join('');
};
