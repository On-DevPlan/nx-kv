// PM 内核 M1 schema：单一实时文档的节点/标记定义（任务链 #271→#274，方案见
// 《md 编辑器换内核：ProseMirror 迁移路线设计》）。
//
// M1 范围（刻意最小）：
//   - block：paragraph / heading(1-6) / rawBlock（**兜底容器**，见下）
//   - inline：text / hardBreak（段落软换行，对应块内 `<br>` 口径）
//   - marks：strong(`**`) / em(`*`) / strike(`~~`) / code(反引号) / highlight(`==`)
//            / link{href,kind}（外链 / 附件 fileId / nxkv 内链，同 mark 不同 kind）
// 其余语法（列表/引用/代码块/表格/公式/脚注/双链/图片/分隔线）在 M1 全部走
// rawBlock 兜底：原文逐字保存、逐字序列化——**从第一天起 round-trip 无损**，
// M2 起逐个语法把 rawBlock 升级成真节点（每语法带 golden）。
//
// toDOM 有意复用阅读态渲染器的标签约定（b/em/del/code/mark/a），让现有
// .mdw-* 样式能大部分直接套上；pm.css 只补布局与兜底块观感。
import { Schema } from 'prosemirror-model';
import type { DOMOutputSpec, Node as PMNode } from 'prosemirror-model';

/** rawBlock 的 syntax 标签全集（M2 逐个消灭；M1 仅作兜底分类与样式钩子）。 */
export type RawSyntax =
  | 'list'
  | 'quote'
  | 'codeblock'
  | 'table'
  | 'math'
  | 'image'
  | 'divider'
  | 'footnote'
  | 'linkref'
  | 'unknown';

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6];

/** rawBlock → 阅读态样式的过渡映射（pre 系代码观感；M2 逐语法替换成真节点）。 */
function rawToDOM(node: PMNode): DOMOutputSpec {
  const syntax = String(node.attrs.syntax ?? 'unknown');
  return ['pre', { 'data-raw': syntax, class: `mdw-raw mdw-raw-${syntax}` }, 0];
}

export function createMdSchema(): Schema {
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: {
        group: 'block',
        content: 'inline*',
        parseDOM: [{ tag: 'p' }],
        toDOM: () => ['p', 0] as DOMOutputSpec,
      },
      heading: {
        group: 'block',
        content: 'inline*',
        defining: true,
        attrs: { level: { default: 1 } },
        parseDOM: HEADING_LEVELS.map((level) => ({
          tag: `h${level}`,
          getAttrs: () => ({ level }),
        })),
        toDOM: (node) => [`h${node.attrs.level as number}`, 0] as DOMOutputSpec,
      },
      // 兜底块：原文逐字保真（code:true 让视图按 pre 语义保留空白与换行）。
      // M2 的每一步都是「某个 syntax 值从这棵兜底里搬出去、长成真节点」。
      rawBlock: {
        group: 'block',
        content: 'text*',
        code: true,
        defining: true,
        attrs: { syntax: { default: 'unknown' } },
        parseDOM: [
          {
            tag: 'pre[data-raw]',
            getAttrs: (el) => ({ syntax: (el as HTMLElement).getAttribute('data-raw') || 'unknown' }),
          },
        ],
        toDOM: rawToDOM,
      },
      text: { group: 'inline' },
      hardBreak: {
        group: 'inline',
        inline: true,
        selectable: false,
        parseDOM: [{ tag: 'br' }],
        toDOM: () => ['br'] as DOMOutputSpec,
      },
    },
    marks: {
      // 渲染器口径：`**x**` → `<b>`（md-render inline 主链）
      strong: {
        parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
        toDOM: () => ['b', 0] as DOMOutputSpec,
      },
      em: {
        parseDOM: [{ tag: 'em' }, { tag: 'i' }],
        toDOM: () => ['em', 0] as DOMOutputSpec,
      },
      strike: {
        parseDOM: [{ tag: 's' }, { tag: 'del' }],
        toDOM: () => ['del', 0] as DOMOutputSpec,
      },
      code: {
        parseDOM: [{ tag: 'code' }],
        toDOM: () => ['code', 0] as DOMOutputSpec,
      },
      highlight: {
        parseDOM: [{ tag: 'mark' }],
        toDOM: () => ['mark', 0] as DOMOutputSpec,
      },
      // kind：ext（http 外链）/ attach（32hex fileId 附件）/ nxkv（内部资源）。
      // 序列化时三种都还原成 `[text](href)`，与行内渲染器的三类替换一一对应。
      link: {
        inclusive: false,
        attrs: { href: {}, kind: { default: 'ext' } },
        parseDOM: [
          {
            tag: 'a[href]',
            getAttrs: (el) => {
              const a = el as HTMLAnchorElement;
              const href = a.getAttribute('href') || '';
              const kind = a.dataset.kind === 'attach' || a.dataset.kind === 'nxkv' ? a.dataset.kind : 'ext';
              return { href, kind };
            },
          },
        ],
        toDOM: (node) => [
          'a',
          { href: node.attrs.href as string, 'data-kind': node.attrs.kind as string, target: '_blank', rel: 'noopener noreferrer' },
          0,
        ] as DOMOutputSpec,
      },
    },
  });
}

/** 模块级共享 schema（无状态、纯定义；多实例编辑器共用一份）。 */
export const mdSchema: Schema = createMdSchema();

/**
 * schema 按 string 索引的节点/标记在 strict 下全部 possibly-undefined——
 * 统一走这里取（缺失即抛，属于 schema 定义错误而非运行态分支）。
 */
export function mdNode(schema: Schema, name: string): NonNullable<Schema['nodes'][string]> {
  const node = schema.nodes[name];
  if (!node) throw new Error(`md/pm schema 缺节点：${name}`);
  return node;
}

export function mdMark(schema: Schema, name: string): NonNullable<Schema['marks'][string]> {
  const mark = schema.marks[name];
  if (!mark) throw new Error(`md/pm schema 缺标记：${name}`);
  return mark;
}
