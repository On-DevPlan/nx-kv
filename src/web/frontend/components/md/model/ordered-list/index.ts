// 有序列表语法：连续的 `1. ` / `1) ` 行 → `<ol><li>…</li></ol>`。
//
// 原渲染器只认无序 `- `，有序列表会掉成段落；这里补上。支持项内续行与缩进嵌套
// 子列表（解析见 list-common）。首项序号 > 1 时输出 `start` 属性（`3.` 起头的列表
// 不该被强行从 1 重新编号）。
import type { BlockMatch, BlockRule } from '../types.js';
import { collectListItems, indentOf, wrapList, type ListLineMatch } from '../list-common.js';

const ITEM_RE = /^([ \t]*)(\d+)[.)]\s+(.*)$/;

function parse(line: string): ListLineMatch | null {
  const m = ITEM_RE.exec(line);
  if (!m) return null;
  return { indent: indentOf(line), num: Number(m[2] ?? 1), box: '', body: m[3] ?? '' };
}

export const orderedListSyntax: BlockRule = {
  id: 'ordered-list',
  priority: 40,
  match(lines, i, ctx): BlockMatch | null {
    const first = parse(lines[i] ?? '');
    if (!first) return null;
    const { items, next } = collectListItems(lines, i, parse, first.indent);
    const html = wrapList(items, 'ol', ctx, (_it, inner, sub) => ({ attr: '', body: `${inner}${sub}` }));
    return { html, next };
  },
};
