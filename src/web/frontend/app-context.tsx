// 应用上下文：工作区里的**面板**要拿到全局数据（本机队列、仓库、导航、模板…）。
//
// 面板由 FlexLayout 的 factory 直接渲染，拿不到 App 的 props——所以用 Context 递。
// 这里只放「面板用得着的全局只读数据 + 少数动作」，不放面板自己的状态
//（那属于面板自己的 store 或 FlexLayout 的 config）。
import { createContext, useContext } from 'react';
import type { Model } from 'flexlayout-react';
import type {
  AppRoute,
  BootData,
  LocalTopic,
  OpenPageSpec,
  Prefs,
  RepoData,
  ShellApi,
  TemplatesApi,
} from './types.js';

/** 面板能看到的全局面（App 组装一次，全树共享）。 */
export interface AppValue {
  /** /api/bootstrap 快照（还没到位时 null）。 */
  boot: BootData | null;
  /** 本机队列主题（侧栏与各面板共用一份）。 */
  rows: LocalTopic[];
  /** 仓库 + 看板（侧栏的唯一数据源）。 */
  repoData: RepoData;
  /** 侧边栏显示态偏好。 */
  prefs: Prefs;
  patchPrefs: (patch: Partial<Prefs> | ((prev: Prefs) => Partial<Prefs>)) => void;
  /** 写 hash 并**立刻**同步路由状态（不等 hashchange 那一拍）。 */
  onNavigate: (hash: string) => void;
  refreshLocal: () => Promise<void>;
  refreshRepos: () => Promise<void>;
  /** 任务模板（App 持有，模板面板与 MD 工作台共用同一份）。 */
  tpl: TemplatesApi;
  model: Model | null;
  route: AppRoute;
  /** 队列首轮是否已加载完：面板据此区分「还在读」与「确实没有这条任务」 */
  localReady: boolean;
  openPage: (spec: OpenPageSpec) => void;
  closePanel: (tabId: string) => void;
  shell: ShellApi;
}

export const AppContext = createContext<Partial<AppValue>>({});

/**
 * 面板里取全局上下文。
 *
 * 没有 Provider 时返回**空对象**（便于单测里单独渲染面板）——历史上这里返回 null，
 * 而 18 个调用点全都写 `useApp() || {}`，两种写法对消费者完全等价；改成空对象后
 * 类型上也不必每个调用点再判空一次。
 */
export function useApp(): Partial<AppValue> {
  return useContext(AppContext);
}
