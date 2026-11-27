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

export interface NxkvPlugin {
  id: string;
  version: string;
  api: typeof PLUGIN_API | string;
  name: string;
  description?: string;
  order: number;
  defaultEnabled: boolean;
  entries(ctx: PluginContext): Promise<EntryView[]> | EntryView[];
  buildDraft(ctx: PluginContext, entryId: string, values: Record<string, string>): Promise<PretaskDraft>;
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
