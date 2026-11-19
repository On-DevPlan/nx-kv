// 分隔线语法：独占一行的 3 个以上 `-` / `*` / `_`（可夹空格）→ `<hr>`。
//
// 不匹配 `- ` 列表（需要三个以上且整行只有分隔符）。frontmatter 在渲染前已被
// stripFrontmatter 剥掉，正文里的 `---` 一律按 thematic break 处理。
import type { BlockMatch, BlockRule } from '../types.js';

export const dividerSyntax: BlockRule = {
  id: 'divider',
  priority: 50,
  match(lines, i): BlockMatch | null {
    const t = (lines[i] ?? '').trim();
    if (!/^(?:-[ \t]*){3,}$/.test(t) && !/^(?:\*[ \t]*){3,}$/.test(t) && !/^(?:_[ \t]*){3,}$/.test(t)) {
      return null;
    }
    return { html: '<hr class="md-divider">', next: i + 1 };
  },
};
