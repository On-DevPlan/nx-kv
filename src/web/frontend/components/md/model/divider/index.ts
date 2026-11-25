// 分隔线语法：独占一行的 3 个以上 `-` / `*` / `_`（可夹空格）→ `<hr>`。
import type { BlockMatch, BlockRule } from '../types.js';

export const dividerSyntax: BlockRule = {
  id: 'divider',
  // 必须**先于无序列表**（45）：`* * *` / `- - -` 同时符合「列表项」的形状，
  // 整行只有分隔符时以分隔线为准（CommonMark 的 thematic break 优先）。
  priority: 44,
  match(lines, i): BlockMatch | null {
    const t = (lines[i] ?? '').trim();
    if (!/^(?:-[ \t]*){3,}$/.test(t) && !/^(?:\*[ \t]*){3,}$/.test(t) && !/^(?:_[ \t]*){3,}$/.test(t)) {
      return null;
    }
    return { html: '<hr class="md-divider">', next: i + 1 };
  },
};
