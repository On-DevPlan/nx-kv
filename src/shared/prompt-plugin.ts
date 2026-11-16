// 提示词插件契约（唯一基准方案：docs/research/prompt-plugin-single-route.md §1/§7）。
//
// 纯类型 + 纯函数，Node 与浏览器同一份（shared 零依赖红线——zod 进不了这里；
// 插件侧的 zod schema 在 modules/promptplug/base.ts，经 schema-bridge 折算成
// 本文件声明的 PluginSchema 纯数据后再上注册面）。
//
// 五条铁律里的三条落在本层：
//   - 一个插件 = 一段输出 = 一个 order 位 = 一组写回键（assertPluginList 强制）；
//   - 顺序只存在数组（assertOrder / resolveOrderIds 强制）；
//   - 声明是 UI 的唯一数据源（uiDescriptor 从 schema 派生，不写第二份）。

/** 字段种类（UI 控件映射的 kind，见方案 §7）。 */
export type FieldKind = 'string' | 'text' | 'number' | 'boolean' | 'enum' | 'list';

/** 单个模板变量的声明：key 是完整 ctx 路径（'task.id' / 'attach.count'）。 */
export interface FieldDecl {
  key: string;
  kind: FieldKind;
  label: string;
  desc?: string;
  enumValues?: readonly string[];
}

/**
 * 插件 schema（注册面形态，纯数据）。不再由插件作者手写——由
 * modules/promptplug/schema-bridge.ts 从 zod shape 派生（见方案 §1.4）。
 */
export interface PluginSchema<TData = unknown> {
  /** 本段模板可见的变量全集：模板变量白名单、UI「插入变量」目录都来自这里 */
  fields: readonly FieldDecl[];
  /** 未取数时的占位（UI 初值，零 I/O）；派生不出时为 null */
  blank: TData;
}

/** 注册面：注册表 / compose / uiDescriptor 只认这一层。 */
export interface AnyPromptPlugin {
  readonly id: string;
  readonly order: number;
  /** 类 XML 输出标签（'nx-kv.context' 等）；compose 按它包裹段落 */
  readonly tag: string;
  readonly label: string;
  /** 写回的 ctx 顶层段（[] = 只读段）；不变量：writes ⊆ schema 顶层段 */
  readonly writes: readonly string[];
  readonly schema: PluginSchema<unknown>;
  /** 唯一出口：无参 = 文本态（模板原文）；'data' = 结构态（数据对象） */
  get(): string;
  get(as: 'data'): Promise<unknown>;
}

/** 启动期校验（唯一一道）：四条断言各自挡掉一个真实事故。 */
export function assertPluginList(list: readonly AnyPromptPlugin[]): void {
  const ids = new Set<string>();
  const orders = new Set<number>();
  const keys = new Map<string, string>();
  for (const p of list) {
    if (ids.has(p.id)) throw new Error(`插件 id 重复：${p.id}`);
    if (!Number.isInteger(p.order) || p.order <= 0) throw new Error(`${p.id}: order 必须是正整数`);
    if (orders.has(p.order)) throw new Error(`order 冲突：${p.id} 与 ${[...orders].join(',')}`);
    if (!String(p.get() ?? '').trim()) throw new Error(`${p.id}: 模板不能为空（空模板 = 该段永不输出，属配置错误）`);
    if (!p.tag || !/^[A-Za-z][\w.-]*$/.test(p.tag)) throw new Error(`${p.id}: tag 非法：${p.tag}`);
    const own = new Set(p.schema.fields.map((f) => f.key.split('.')[0]!));
    for (const w of p.writes) {
      if (!own.has(w)) throw new Error(`${p.id}: writes 含未在 schema 声明的段 ${w}`);
      const holder = keys.get(w);
      if (holder) throw new Error(`ctx 段 ${w} 被 ${holder} 与 ${p.id} 同时写回`);
      keys.set(w, p.id);
    }
    ids.add(p.id);
    orders.add(p.order);
  }
}

/** 顺序数组不变量：恰好包含全部插件 id 各一次、无未知 id。 */
export function assertOrder(plugins: readonly AnyPromptPlugin[], orderIds: readonly string[]): void {
  const all = new Set(plugins.map((p) => p.id));
  const seen = new Set<string>();
  for (const id of orderIds) {
    if (!all.has(id)) throw new Error(`顺序数组含未知插件：${id}`);
    if (seen.has(id)) throw new Error(`顺序数组重复：${id}`);
    seen.add(id);
  }
  if (seen.size !== all.size) {
    const missing = [...all].filter((id) => !seen.has(id)).join(',');
    throw new Error(`顺序数组缺插件：${missing}`);
  }
}

/**
 * 解析生效顺序：stored 数组合法 → 用它（唯一真相）；不合法 / 缺失 →
 * 按各插件 order 播种默认位（这条路径只在数组不存在或被写坏时走一次）。
 */
export function resolveOrderIds(plugins: readonly AnyPromptPlugin[], stored?: unknown): string[] {
  if (Array.isArray(stored)) {
    const ids = stored.map((v) => String(v));
    try {
      assertOrder(plugins, ids);
      return ids;
    } catch {
      /* 落到播种默认位（加载期单点修复，运行期仍是直线） */
    }
  }
  return [...plugins].sort((a, b) => a.order - b.order).map((p) => p.id);
}

/** UI 描述符（三端同源：CLI / HTTP / 设置页都消费它）。 */
export interface PluginUIDescriptor {
  id: string;
  /** 数组下标 × 10（运行期 order 不是存储值） */
  order: number;
  tag: string;
  label: string;
  /** 文本态 → 模板编辑区初值 */
  template: string;
  /** 插入变量目录 */
  fields: readonly FieldDecl[];
  /** 参数表单只为这些段生成控件 */
  writableKeys: readonly string[];
}

/** 声明是 UI 的唯一数据源：不写第二份字段目录。 */
export function uiDescriptor(plugins: readonly AnyPromptPlugin[], orderIds: readonly string[]): PluginUIDescriptor[] {
  assertPluginList(plugins);
  const ids = resolveOrderIds(plugins, orderIds);
  const byId = new Map(plugins.map((p) => [p.id, p] as const));
  return ids.map((id, i) => {
    const p = byId.get(id)!;
    return {
      id: p.id,
      order: (i + 1) * 10,
      tag: p.tag,
      label: p.label,
      template: p.get(),
      fields: p.schema.fields,
      writableKeys: p.writes,
    };
  });
}
