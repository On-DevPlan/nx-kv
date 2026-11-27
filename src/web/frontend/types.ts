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
  /** 通用插件页面：/plugin/<pluginId>/<pageId>[/<sessionId>] */
  pluginId?: string;
  pageId?: string;
  sessionId?: string;
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
  /** 工作目录当前是否还在（false = 临时目录被删 / 外接盘未挂载 / 测试残留） */
  cwdExists?: boolean;
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
/**
 * 侧边栏 namespace 分组（#167）：把仓库/看板条目归进若干命名空间分区显示。
 * **纯 UI 组织方式**——不碰任何数据模型，落点与 order/hidden/folded 同一 prefs。
 * items 键形与 order 一致：'board:<id>' | '<仓库key>'（数组序 = 分区内显示序）。
 */
export interface SidebarNs {
  id: string;
  name: string;
  /** 分区成员（显示序）；未列出的条目留在「未分组」区 */
  items: string[];
  /** 分区折叠态 */
  collapsed?: boolean;
  /** 置顶：该分区排到所有分区之前（多个置顶保持数组相对序） */
  pinned?: boolean;
}

export interface Prefs {
  order: string[];
  folded: boolean;
  defaultFolded: boolean;
  /** namespace 分区（#167）；空 = 现状平铺 */
  namespaces?: SidebarNs[];
  /** #174：侧栏聚焦的视图——''（全部）| 分区 id | '__ACTIVE__'（只显示有任务的） */
  focusNs?: string;
  /** #174：「未分组」区是否展开（默认 false = 折叠——分区即显示范围） */
  nsUngroupedOpen?: boolean;
  /** #254：任务页面包屑的路径复制偏好——raw = 原始路径；prompt = 带访问逻辑的 CLI 提示词 */
  copyPathStyle?: 'raw' | 'prompt';
  [k: string]: any;
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


