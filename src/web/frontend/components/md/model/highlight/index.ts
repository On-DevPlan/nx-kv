// 高亮语法：`==重点==` → `<mark>`（Obsidian 口径，非 CommonMark 标准但文档写作常用）。
//
// 跑在「代码/链接已就位」的 HTML 上，必须跳过受保护标签内部：`<code>==x==</code>`
// 里的等号是代码内容。`==` 在 LaTeX 公式里也可能出现，公式标签由数学规则自己
// 把控顺序（公式先于本规则生成标签，标签内部受保护）。
import type { InlineRule } from '../types.js';
import { mapOutsideTags } from '../inline-scan.js';

export const highlightInlineRule: InlineRule = (html: string): string =>
  mapOutsideTags(html, (text) => text.replace(/==([^=\n]+)==/g, '<mark>$1</mark>'));
