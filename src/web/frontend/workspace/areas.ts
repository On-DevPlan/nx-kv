// 工作区的四个区域（2026-11-04 #33「面板优化」统一命名）。
//
//   sidebar      左侧边栏（目录树）
//   maincontent  中间主内容区（**同时只显示一个面板**——没有页签，见下）
//   rightSidebar 右侧栏（并发进程面板）
//   float        弹窗面板（设置这类「临时开一块、看完就关」的东西）
//
// 面板与区域的对应关系收在这张**策略表**里：以前「开哪个面板落哪、是不是
// 单例」散在各个调用点（openFloatingPanel 特判、dockPanel 特判……），
// 现在一处声明，openPanel 按表分发——**策略模式**的落点。
//
// 为什么主内容区只留一个面板：工作区不再有页签（页签条与页签概念都删了，
// 顶部改成面包屑）——多个页并存但看不见，用户只会以为「点没反应」。
/** 区域名（与 types.ts 的 PanelLocation 同口径；多出来的 sidebar/maincontent 是内部命名） */
export type AreaName = 'sidebar' | 'maincontent' | 'rightSidebar' | 'float';

export const AREA = {
  SIDEBAR: 'sidebar',
  MAIN: 'maincontent',
  RIGHT: 'rightSidebar',
  FLOAT: 'float',
} as const;

/** component → 落点区域 */
export const PANEL_AREA: Record<string, AreaName> = {
  sidebar: AREA.SIDEBAR,
  dir: AREA.MAIN,
  page: AREA.MAIN,
  group: AREA.MAIN,
  repos: AREA.MAIN,
  cloud: AREA.MAIN,
  overview: AREA.MAIN,
  templates: AREA.MAIN,
  doc: AREA.MAIN,
  dag: AREA.MAIN,
  compose: AREA.MAIN,
  progress: AREA.RIGHT,
  refs: AREA.RIGHT,
  settings: AREA.FLOAT,
};

/** 单例面板：同一时刻只开一块，重复打开只是聚焦（不堆叠） */
export const SINGLETON_PANELS = new Set([
  'sidebar',
  'repos',
  'cloud',
  'overview',
  // templates 不再单例（#137）：new/edit 靠 config.mode 区分，空 config 是目录页
  'progress',
  'refs',
  'settings',
]);

/** 面板落点区域（未登记的面板按主内容区处理） */
export function areaOf(component: string): AreaName {
  return PANEL_AREA[component] || AREA.MAIN;
}

/** 是否单例面板 */
export function isSingleton(component: string): boolean {
  return SINGLETON_PANELS.has(component);
}
