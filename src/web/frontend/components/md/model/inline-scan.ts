// 行内扫描工具：只对**文本节点**套用替换，跳过已生成的受保护标签内部。
//
// 为什么需要：行内规则跑在「代码 / 链接已就位」的 HTML 上（见 md-render 的 inline
// 主链）。若不加区分地对整串做正则，`<code>a*b*c</code>` 会被斜体规则改成
// `<code>a<em>b</em>c</code>`——代码里的星号本该原样显示。同理 `<a>` 的锚文本与
// `<mark>` 内部不该被二次套用。
//
// 按标签切分而不是用「负向断言」：HTML 是嵌套的，正则断言管不住深度，切分 + 计数
// 才能正确覆盖 `<code><b>x</b></code>` 这种嵌套。

/** 内部文本不再套用行内规则的标签（内容属于别的语法所有）。 */
const PROTECTED = new Set(['code', 'pre', 'a', 'mark']);

/**
 * 对 HTML 串的文本节点套用 `fn`，受保护标签内部的文本原样保留。
 *
 * 标签本身不参与匹配（只作为边界），因此不会破坏既有标签结构。
 */
export function mapOutsideTags(html: string, fn: (text: string) => string): string {
  const parts = html.split(/(<[^>]*>)/);
  const out: string[] = [];
  let depth = 0; // >0 = 处在受保护标签内部
  for (const p of parts) {
    if (p.startsWith('<')) {
      const m = /^<(\/?)\s*([a-zA-Z][\w-]*)/.exec(p);
      const name = (m && m[2] ? m[2] : '').toLowerCase();
      if (PROTECTED.has(name)) {
        if (m && m[1] === '/') depth = Math.max(0, depth - 1);
        else if (!p.endsWith('/>')) depth += 1;
      }
      out.push(p);
      continue;
    }
    out.push(depth > 0 ? p : fn(p));
  }
  return out.join('');
}

/**
 * 对**原始 markdown 文本**里代码片段（`` `…` ``）之外的片段套用 `fn`。
 *
 * 用于转义预处理：`` `\*` `` 里的反斜杠是代码内容，不该被当成转义符吃掉。
 */
export function mapOutsideCodeSpans(text: string, fn: (chunk: string) => string): string {
  const parts = text.split(/(`[^`]*`)/);
  return parts.map((p) => (p.startsWith('`') && p.endsWith('`') && p.length >= 2 ? p : fn(p))).join('');
}
