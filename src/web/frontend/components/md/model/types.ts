// md 语法模型层的公共类型（components/md/model 的契约）。
//
// 设计目标：**一个语法 = 一个目录**（model/<syntax>/index.ts），每个目录导出一条
// 可注册的规则；registry.ts 汇总成有序表，md-render 只做「遍历规则 → 拼 HTML」。
// 新增语法 = 加一个目录 + 在 registry 注册一次，不改渲染主流程（参见参考仓库
// milkdown 的 $nodeSchema 注册表 / blocknote 的 BlockSpec 注册表，取其「声明式
// 描述 + 集中注册」的骨架，但不引入其 ProseMirror 依赖）。
//
// 规则是**纯函数**：不碰 DOM、不持状态；渲染器把行数组与上下文传进来，规则返回
// 一段 HTML 与「消费到第几行」，多行语法（表格 / 公式块 / 代码块 / 列表）因此能
// 在不依赖跨行状态机的前提下表达。

/** 规则渲染时可用的上下文（由 md-render 构造一次，逐个规则传入）。 */
export interface BlockCtx {
  /** 行内渲染（链接 / 双链 / 附件 / 强调 / 行内公式；规则内对单元格/标题文本复用）。 */
  inline: (text: string) => string;
  /** HTML 转义（& < > " '）。 */
  esc: (value: unknown) => string;
  /** 标题锚点 id 分配（同文同名自动去重；只用标题规则需要）。 */
  headingId: (text: string, used: Set<string>) => string;
  /** 图片名 → URL 映射（v1 草稿的 name→dataURL 兜底；图片规则用）。 */
  imgMap: Record<string, string>;
  /** 已分配的标题 id 集合（渲染级共享，保证同文内不撞）。 */
  usedIds: Set<string>;
}

/** 一条块级规则的匹配结果：`html` 是产出，`next` 是下一条待处理行（含）。 */
export interface BlockMatch {
  html: string;
  next: number;
}

/** 块级语法规则：match 命中即整段接管，返回消费到第几行。 */
export interface BlockRule {
  /** 稳定 id（调试 / 注册表去重用）。 */
  id: string;
  /** 匹配优先级（小者先试）；等价于旧渲染器里 if 分支的先后顺序。 */
  priority: number;
  match: (lines: string[], i: number, ctx: BlockCtx) => BlockMatch | null;
}

/** 行内语法规则：输入是**已转义**的 HTML 串，返回替换后的串（链式套用）。 */
export type InlineRule = (html: string) => string;
