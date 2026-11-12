// 视图注册表：新增面板 = 写组件 + 在这里登记一行。
//
// 视图**完全归前端管**：组件在 src/web/frontend/，路由与懒加载由这张表驱动，
// 后端模块对自己的视图一无所知（历史上模块 index 里挂过 `view: () => import(...)`，
// 那是把前端的文件布局写进后端声明，已整体移除）。
//
// `module` 字段只表示「这个视图消费哪个后端功能域的数据」，用于
// tests/unit/registry.test.mjs 断言不出现悬空归属——它不是后端的引用，
// 后端也读不到它。
//
// v2（原型 plan/uiux-redesign.html §7.1）：
//   dir/global/overview 归 localtask 域；云端总览已随云端任务模块移除。
//   经典看板（v1，#/localtask 与 dir-board）已下线——wait 深链改落 #/dir/<key>。
import { lazy } from 'react';
import type { ComponentType } from 'react';

/** 一个视图：id 是侧栏/路由认的名字，component 是懒加载的页面组件。 */
export interface ViewDef {
  id: string;
  /** 消费哪个后端功能域的数据（只用于静态自检，不是后端引用）。 */
  module: string;
  component: ComponentType<any>;
}

export const VIEWS: ViewDef[] = [
  // 目录 / 全局池：MD 式工作台（落地 plan/agent-md-workspace.html）。
  // 组件来自 frontend/modules/（纯前端视图模块，非后端功能域），
  // 数据仍是 localtask 队列，故 module 归 localtask。
  { id: 'dir', module: 'localtask', component: lazy(() => import('./page/dir/index.jsx')) },
  { id: 'global', module: 'localtask', component: lazy(() => import('./page/dir/index.jsx')) },
  { id: 'overview', module: 'localtask', component: lazy(() => import('./page/overview/index.jsx')) },
  { id: 'repos', module: 'repos', component: lazy(() => import('./page/repos/index.jsx')) },
  // 项目组详情：组里的子目录以表格呈现（点击侧栏的项目组行进来）
  { id: 'group', module: 'repos', component: lazy(() => import('./page/group/index.jsx')) },
];
