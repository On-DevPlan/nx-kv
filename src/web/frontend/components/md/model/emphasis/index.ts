// 强调语法：斜体 `*x*` / 删除线 `~~x~~`（粗体 `**x**` 仍在渲染器主链，避免重复）。
//
// 行内规则，输入是**已转义**的 HTML 串。两个顺序要点：
//   1. 必须先吃掉 `**bold**` 再处理单 `*` 斜体，否则斜体会把粗体的星号拆散——
//      所以本规则只在渲染器已经替换完 `**`（变成 <b>）之后套用；斜体正则用
//      `(^|[^*])` 排除双星。
//   2. 必须跳过 `<code>` / `<a>` 内部的文本（mapOutsideTags）：代码里写
//      `a*b*c` 或 `~~x~~` 应当原样显示，那不是在标记强调。
//
// 刻意**不认** `_x_` 下划线斜体：中文技术文档里 snake_case 标识符（`file_name`、
// `user_id`）极常见，按 CommonMark 的 intraword 规则放过它反而漏判更多，收益不抵
// 误伤风险。要斜体请用 `*x*`。
import type { InlineRule } from '../types.js';
import { mapOutsideTags } from '../inline-scan.js';

export const emphasisInlineRule: InlineRule = (html: string): string =>
  mapOutsideTags(html, (text) =>
    text
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>'),
  );
