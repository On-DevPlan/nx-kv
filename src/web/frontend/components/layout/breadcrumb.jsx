// 面包屑（工作区顶部）——2026-11-04 #33：页签与页签条删掉之后，
// 「我现在在哪」由顶部这条路径回答（[ nx-kv/#81 ]；仓库是独立模块，不再带组前缀——#84）。
//
// #97：独立的「←」返回键删掉了——整段路径**本身就是返回钮**：点面包屑任意处
// = 返回上一级（按来处回：route-history 会话内历史；没有来处退父级，
// 见 route-crumb.jsx 的 onBack）。没有上一级（总览这类顶层页）时退化为纯文本路径。
//
// 数据来自**路由**（地址栏即位置）——不是从布局模型反推：布局里没有页签了，
// 路由才是唯一的「当前位置」真源（面板身份也由路由决定）。
import { useMemo } from 'react';
import { crumbsOf, parentRouteOf } from './crumbs.js';

export { crumbsOf, parentRouteOf };

export default function Breadcrumb({ route, ctx, onNavigate, onBack, inline = false }) {
  const crumbs = useMemo(() => crumbsOf(route, ctx), [route, ctx]);
  const back = useMemo(() => parentRouteOf(route, ctx), [route, ctx]);
  if (!crumbs.length) return null;
  const cls = 'nx-crumb' + (inline ? ' nx-crumb-inline' : '');
  const path = (
    <>
      <span className="nx-crumb-br" aria-hidden>[</span>
      {crumbs.map((c, i) => (
        <span key={`${c}-${i}`} className="nx-crumb-i">
          {i > 0 ? <span className="nx-crumb-sep">/</span> : null}
          <span className="nx-crumb-t">{c}</span>
        </span>
      ))}
      <span className="nx-crumb-br" aria-hidden>]</span>
    </>
  );
  // 有上一级且能导航 → 整段路径可点（#97）；否则纯文本（总览这类顶层页）
  if (!(back && onNavigate)) {
    return <nav className={cls} aria-label="当前位置">{path}</nav>;
  }
  return (
    <nav className={cls} aria-label="当前位置">
      <button
        type="button"
        className="nx-crumb-path"
        title="返回上一级"
        aria-label={`返回上一级（${crumbs.join(' / ')}）`}
        onClick={() => (onBack ? onBack() : onNavigate(back))}
      >
        {path}
      </button>
    </nav>
  );
}
