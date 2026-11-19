// 表格语法（GFM pipe table）：`| a | b |` + 分隔行 `| --- | :--: |` + 数据行。
//
// 一条块级规则：match 命中「表头行 + 分隔行」即整段接管，连续管道行一并消费；
// 单元格文本复用渲染器的行内渲染（ctx.inline），所以单元格里的粗体/斜体/公式/
// 链接都能生效。对齐由分隔行的冒号决定（:-- 左 / :-: 中 / --: 右）。
import type { BlockMatch, BlockRule } from '../types.js';

/** 拆分一行管道表：去掉首尾竖线后按 `|` 切、逐格 trim。 */
function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** 分隔行判定：由 `---` / `:--` / `--:` / `:-:` 之类格子组成，至少一个 `|`。 */
function isDelimiterRow(line: string): boolean {
  const s = line.trim();
  if (!s.includes('|') && !/^:?-{1,}:?$/.test(s)) return false;
  const cells = splitCells(s);
  if (!cells.length) return false;
  return cells.every((c) => /^:?-{1,}:?$/.test(c));
}

/** 从分隔行解析每列对齐：left / center / right / ''（默认）。 */
function parseAligns(line: string): string[] {
  return splitCells(line).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
}

function alignAttr(align: string): string {
  return align ? ` style="text-align:${align}"` : '';
}

function renderRow(cells: string[], tag: 'th' | 'td', aligns: string[], inline: (t: string) => string): string {
  return (
    '<tr>' +
    cells
      .map((c, k) => `<${tag}${alignAttr(aligns[k] ?? '')}>${inline(c)}</${tag}>`)
      .join('') +
    '</tr>'
  );
}

export const tableSyntax: BlockRule = {
  id: 'table',
  priority: 20,
  match(lines, i, ctx): BlockMatch | null {
    const header = lines[i] ?? '';
    const delim = lines[i + 1] ?? '';
    if (!header.includes('|')) return null;
    if (!isDelimiterRow(delim)) return null;
    const aligns = parseAligns(delim);
    const headCells = splitCells(header);
    if (!headCells.length) return null;

    const body: string[] = [];
    let j = i + 2;
    while (j < lines.length) {
      const row = lines[j] ?? '';
      if (!row.trim() || !row.includes('|')) break;
      body.push(renderRow(splitCells(row), 'td', aligns, ctx.inline));
      j += 1;
    }
    let html = '<table class="md-table"><thead>';
    html += renderRow(headCells, 'th', aligns, ctx.inline);
    html += '</thead>';
    if (body.length) html += `<tbody>${body.join('')}</tbody>`;
    html += '</table>';
    return { html, next: j };
  },
};
