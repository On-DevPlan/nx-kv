// 列表解析的公共件：把「一圈列表项」解析成条目树，由无序 / 有序两条语法共用。
//
// 支持三种真实写法（旧实现只认第一种，后两种会整段掉成普通段落）：
//   1. 平铺项：      `- a` / `- b`
//   2. 项内续行：    `- 正文` + 缩进更深的普通行（同一项内换行，`<br>` 连接）
//   3. 嵌套子列表：  `- 正文` + 缩进更深的列表项（交给 ctx.block 递归渲染）
//
// 只消费「首项缩进相等」的那些行；遇到更浅或顶格的其它内容就收手——不猜 lazy
// continuation（顶格续行），否则列表会把后面整段正文吞进来。
import type { BlockCtx } from './types.js';

/** 一条列表项：复选框标记（可见性由调用方决定）、正文行、子块行、序号。 */
export interface ListItem {
  /** 任务列表的 `[ ]` / `[x]` 原文（没有则为空串）。 */
  box: string;
  /** 项内正文行（续行已去掉缩进）。 */
  body: string[];
  /** 缩进更深的子块行（原样保留缩进，供递归解析）。 */
  sub: string[];
  /** 有序列表的序号（无序列表恒为 0）。 */
  num: number;
}

/** 一行匹配结果的形状（各语法自己的正则负责填）。 */
export interface ListLineMatch {
  indent: number;
  num: number;
  box: string;
  body: string;
}

/** 把一行解析成 ListLineMatch，不是列表项则 null。 */
export type ListLineParser = (line: string) => ListLineMatch | null;

/** 当前行缩进（tab 按 1 个字符算，与正则口径一致）。 */
export function indentOf(line: string): number {
  return (/^[ \t]*/.exec(line)?.[0] ?? '').length;
}

/**
 * 解析从 `i` 开始的一圈列表项。
 *
 * @param baseIndent 首项缩进；只有同缩进的项才算「同一圈」的新项
 */
export function collectListItems(
  lines: string[],
  i: number,
  parse: ListLineParser,
  baseIndent: number,
): { items: ListItem[]; next: number } {
  const items: ListItem[] = [];
  let j = i;
  while (j < lines.length) {
    const line = lines[j] ?? '';
    const hit = parse(line);
    if (hit && hit.indent === baseIndent) {
      items.push({ box: hit.box, body: [hit.body], sub: [], num: hit.num });
      j += 1;
      continue;
    }
    const cur = items[items.length - 1];
    if (!cur || !line.trim() || indentOf(line) <= baseIndent) break;
    // 缩进更深的列表项 → 子列表；普通行 → 当前项的续行
    if (hit) cur.sub.push(line);
    else cur.body.push(line.trim());
    j += 1;
  }
  return { items, next: j };
}

/**
 * 把条目数组包成 `<ul>` / `<ol>`。
 *
 * `liParts` 返回 `{ attr, body }`：`attr` 是 `<li` 之后的属性串（含前导空格），
 * `body` 是 `<li …>` 与 `</li>` 之间的内容。它拿到正文已行内渲染的串与子块 HTML。
 *
 * 有序列表首项序号 > 1 时输出 `start` 属性（CommonMark 语义）。
 */
export function wrapList(
  items: ListItem[],
  tag: 'ul' | 'ol',
  ctx: BlockCtx,
  liParts: (item: ListItem, inner: string, subHtml: string, index: number) => {
    attr: string;
    body: string;
  },
): string {
  const lis = items.map((it, k) => {
    const inner = it.body.map((l) => ctx.inline(l)).join('<br>');
    const sub = it.sub.length ? ctx.block(it.sub) : '';
    const parts = liParts(it, inner, sub, k);
    return `<li${parts.attr}>${parts.body}</li>`;
  });
  const start = items[0]?.num ?? 1;
  const open = tag === 'ol' && start > 1 ? `<ol start="${start}">` : `<${tag}>`;
  return `${open}${lis.join('')}</${tag}>`;
}
