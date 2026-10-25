// 视图注册表：新增面板 = 在模块里写 view.jsx + 在这里登记一行。
// App 的 tab 导航、hash 路由、懒加载全部由这张表驱动，改面板不用动壳。
//
// 与后端 src/runtime/registry.js 的模块表一一对应；tests/unit/registry.test.mjs
// 会断言两侧对齐——漏登记（或登记了不存在的视图）都会直接测试失败。
import { lazy } from 'react';

export const VIEWS = [
  { id: 'localtask', title: '本地任务', component: lazy(() => import('../../modules/localtask/view.jsx')) },
  { id: 'todo', title: '清单', component: lazy(() => import('../../modules/todo/view.jsx')) },
  // 「工作空间」已于 2026-10-23 并入清单：它是清单的设置，
  // 入口是清单页工具栏里的「工作空间」弹窗，不再单独占一个 tab。
  { id: 'repos', title: '仓库', component: lazy(() => import('../../modules/repos/view.jsx')) },
  { id: 'auth', title: '登录', component: lazy(() => import('../../modules/auth/view.jsx')) },
];
