// 代码块语法：fenced ``` 包起来的整块原样输出（不跑行内渲染）。
//
// 代码里的 `[[示例]]`、`**x**`、`$x$` 都不该变成链接/粗体/公式——整段由本规则
// 独占，块内文本只做 HTML 转义。未闭合时按到文末处理（与原实现一致）。
//
// 语言标记（```js）不再被丢弃：写进 `data-lang`，样式层按需显示角标。不做语法
// 高亮（那要引入整棵 grammar，与本仓库零依赖的取向冲突）。
import type { BlockMatch, BlockRule } from '../types.js';

export const codeBlockSyntax: BlockRule = {
  id: 'code-fence',
  priority: 10,
  match(lines, i, ctx): BlockMatch | null {
    const fence = lines[i] ?? '';
    if (!fence.startsWith('```')) return null;
    const lang = fence.slice(3).trim().split(/\s+/)[0] ?? '';
    let j = i + 1;
    let body = '';
    while (j < lines.length && !(lines[j] ?? '').startsWith('```')) {
      body += `${ctx.esc(lines[j] ?? '')}\n`;
      j += 1;
    }
    const closed = j < lines.length;
    const attr = lang ? ` data-lang="${ctx.esc(lang)}"` : '';
    return {
      html: `<pre class="mdw-code"${attr}><code>${body}</code></pre>`,
      next: closed ? j + 1 : j,
    };
  },
};
