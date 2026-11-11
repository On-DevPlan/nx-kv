// 前端共享契约：路由 / 面板 / 全局上下文 / 队列数据的形状。
//
// 为什么集中在一处：`路由（App）→ 面板规格（route-map）→ 面板渲染（panels）` 是
// 同一条链上的三个消费者，各写一份形状就必然漂移——#86 那次「同一屏裂成两个页签」
// 的根因就是两边 config 的字段对不上。
//
// 约定：**服务端返回的 payload 一律按索引签名放行**（`[k: string]: any`）。
// 它们是对外数据边界，字段以后端 schema 为准；在类型层逐字段抄一遍，只会让
// 「后端加字段 → 前端报错」变成常态噪音，而真正的契约漂移（拼错字段名）由调用处
// 的显式字段声明兜住。
import type { Model } from 'flexlayout-react';

/** hash 路由解析结果。字段按视图**选择性出现**（dir 没有 mode，templates 没有 repoKey）。 */
export interface AppRoute {
  view: string;
  key: string;
  task: string;
  repoKey?: string;
  boardKey?: string;
  boardName?: string;
  mode?: string;
  id?: string;
  topic?: string;
  scope?: string;
}

/**
 * 面板 config：FlexLayout 节点里存的 JSON，形状**按 component 而变**
 * （dir 是 {dirKey}、page 是 {dirKey|groupId, task}……）。
 * 所以这里是外部边界类型，不逐 component 收窄——收窄后的联合类型每加一种面板都要改，
 * 而消费侧（panels.tsx 的 render）本来就得按 component 分支。
 */
export type PanelConfig = Record<string, any>;

/** 面板落点（workspace/areas.js 的策略表只有这几种）。 */
export type PanelLocation = 'center' | 'left' | 'right' | 'float';

/** 开一块面板所需的全部信息（route-map 的出站形状 / openPanel 的入参）。 */
export interface PanelSpec {
  component: string;
  name: string;
  config?: PanelConfig;
  location?: PanelLocation;
}

/** 面板渲染上下文：FlexLayout factory 额外递给面板的句柄（改自己 config 时要）。 */
export interface PanelCtx {
  tabId?: string;
  model?: Model;
  node?: unknown;
}

/** 命名上下文：把「队列名 / 组名 / 页名」翻成面板标题（App 按当前路由算）。 */
export interface SpecCtx {
  boardName?: string;
  dirName?: string;
  pageTitle?: string;
  docTitle?: string;
  repoName?: string;
}

/** 本机队列的一条任务（/api/localtasks 的 topics[].tasks[]）。 */
export interface LocalTask {
  id: number;
  text: string;
  status: string;
  [k: string]: any;
}

/** 本机队列的一个主题（= 一个目录的队列）。 */
export interface LocalTopic {
  key: string;
  name: string;
  tasks?: LocalTask[];
  [k: string]: any;
}

/** /api/localtasks 的出站形状。 */
export interface LocaltasksData {
  topics?: LocalTopic[];
  [k: string]: any;
}

/** 仓库行（/api/repos 的数组元素）。 */
export interface RepoRow {
  key: string;
  name: string;
  type?: string;
  [k: string]: any;
}

/** 看板/项目组行（/api/boards 的 boards[]）。 */
export interface BoardRow {
  id: string;
  key?: string;
  name: string;
  [k: string]: any;
}

/** 侧栏的唯一数据源：仓库 + 看板。 */
export interface RepoData {
  repos: RepoRow[];
  boards: BoardRow[];
}

/** /api/bootstrap 的出站形状（全局配置快照）。 */
export type BootData = Record<string, any>;

/** /api/bundled 的出站形状（内置模板/技能清单）。 */
export type BundledData = Record<string, any>;

/** 侧边栏视图偏好（localStorage 里的显示态，不是数据）。 */
export interface Prefs {
  order: string[];
  hidden: string[];
  folded: boolean;
  defaultFolded: boolean;
  [k: string]: any;
}

/** 任务模板（/api/templates 的 templates[]）。 */
export interface PromptTemplate {
  id: string;
  name: string;
  body: string;
  values?: Record<string, string>;
  scope?: string[];
  builtin?: boolean;
  [k: string]: any;
}

/** useTemplates 的返回面（App 层持有一份，工作台与模板面板共用）。 */
export interface TemplatesApi {
  defaultId: string;
  templates: PromptTemplate[] | null;
  unsupported: boolean;
  defaultBody: () => string;
  refetch: () => Promise<void>;
  add: (name: string, body: string, setDefault?: boolean, opts?: { topic?: string; scope?: string[] }) => Promise<any>;
  remove: (id: string) => Promise<any>;
  update: (id: string, patch: Record<string, any>) => Promise<any>;
  setDefault: (id: string) => Promise<any>;
}

/** 开一个 MD 页签的规格（App.openPage；groupId 与 dirKey 二选一，组锚定页用前者）。 */
export interface OpenPageSpec {
  name?: string;
  dirKey?: string;
  groupId?: string;
  task?: string;
  location?: PanelLocation;
}

/** 壳层动作（侧边栏头部那几个全局入口）。 */
export interface ShellApi {
  resetLayout: () => Promise<void>;
  openSettings: () => unknown;
}

/**
 * 打开全屏模板编辑器的入参（`panels.openTemplateEditor` 的签名）。
 * 放在共享契约里：设置页的模板卡片与面板注册表都要用它，两份副本必然漂移。
 */
export interface TemplateEditorOpts {
  mode?: 'edit' | 'new';
  id?: string;
  name?: string;
  scope?: string[];
  topic?: string;
}
