// 语法注册表：**全仓唯一**的「有哪些语法、按什么顺序」清单。
//
// 新增一个语法 = 在 model/ 下加一个目录（导出一条 BlockRule / InlineRule）+ 在这里
// 追加一行 import 与数组项。md-render 只遍历 BLOCK_RULES / 套用 INLINE_RULES，
// 不认识具体语法——这就是「一语法一文件夹 + 集中注册」的挂载点。
//
// 优先级（小者先试）复刻了原渲染器 if 分支的先后：代码块 → 公式块 → 表格 →
// 图片 → 引用 → 标题 → 有序 → 无序 → 分隔线；行内顺序见 INLINE_RULES。
import type { BlockRule, InlineRule } from './types.js';

import { codeBlockSyntax } from './code/index.js';
import { mathBlockSyntax, mathInlineRule } from './math/index.js';
import { tableSyntax } from './table/index.js';
import { imageSyntax } from './image/index.js';
import { quoteSyntax } from './quote/index.js';
import { headingSyntax } from './heading/index.js';
import { orderedListSyntax } from './ordered-list/index.js';
import { unorderedListSyntax } from './unordered-list/index.js';
import { dividerSyntax } from './divider/index.js';
import { emphasisInlineRule } from './emphasis/index.js';

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
    unorderedListSyntax,
    dividerSyntax,
  ].sort((a, b) => a.priority - b.priority),
);

/**
 * 行内语法，按**套用顺序**排列（顺序敏感）。
 * 强调（斜体/删除线）先于公式：公式内容里的 `*` 不该被当强调，但公式规则会
 * 跳过已生成的标签内部，二者互不重叠。
 */
export const INLINE_RULES: readonly InlineRule[] = Object.freeze([
  emphasisInlineRule,
  mathInlineRule,
]);

export type { BlockRule, InlineRule } from './types.js';
