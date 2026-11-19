// 尖括号自动链接：`<https://example.com>` / `<mailto:a@b.c>` → 可点链接。
//
// 走**转义之后**的阶段：`<` 此刻已是 `&lt;`，正好用实体作锚点匹配，不会与真正的
// HTML 标签混淆（正文里的 `<div>` 也被转义成字面量，不会变成标签）。
//
// 裸 URL（不带尖括号）由编排层的 autolinkHtml 兜底；两者互不重叠：本规则只吃
// 成对尖括号包起来的那一种（CommonMark 里这种写法用于「URL 紧贴标点」的场景）。
import type { InlineRule } from '../types.js';
import { mapOutsideTags } from '../inline-scan.js';

const ANGLE_RE = /&lt;((?:https?:\/\/|mailto:)[^\s]+?)&gt;/g;

export const angleAutolinkInlineRule: InlineRule = (html: string): string =>
  mapOutsideTags(html, (text) =>
    text.replace(
      ANGLE_RE,
      (_m, href: string) =>
        `<a class="md-link" href="${href}" target="_blank" rel="noopener noreferrer" title="${href}">${href}</a>`,
    ),
  );
