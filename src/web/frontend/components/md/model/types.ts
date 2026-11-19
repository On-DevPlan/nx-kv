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

/**
 * 文档级定义表（脚注正文、引用式链接目标）。
 *
 * 这两类语法的定义行（`[^1]: 说明` / `[标签]: https://…`）**不就地渲染**，而是被
 * 抽走登记在这里，由引用点（`[^1]` / `[文字][标签]`）查表——所以需要一次全文扫描，
 * 单独一层 DocRule（见下），不能塞进逐行的 BlockRule。
 */
export interface DocCtx {
  /** 脚注：标签 → 正文（多行按 `\n` 存）。 */
  footnotes: Map<string, string[]>;
  /** 引用式链接：标签（小写归一） → 目标 URL。 */
  refLinks: Map<string, string>;
  /** HTML 转义（collect 里生成提示串时用）。 */
  esc: (value: unknown) => string;
}

/**
 * 文档级预处理规则：**抽取定义行**，把可查表登记进 DocCtx，返回剩下的行。
 *
 * 与 BlockRule 的区别：它不产出 HTML，只做「把定义从正文里拿走并记账」。
 * 顺序敏感（先注册的先扫描），因此脚注与链接定义互不干扰即可。
 */
export interface DocRule {
  id: string;
  collect: (lines: string[], ctx: DocCtx) => string[];
}

/** 规则渲染时可用的上下文（由 md-render 构造一次，逐个规则传入）。 */
export interface BlockCtx {
  /**
   * 子块渲染（列表嵌套、引用内的块级内容）：把一段行交给完整渲染流程。
   * 传入的行已经是「去掉外层前缀」的干净行，递归不会回到同一处。
   */
  block: (lines: string[]) => string;
  /** 文档级定义表（脚注 / 引用式链接）。 */
  doc: DocCtx;
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

/** 行内预处理的环境（还没转义，只有定义表可查）。 */
export interface InlineEnv {
  footnotes: Map<string, string[]>;
  refLinks: Map<string, string>;
}

/**
 * 行内**预处理**规则：吃原始文本、吐原始文本（或占位符），在 HTML 转义之前跑。
 *
 * 为什么需要这一层：转义（反斜杠转义、脚注引用标记、引用式链接）必须在 `esc()`
 * 之前改写原文；一旦 `*` 被转成 `&ast;` 或标签已生成，就再也改不动了。
 * 需要产出 HTML 的规则（尖括号自动链接）不走这里——它在转义之后按实体匹配。
 */
export type InlinePreRule = (text: string, env: InlineEnv) => string;
