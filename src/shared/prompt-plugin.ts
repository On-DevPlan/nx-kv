// 提示词插件契约（唯一基准方案：docs/research/prompt-plugin-single-route.md §1/§7）。
//
// 纯类型 + 纯函数，Node 与浏览器同一份（shared 零依赖红线——zod 进不了这里；
// 插件侧的 zod schema 在 modules/promptplug/base.ts，经 schema-bridge 折算成
// 本文件声明的 PluginSchema 纯数据后再上注册面）。
//
// 五条铁律里的三条落在本层：
//   - 一个插件 = 一段输出 = 链内一个 order 位 = 一组写回键（assertPluginList 强制）；
//   - 顺序只存在类声明（order 字段；#152 起不再落库、不再有顺序数组）；
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

/** 单条内置模板（#152：正文进插件类，不再有 JSON 注册表 / DB seed）。 */
export interface TemplateText {
  id: string;
  name: string;
  text: string;
}

/** 注册面：注册表 / compose / uiDescriptor 只认这一层。 */
export interface AnyPromptPlugin {
  readonly id: string;
  readonly order: number;
  /** 触发时机 = 链名（#152）：get / check / done */
  readonly group: string;
  /** 类 XML 输出标签（'nx-kv.context' 等）；compose 按它包裹段落 */
  readonly tag: string;
  readonly label: string;
  /** 内置模板列表（至少一条，第一条 = 出厂默认） */
  readonly templates: readonly TemplateText[];
  /** 写回的 ctx 顶层段（[] = 只读段）；不变量：writes ⊆ schema 顶层段 */
  readonly writes: readonly string[];
  readonly schema: PluginSchema<unknown>;
  /** 唯一出口：无参 = 文本态（模板原文）；'data' = 结构态（数据对象） */
  get(): string;
  get(as: 'data'): Promise<unknown>;
}

/**
 * 启动期校验（唯一一道）：每条断言挡掉一个真实事故。
 * #152 起顺序只在**链内**要求唯一（跨组同号无意义），链内顺序由 order 决定。
 */
export function assertPluginList(list: readonly AnyPromptPlugin[]): void {
  const ids = new Set<string>();
  const orders = new Set<string>();
  const keys = new Map<string, string>();
  for (const p of list) {
    if (ids.has(p.id)) throw new Error(`插件 id 重复：${p.id}`);
    if (!p.group) throw new Error(`${p.id}: 必须声明 group（get / check / done）`);
    if (!Number.isInteger(p.order) || p.order <= 0) throw new Error(`${p.id}: order 必须是正整数`);
    const slot = `${p.group}#${p.order}`;
    if (orders.has(slot)) throw new Error(`order 冲突：${p.id} 与同链插件在 ${p.group} 链上都是 ${p.order}`);
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
    orders.add(slot);
  }
}

/** 链内顺序：按 order 升序（顺序不再落库，#152 起由类声明决定）。 */
export function chainOf(plugins: readonly AnyPromptPlugin[], group: string): AnyPromptPlugin[] {
  return plugins.filter((p) => p.group === group).sort((a, b) => a.order - b.order);
}

/** UI 描述符（三端同源：CLI / HTTP / 设置页都消费它）。 */
export interface PluginUIDescriptor {
  id: string;
  /** 触发时机（get / check / done）——UI 按它分组展示 */
  group: string;
  /** 链内顺序（类声明的 order；不是存储值） */
  order: number;
  tag: string;
  label: string;
  /** 文本态 → 当前生效模板正文（#152 起 = 类里 templates[0]） */
  template: string;
  /** 该插件的全部内置模板（#152：正文进代码，UI 只读展示） */
  templates: readonly TemplateText[];
  /** 插入变量目录 */
  fields: readonly FieldDecl[];
  /** 参数表单只为这些段生成控件 */
  writableKeys: readonly string[];
}

/** 声明是 UI 的唯一数据源：不写第二份字段目录 / 不读顺序数组。 */
export function uiDescriptor(plugins: readonly AnyPromptPlugin[]): PluginUIDescriptor[] {
  assertPluginList(plugins);
  return [...plugins]
    .sort((a, b) => (a.group === b.group ? a.order - b.order : a.group.localeCompare(b.group)))
    .map((p) => ({
      id: p.id,
      group: p.group,
      order: p.order,
      tag: p.tag,
      label: p.label,
      template: p.get(),
      templates: p.templates,
      fields: p.schema.fields,
      writableKeys: p.writes,
    }));
}

/**
 * 模板变量白名单（写路径校验，方案 §4.2 第 3 道）：
 * 点路径 `{{x.y}}` 必须在字段目录里**全路径**声明过（拦拼错的段名 / 字段名）；
 * 例外是 `params` 段——外部参数键是动态的，整段放行；裸 `{{k}}`（平铺参数 / 段名直取）放行。
 *
 * `{{#each X}}` 块内是列表元素的相对域（`{{file.localPath}}` = 元素的 file 子对象），
 * 不在声明粒度内——放行 each 块内部，但 each 的**目标路径**（X）必须已声明。
 * helper 调用里的路径 token 同样受检（`{{percent goal.elapsedSec goal.durationSec}}`）。
 * 返回未声明变量列表（空 = 合法）。
 */
export function undeclaredTemplateVars(
  template: string,
  allowedSegments: readonly string[],
  fieldKeys: readonly string[],
): string[] {
  const dynamicSegments = new Set<string>(allowedSegments.filter((s) => s === 'params'));
  const fields = new Set(fieldKeys);
  const bad = new Set<string>();
  const check = (text: string): void => {
    for (const block of text.match(/\{\{[^}]*\}\}/g) || []) {
      for (const m of block.matchAll(/\b[A-Za-z_$][\w$]*\.[\w$]+\b/g)) {
        const path = m[0];
        if (fields.has(path)) continue;
        const seg = path.split('.')[0]!;
        if (dynamicSegments.has(seg)) continue;
        bad.add(path);
      }
    }
  };
  // 1. each 目标必须已声明
  for (const m of String(template || '').matchAll(/\{\{#each\s+([A-Za-z_$][\w$.]*)\s*\}\}/g)) {
    const target = m[1]!;
    if (!fields.has(target) && !dynamicSegments.has(target)) bad.add(target);
  }
  // 2. 剥掉 each 块（迭代剥最内层；each 不嵌套是现状模板的形态）后校验其余路径
  let rest = String(template || '');
  for (;;) {
    const next = rest.replace(/\{\{#each[^}]*\}\}[\s\S]*?\{\{\/each\}\}/g, '');
    if (next === rest) break;
    rest = next;
  }
  check(rest);
  return [...bad];
}
