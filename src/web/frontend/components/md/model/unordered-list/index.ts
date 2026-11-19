// 无序列表语法：连续的 `- ` / `* ` / `+ ` 行 → `<ul><li>`；`- [ ]` / `- [x]` 渲染成待办复选框。
//
// 一条规则消费整圈列表项（含项内续行与缩进嵌套子列表，解析见 list-common）。
// 复选框用 ☑/☐ 字符 + .mdw-cb，点击切换由组件层按出现顺序数第 n 个（见 md-edit-ops）。
//
// `*` / `+` 三种标记都认（CommonMark）：`* * *` 这类整行分隔符由 divider 规则先接管
// ——后者 priority 更小，先于本规则尝试。
import type { BlockMatch, BlockRule } from '../types.js';
import { collectListItems, indentOf, wrapList, type ListLineMatch } from '../list-common.js';

const ITEM_RE = /^([ \t]*)[-*+]\s+(\[[ xX]\])?\s*(.*)$/;

function parse(line: string): ListLineMatch | null {
  const m = ITEM_RE.exec(line);
  if (!m) return null;
  return { indent: indentOf(line), num: 0, box: m[2] ?? '', body: m[3] ?? '' };
}

export const unorderedListSyntax: BlockRule = {
  id: 'unordered-list',
  priority: 45,
  match(lines, i, ctx): BlockMatch | null {
    const first = parse(lines[i] ?? '');
    if (!first) return null;
    const { items, next } = collectListItems(lines, i, parse, first.indent);
    const html = wrapList(items, 'ul', ctx, (it, inner, sub) => {
      if (!it.box) return { attr: '', body: `${inner}${sub}` };
      const done = /x/i.test(it.box);
      const mark = done ? '☑' : '☐';
      return {
        attr: done ? ' class="done"' : ' class="todo"',
        body: `<span class="mdw-cb" aria-hidden="true">${mark}</span>${inner}${sub}`,
      };
    });
    return { html, next };
  },
};
