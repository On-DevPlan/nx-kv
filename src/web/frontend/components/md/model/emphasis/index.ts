// 强调语法：斜体 `*x*` / 删除线 `~~x~~`（粗体 `**x**` 仍在渲染器主链，避免重复）。
//
// 行内规则，输入是**已转义**的 HTML 串。处理顺序敏感：必须先吃掉 `**bold**`
// 再处理单 `*` 斜体，否则斜体会把粗体的星号拆散——所以本规则只在渲染器已经
// 替换完 `**`（变成 <b>）之后套用，斜体正则用 `(^|[^*])` 排除双星。
import type { InlineRule } from '../types.js';

export const emphasisInlineRule: InlineRule = (html: string): string =>
  html
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
