// 无序列表语法：连续的 `- ` 行 → `<ul><li>`；`- [ ]` / `- [x]` 渲染成待办复选框。
//
// 一条规则消费整段连续项（等价于旧实现的 inUl 状态机，但无跨行状态）。
// 复选框用 ☑/☐ 字符 + .mdw-cb，点击切换由组件层按出现顺序数第 n 个（见 md-edit-ops）。
import type { BlockMatch, BlockRule } from '../types.js';

const ITEM_RE = /^-\s+(\[[ xX]\])?\s*(.*)$/;

export const unorderedListSyntax: BlockRule = {
  id: 'unordered-list',
  priority: 45,
  match(lines, i, ctx): BlockMatch | null {
    if (!ITEM_RE.test(lines[i] ?? '')) return null;
    const items: string[] = [];
    let j = i;
    while (j < lines.length) {
      const m = ITEM_RE.exec(lines[j] ?? '');
      if (!m) break;
      const box = m[1];
      const body = m[2] ?? '';
      if (box) {
        const done = /x/i.test(box);
        const mark = done ? '☑' : '☐';
        items.push(
          `<li class="${done ? 'done' : 'todo'}"><span class="mdw-cb" aria-hidden="true">${mark}</span>${ctx.inline(body)}</li>`,
        );
      } else {
        items.push(`<li>${ctx.inline(body)}</li>`);
      }
      j += 1;
    }
    return { html: `<ul>${items.join('')}</ul>`, next: j };
  },
};
