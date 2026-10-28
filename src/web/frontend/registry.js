// 视图注册表：新增面板 = 在模块里写 view*.jsx + 在这里登记一行。
// `module` 指明该视图归属的后端功能域（tests/unit/registry.test.mjs 据此断言：
// 被引用的模块集合 == 带 view 的模块集合；引用的组件文件必须真实存在）。
// App 的路由、懒加载由这张表驱动，改面板不用动壳。
//
// v2（原型 plan/uiux-redesign.html §7.1）：
//   dir/global/overview 归 localtask 域；cloud 即 todo 域（云端总览）；
//   localtask（经典看板）保留一个版本周期——wait 深链 #/localtask?cwd=… 仍落那里。
import { lazy } from 'react';

export const VIEWS = [
  { id: 'dir', module: 'localtask', component: lazy(() => import('../../modules/localtask/view-dir.jsx')) },
  { id: 'global', module: 'localtask', component: lazy(() => import('../../modules/localtask/view-dir.jsx')) },
  { id: 'overview', module: 'localtask', component: lazy(() => import('../../modules/localtask/view-overview.jsx')) },
  { id: 'cloud', module: 'todo', component: lazy(() => import('../../modules/todo/view.jsx')) },
  { id: 'repos', module: 'repos', component: lazy(() => import('../../modules/repos/view.jsx')) },
  { id: 'auth', module: 'auth', component: lazy(() => import('../../modules/auth/view.jsx')) },
  // 经典看板（v1）：wait 深链与完整回填/设置 UI 的兼容出口
  { id: 'localtask', module: 'localtask', component: lazy(() => import('../../modules/localtask/view.jsx')) },
];
