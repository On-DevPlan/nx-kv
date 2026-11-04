// 面包屑（工作区顶部）——2026-11-04 #33：页签与页签条删掉之后，
// 「我现在在哪」由顶部这条路径回答（[ nx / nx-kv / #28 ]）。
//
// 数据来自**路由**（地址栏即位置）——不是从布局模型反推：布局里没有页签了，
// 路由才是唯一的「当前位置」真源（面板身份也由路由决定）。
import { useMemo } from 'react';

/**
 * 路由 → 面包屑层级。
 * @param {object} route {view, key, task}
 * @param {object} ctx   {boardName, dirName, pageTitle}
 */
export function crumbsOf(route, ctx = {}) {
  if (!route || !route.view) return [];
  switch (route.view) {
    case 'dir': {
      const out = [];
      if (ctx.dirName) out.push(ctx.dirName);
      // 任务页：目录 → 任务（草稿用它的标题）
      if (route.task) out.push(ctx.pageTitle || `#${route.task}`);
      return out;
    }
    case 'group':
      return ctx.boardName ? [ctx.boardName] : ['项目组'];
    case 'repos':
      return ['仓库管理'];
    case 'cloud':
      return ['云端总览'];
    case 'overview':
      return ['全部目录总览'];
    case 'templates':
      return ['任务模板'];
    default:
      return [];
  }
}

export default function Breadcrumb({ route, ctx }) {
  const crumbs = useMemo(() => crumbsOf(route, ctx), [route, ctx]);
  if (!crumbs.length) return null;
  return (
    <nav className="nx-crumb" aria-label="当前位置">
      {crumbs.map((c, i) => (
        <span key={`${c}-${i}`} className="nx-crumb-i">
          {i > 0 ? <span className="nx-crumb-sep">/</span> : null}
          <span className="nx-crumb-t">{c}</span>
        </span>
      ))}
    </nav>
  );
}
