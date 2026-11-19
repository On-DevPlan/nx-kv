// 语法注册表：**全仓唯一**的「有哪些语法、按什么顺序」清单。
//
// 新增一个语法 = 在 model/ 下加一个目录（导出 BlockRule / InlineRule / DocRule /
// InlinePreRule）+ 在这里追加一行 import 与数组项。md-render 只按表遍历，
// 不认识具体语法——这就是「一语法一文件夹 + 集中注册」的挂载点。
//
// 四张表对应渲染流水线的四个阶段（先手写定义、再改原文、再生成 HTML、最后套行内）：
//   DOC_RULES        抽走定义行（脚注 / 引用式链接），登记查表
//   INLINE_PRE_RULES 改**原始文本**（转义、脚注标记、引用式链接展开）
//   BLOCK_RULES      逐行块级匹配，priority 小者先试
//   INLINE_RULES     作用在**已转义 HTML** 上（强调 / 高亮 / 公式 / 尖括号链接）
//
// 块级优先级复刻原渲染器 if 分支的先后：代码块 → 公式块 → 表格 → 图片 → 引用 →
// 标题 → 有序 → 分隔线 → 无序。分隔线必须早于无序列表：`* * *` 两者都像。
import type { BlockRule, DocRule, InlinePreRule, InlineRule } from './types.js';

import { codeBlockSyntax } from './code/index.js';
import { mathBlockSyntax, mathInlineRule } from './math/index.js';
import { tableSyntax } from './table/index.js';
import { imageSyntax } from './image/index.js';
import { quoteSyntax } from './quote/index.js';
import { headingSyntax } from './heading/index.js';
import { orderedListSyntax } from './ordered-list/index.js';
import { dividerSyntax } from './divider/index.js';
import { unorderedListSyntax } from './unordered-list/index.js';
import { emphasisInlineRule } from './emphasis/index.js';
import { highlightInlineRule } from './highlight/index.js';
import { angleAutolinkInlineRule } from './autolink-angle/index.js';
import { footnoteDocRule, footnotePreRule } from './footnote/index.js';
import { linkRefDocRule, linkRefPreRule } from './link-ref/index.js';
import { escapePreRule } from './escape/index.js';

/** 文档级预处理（抽定义行），按注册顺序执行。 */
export const DOC_RULES: readonly DocRule[] = Object.freeze([footnoteDocRule, linkRefDocRule]);

/**
 * 行内预处理（原始文本 → 原始文本），按注册顺序执行。
 * 转义排最前：被 `\` 保护起来的字符不该再被脚注/链接规则认领。
 */
export const INLINE_PRE_RULES: readonly InlinePreRule[] = Object.freeze([
  escapePreRule,
  footnotePreRule,
  linkRefPreRule,
]);

/** 全部块级语法，按优先级升序（渲染器按此顺序尝试匹配）。 */
export const BLOCK_RULES: readonly BlockRule[] = Object.freeze(
  [
    codeBlockSyntax,
    mathBlockSyntax,
    tableSyntax,
    imageSyntax,
    quoteSyntax,
    headingSyntax,
    orderedListSyntax,
    dividerSyntax,
    unorderedListSyntax,
  ].sort((a, b) => a.priority - b.priority),
);

/**
 * 行内语法，按**套用顺序**排列（顺序敏感）。
 * 强调（斜体/删除线）先于公式：公式内容里的 `*` 不该被当强调，但公式规则会
 * 跳过已生成的标签内部，二者互不重叠。尖括号链接最后——它匹配的是转义后的
 * `&lt;…&gt;` 实体，前面几步不该再碰它。
 */
export const INLINE_RULES: readonly InlineRule[] = Object.freeze([
  emphasisInlineRule,
  highlightInlineRule,
  mathInlineRule,
  angleAutolinkInlineRule,
]);

export type { BlockRule, DocRule, InlinePreRule, InlineRule } from './types.js';
