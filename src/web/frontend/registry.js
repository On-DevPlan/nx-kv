// 视图注册表：新增面板 = 在模块里写 view*.jsx + 在这里登记一行。
// `module` 指明该视图归属的后端功能域（tests/unit/registry.test.mjs 据此断言：
// 被引用的模块集合 == 带 view 的模块集合；引用的组件文件必须真实存在）。
// 纯前端的多文件视图（不声明后端 action）放 frontend/modules/<name>/，
// module 仍归它消费数据的功能域。App 的路由、懒加载由这张表驱动，改面板不用动壳。
//
// v2（原型 plan/uiux-redesign.html §7.1）：
//   dir/global/overview 归 localtask 域；cloud 即 todo 域（云端总览）。
//   经典看板（v1，#/localtask 与 dir-board）已下线——wait 深链改落 #/dir/<key>。
import { lazy } from 'react';

export const VIEWS = [
  // 目录 / 全局池：MD 式工作台（落地 plan/agent-md-workspace.html）。
  // 组件来自 frontend/modules/（纯前端视图模块，非后端功能域），
  // 数据仍是 localtask 队列，故 module 归 localtask。
  { id: 'dir', module: 'localtask', component: lazy(() => import('./modules/md-workspace/view.jsx')) },
  { id: 'global', module: 'localtask', component: lazy(() => import('./modules/md-workspace/view.jsx')) },
  { id: 'overview', module: 'localtask', component: lazy(() => import('../../modules/localtask/view-overview.jsx')) },
  { id: 'cloud', module: 'todo', component: lazy(() => import('../../modules/todo/view.jsx')) },
  { id: 'repos', module: 'repos', component: lazy(() => import('../../modules/repos/view.jsx')) },
];
