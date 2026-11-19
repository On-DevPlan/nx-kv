// 代码块语法：fenced ``` 包起来的整块原样输出（不跑行内渲染）。
//
// 代码里的 `[[示例]]`、`**x**`、`$x$` 都不该变成链接/粗体/公式——整段由本规则
// 独占，块内文本只做 HTML 转义。未闭合时按到文末处理（与原实现一致）。
import type { BlockMatch, BlockRule } from '../types.js';

export const codeBlockSyntax: BlockRule = {
  id: 'code-fence',
  priority: 10,
  match(lines, i, ctx): BlockMatch | null {
    if (!(lines[i] ?? '').startsWith('```')) return null;
    let j = i + 1;
    let body = '';
    while (j < lines.length && !(lines[j] ?? '').startsWith('```')) {
      body += `${ctx.esc(lines[j] ?? '')}\n`;
      j += 1;
    }
    const closed = j < lines.length;
    return {
      html: `<pre class="mdw-code"><code>${body}</code></pre>`,
      next: closed ? j + 1 : j,
    };
  },
};
