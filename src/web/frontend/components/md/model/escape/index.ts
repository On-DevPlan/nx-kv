// 转义语法：反斜杠让紧跟的标点按字面显示（`\*` → `*`，不开启强调）。
//
// 必须在 **HTML 转义之前**动手：等到 `*` 被强调规则吃掉就晚了。做法是把
// `\X` 换成私有区占位符（`\uE000 <hex> \uE001`），整条渲染流水线都看不见那个
// 字符，最后一步再由 `restoreEscapes` 换回**转义后的字面字符**。
//
// 为什么占位符里存**十六进制**而不是字符本身：占位符要穿过行内规则（强调 / 高亮 /
// 公式），若里面直接放着 `*`，强调规则照样会把两个占位符之间的内容当斜体
// （实测：`\*不是斜体\*` 会渲染成 `<em>`）。存成 `2a` 之后，串里没有任何 markdown
// 标记字符，规则自然无从匹配。
//
// 为什么不用 `&#42;` 这类实体：`esc()` 会把 `&` 转成 `&amp;`，实体反而被打散。
// 占位符是唯一能安全穿过「转义 → 标签生成 → 行内规则」的载体。
//
// 代码片段内部的 `\` 是内容（`` `\*` `` 就该显示 `\*`），所以替换要跳过 code span。
import type { InlinePreRule } from '../types.js';
import { mapOutsideCodeSpans } from '../inline-scan.js';

const PH_OPEN = '\uE000';
const PH_CLOSE = '\uE001';

export const escapePreRule: InlinePreRule = (text: string): string =>
  mapOutsideCodeSpans(text, (chunk) =>
    chunk.replace(/\\([\\`*_{}[\]()#+\-.!|~=^$<>])/g, (_m, ch: string) => {
      const hex = ch.charCodeAt(0).toString(16).padStart(2, '0');
      return `${PH_OPEN}${hex}${PH_CLOSE}`;
    }),
  );

/** 占位符还原：把 `\uE0002a\uE001` 换回经 HTML 转义的字面字符。 */
export function restoreEscapes(html: string, esc: (value: unknown) => string): string {
  return html.replace(/\uE000([0-9a-f]{2})\uE001/g, (_m, hex: string) =>
    esc(String.fromCharCode(parseInt(hex, 16))),
  );
}
