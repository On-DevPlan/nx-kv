// 面包屑（工作区顶部）——2026-11-04 #33：页签与页签条删掉之后，
// 「我现在在哪」由顶部这条路径回答（[ nx/nx-kv/draft ]）。
//
// 数据来自**路由**（地址栏即位置）——不是从布局模型反推：布局里没有页签了，
// 路由才是唯一的「当前位置」真源（面板身份也由路由决定）。
import { useMemo } from 'react';
import { crumbsOf } from './crumbs.js';

export { crumbsOf };

export default function Breadcrumb({ route, ctx }) {
  const crumbs = useMemo(() => crumbsOf(route, ctx), [route, ctx]);
  if (!crumbs.length) return null;
  return (
    <nav className="nx-crumb" aria-label="当前位置">
      <span className="nx-crumb-br" aria-hidden>[</span>
      {crumbs.map((c, i) => (
        <span key={`${c}-${i}`} className="nx-crumb-i">
          {i > 0 ? <span className="nx-crumb-sep">/</span> : null}
          <span className="nx-crumb-t">{c}</span>
        </span>
      ))}
      <span className="nx-crumb-br" aria-hidden>]</span>
    </nav>
  );
}
