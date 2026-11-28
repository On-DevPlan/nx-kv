// nx-kv 内部插件 SDK：server 半侧契约。
//
// 插件包只依赖本包与 Node 内置能力；宿主不 import 插件包内部，插件也不 import 宿主 src。
// v1 是进程内可信插件；API 版本先固定 '^1'，后续 worker/sidecar 用同一份契约。

export const PLUGIN_API = '^1';

/** 插件可用的最小 DB 形状（宿主把它包在 single-writer 事务里传进来）。 */
export interface PluginDb {
  path?: string;
  readOnly?: boolean;
  exec(sql: string): void;
  get(sql: string, params?: unknown): any;
  all(sql: string, params?: unknown): any[];
  run(sql: string, params?: unknown): { changes?: number | bigint; lastInsertRowid?: number | bigint };
  scalar?(sql: string, params?: unknown): any;
}

export type TopicKind = 'repo' | 'group' | 'unknown';

/** 当前 topic 的完整定位；插件缺东西时可用 host.get('/api/plugins/context') 再取。 */
export interface PluginTopicInfo {
  key: string;
  name: string;
  kind: TopicKind;
  cwd: string;
  repoKey: string;
  groupKey: string;
  repoName?: string;
  groupName?: string;
  /** 仓库本机根目录（repo topic 或 group topic 的成员 repo） */
  repoRoot?: string;
}

export interface PluginLocation {
  dirKey?: string;
  groupId?: string;
  board?: string;
  project?: string;
  taskId?: string;
}

/** /api/plugins/context 里的仓库行。 */
export interface PluginRepoView {
  key: string;
  type: string;
  name: string;
  path: string;
  description: string;
}

/** /api/plugins/context 的返回：topic + 当前 repo/group + 组内 repo 列表。 */
export interface PluginContextView {
  topic: PluginTopicInfo;
  repo: PluginRepoView | null;
  group: PluginRepoView | null;
  repos: PluginRepoView[];
}

/** /api/plugins/tree 的目录项。 */
export interface PluginTreeEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
}

/** /api/plugins/tree 的返回。 */
export interface PluginTreeView {
  repoKey: string;
  repoName: string;
  repoRoot: string;
  path: string;
  entries: PluginTreeEntry[];
  truncated: boolean;
}

/** /api/plugins/file 的返回（二进制不给正文）。 */
export interface PluginFileView {
  repoKey: string;
  path: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  content: string;
}

/** 插件看到的宿主上下文：只给任务/主题定位，不给宿主内部对象。 */
export interface PretaskContext {
  topicKey?: string;
  groupKey?: string;
  repoKey?: string;
  cwd?: string;
  dirKey?: string;
  groupId?: string;
  board?: string;
  project?: string;
  /** 宿主解析后的完整 topic（前端可传，宿主会按 DB 补全） */
  topic?: PluginTopicInfo | null;
  /** 组/看板/项目等定位（前端上下文透传） */
  location?: PluginLocation;
}

export interface SlotDecl {
  key: string;
  label: string;
  type: 'text';
  required?: boolean;
  hint?: string;
  default?: string;
}

export interface PretaskDraft {
  body: string;
  title?: string;
}

/**
 * 插件候选条目（标准数据接口）：给面板列表 / 未来正文内搜索与引用用。
 *
 * 约定：id 由插件保证稳定（推荐带业务前缀，如 `skill:<绝对路径>`）；
 * `text` 是搜索文本（名称 + 描述 + 路径），`path` 是可加载/引用的物理位置。
 * 宿主只做聚合、去重、关键字过滤与上限保护，不认识具体业务。
 */
export interface PluginCandidate {
  /** 插件内稳定 id（跨会话不变；面板选择与正文引用都用它） */
  id: string;
  /** 展示名（列表行 / 引用 chip） */
  label: string;
  description?: string;
  /** 业务类别（如 'skill' / 'template'） */
  kind?: string;
  /** 可加载/引用的物理位置（如 SKILL.md 绝对路径） */
  path?: string;
  /** 搜索文本（名称 + 描述 + 路径 + 关键词） */
  text?: string;
  /** 结构化附加数据（插件自定义；宿主原样透出） */
  meta?: Record<string, unknown>;
}

export interface EntryView {
  /** `${pluginId}:${localId}`，全局唯一、稳定。 */
  id: string;
  pluginId: string;
  label: string;
  description?: string;
  icon?: string;
  kind: 'draft' | 'panel';
  order: number;
  default?: boolean;
  builtin?: boolean;
  /** kind=draft：模板槽位与原始正文。 */
  slots?: SlotDecl[];
  previewBody?: string;
  values?: Record<string, string>;
  /** 插件 client bundle 注册的 UI 组件 key。 */
  ui?: { row?: string; form?: string; panel?: string };
  /** kind=panel 的兜底元信息。 */
  panel?: { title?: string };
}

export interface PluginContext extends PretaskContext {
  storage: PluginDb;
  storageVersion: number;
  log: (level: string, msg: string) => void;
  /** 宿主暂存的旧数据（如 v18 templates）；插件成功导入后宿主会删除。 */
  legacy: {
    take(kind: string): Promise<unknown | null>;
  };
}

/** 一条具体任务的最小定位（gettask 的 data() 与 dock 页面共用）。 */
export interface PluginTaskInfo {
  /** 真实任务号（plan 草稿也有实体行）。 */
  id: number;
  /** 任务键：兼容字段；Web 恒为真实任务号（"9"）。 */
  key?: string;
  text: string;
  topicKey?: string;
  cwd?: string;
  boardKey?: string;
  projectKey?: string;
  status?: string;
}

/** 插件可写进模板的变量声明（最终与 seed 的 task/cwd/... 合并成可见变量域）。 */
export interface PluginGetTaskField {
  /** 完整路径（'notes' / 'notes[].text' / 'meta.level'）；模板按此引用 */
  key: string;
  /** UI 控件种类；缺省 string */
  kind?: 'string' | 'text' | 'number' | 'boolean' | 'enum' | 'list';
  label: string;
  desc?: string;
  enumValues?: readonly string[];
}

/** gettask 区块在任务编辑页底部抽屉的挂载点（client bundle 注册的组件 key）。 */
export interface PluginGetTaskUi {
  panel: string;
  title?: string;
  /** 覆盖插件级 icon（宿主图标集名字）；缺省用插件声明的 icon。 */
  icon?: string;
}

/** gettask 上下文：在插件常规上下文上带一条确定的任务。 */
export interface PluginGetTaskContext extends PluginContext {
  task: PluginTaskInfo;
}

/**
 * 任务创建事件（草稿提交成功后触发）。
 * @deprecated Web 已取消内存草稿：新建任务即真实实体，插件从第一刻就拿到 task.id，
 * 不需要再按草稿键暂存/迁移。宿主保留该钩子仅为兼容旧插件，新插件不要实现。
 */
export interface PluginTaskCreatedEvent {
  /** 草稿键（dock 里 ctx.location.taskId 的草稿值）；CLI 直接建任务时没有 */
  draftKey?: string;
  /** 刚创建的任务 */
  task: PluginTaskInfo;
}

/**
 * gettask 区块声明（第二生命周期点）。
 *
 * 一个条目 = 交付提示词里的一段 `nxkv.plugin.<pluginId>.<tag>` + 任务编辑页 dock 的一个 tab。
 * 模板（`template`）是出厂内置正文；用户在设置页可覆盖（存 prompt.tpl.<segment>）。
 * `data(taskCtx)` 返回该任务要渲染的数据；返回 null / undefined 表示本条任务不出这段。
 */
export interface PluginGetTaskEntry {
  /** 局部 id（宿主拼成 `<pluginId>:<localId>` 与段 id `plugin:<pluginId>:<localId>`）。 */
  id: string;
  label: string;
  description?: string;
  /** 区块标签后缀；缺省 = localId。最终 tag = nxkv.plugin.<pluginId>.<tag|localId>。 */
  tag?: string;
  order?: number;
  /** 出厂模板正文（Handlebars 子集，只能用 task 与 fields 声明的变量）。 */
  template: string;
  fields?: readonly PluginGetTaskField[];
  ui?: PluginGetTaskUi;
  /** 取这条任务要渲染的数据；宿主合并 seed 后交给模板。 */
  data(taskCtx: PluginGetTaskContext): Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
}

export interface NxkvPlugin {
  id: string;
  version: string;
  api: typeof PLUGIN_API | string;
  name: string;
  description?: string;
  /** 插件图标的资产名（宿主 svghub，如 folder / star / template）；侧栏、dock、状态栏共用。 */
  icon?: string;
  order: number;
  defaultEnabled: boolean;
  entries(ctx: PluginContext): Promise<EntryView[]> | EntryView[];
  buildDraft(ctx: PluginContext, entryId: string, values: Record<string, string>): Promise<PretaskDraft>;
  /**
   * 第二生命周期点 gettask：声明「任务编辑页 dock tab + 交付提示词区块」。
   * 声明与具体任务无关（ctx 可能为空）；按任务取数走条目的 `data(taskCtx)`。
   */
  gettask?(ctx: PluginContext): Promise<PluginGetTaskEntry[]> | PluginGetTaskEntry[];
  /**
   * 候选条目标准接口：面板列表 / 正文搜索与引用共用。
   * 宿主按插件启用状态聚合，`GET /api/plugins/candidates` 与 `plugin candidates` 对外。
   */
  candidates?(ctx: PluginContext): Promise<PluginCandidate[]> | PluginCandidate[];
  /**
   * @deprecated 新建任务即真实实体，不再有草稿键迁移。宿主保留调用点仅为兼容旧插件。
   */
  onTaskCreated?(ctx: PluginContext, event: PluginTaskCreatedEvent): void | Promise<void>;
  rpc?: Record<string, (ctx: PluginContext, params: any) => Promise<any>>;
  /** 插件自己的表结构目标版本；宿主据此记录 plugin_storage_migrations。 */
  storageVersion?: number;
  /** 插件自己的建表/升级逻辑；fromVersion 由宿主传入。 */
  migrateStorage?(db: PluginDb, fromVersion: number): number | void;
  /** 宿主暂存数据的一次性导入；按业务 id 幂等。 */
  migrateLegacy?(ctx: PluginContext, kind: string, payload: unknown): Promise<void>;
}

/** 插件 server 入口的默认导出必须包一层，宿主据此做运行时校验。 */
export function definePlugin(plugin: NxkvPlugin): NxkvPlugin {
  if (!plugin || typeof plugin !== 'object') throw new Error('definePlugin: 需要插件对象');
  if (!plugin.id || /[:.]/.test(plugin.id)) throw new Error(`definePlugin: 非法插件 id「${String(plugin.id)}」（只允许字母/数字/短横线）`);
  if (!plugin.api || !/^\^1(\.|$)/.test(plugin.api)) throw new Error(`definePlugin: 不支持的 api「${String(plugin.api)}」（当前 '^1'）`);
  if (!plugin.version) throw new Error('definePlugin: 需要 version');
  if (!plugin.name) throw new Error('definePlugin: 需要 name');
  if (typeof plugin.entries !== 'function') throw new Error('definePlugin: 需要 entries()');
  if (typeof plugin.buildDraft !== 'function') throw new Error('definePlugin: 需要 buildDraft()');
  return plugin;
}

/** 供插件做 rpc 参数兜底：把未知值收成普通对象。 */
export function paramsOf(raw: unknown): Record<string, any> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
}
