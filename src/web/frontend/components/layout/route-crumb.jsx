// 路由面包屑条（挂在**各主面板内部**顶部——#44：不该在窗口顶部，
// 那是侧栏的地盘；路径条该跟着「当前面板」走）。
//
// 组成：[ ← 返回 ]  [ 组 / 目录 / 页 ]
//   · 返回键按**来处**返回（route-history 里的会话内历史），没有来处才退回父级
//   · 路径段由路由 + 队列 + 仓库登记算出（crumbCtxOf）
import { useMemo } from 'react';
import { useApp } from '../../app-context.jsx';
import { crumbsOf, crumbCtxOf, parentRouteOf } from './crumbs.js';
import { popRoute } from './route-history.js';
import Breadcrumb from './breadcrumb.jsx';

export default function RouteBreadcrumb() {
  const app = useApp() || {};
  const route = app.route || {};
  const rows = app.rows || [];
  const repoData = app.repoData || {};

  const ctx = useMemo(() => crumbCtxOf(route, rows, repoData), [route, rows, repoData]);
  const crumbs = useMemo(() => crumbsOf(route, ctx), [route, ctx]);
  if (!crumbs.length) return null;

  const onBack = () => {
    const prev = popRoute();
    if (prev && app.onNavigate) { app.onNavigate(prev); return; }
    const fallback = parentRouteOf(route, ctx);
    if (fallback && app.onNavigate) app.onNavigate(fallback);
  };

  return (
    <Breadcrumb route={route} ctx={ctx} onNavigate={app.onNavigate} onBack={onBack} inline />
  );
}
