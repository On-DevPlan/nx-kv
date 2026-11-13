// 面包屑（工作区顶部）——2026-11-04 #33：页签与页签条删掉之后，
// 「我现在在哪」由顶部这条路径回答（[ nx-kv/#81 ]；仓库是独立模块，不再带组前缀——#84）。
//
// #97 曾把整段路径做成一个返回钮；#190 把语义拆回来：
//   · 每段路径独立可点，去它自己的层级（crumbTrailOf 给出各段路由）；
//     最后一段是当前位置，纯文本——md 编辑器里的面包屑不再是「只会返回的路径」。
//   · 「返回」是独立的 ← 钮：来处优先（route-history 会话内历史），
//     没有来处退父级（route-crumb 的 onBack）。没有上一级的顶层页不画 ←。
import { useMemo } from 'react';
import { crumbTrailOf, parentRouteOf } from './crumbs.js';
import type { AppRoute, SpecCtx } from '../../types.js';

export { crumbTrailOf, parentRouteOf };

interface BreadcrumbProps {
  route: Partial<AppRoute>;
  ctx?: SpecCtx;
  onNavigate?: ((hash: string) => void) | null;
  onBack?: (() => void) | null;
  inline?: boolean;
}

export default function Breadcrumb({ route, ctx = {}, onNavigate, onBack, inline = false }: BreadcrumbProps) {
  const trail = useMemo(() => crumbTrailOf(route, ctx), [route, ctx]);
  const back = useMemo(() => parentRouteOf(route, ctx), [route, ctx]);
  if (!trail.length) return null;
  const cls = 'nx-crumb' + (inline ? ' nx-crumb-inline' : '');
  const canBack = !!(back && onNavigate);
  return (
    <nav className={cls} aria-label="当前位置">
      {canBack && (
        <button
          type="button"
          className="nx-crumb-back"
          title="返回上一级"
          aria-label="返回上一级"
          onClick={() => (onBack ? onBack() : onNavigate(back))}
        >
          ←
        </button>
      )}
      <span className="nx-crumb-br" aria-hidden>[</span>
      {trail.map((c, i) => {
        const isCurrent = i === trail.length - 1;
        const clickable = !isCurrent && !!c.hash && !!onNavigate;
        return (
          <span key={`${c.label}-${i}`} className="nx-crumb-i">
            {i > 0 ? <span className="nx-crumb-sep">/</span> : null}
            {clickable ? (
              <button
                type="button"
                className="nx-crumb-t nx-crumb-link"
                title={`前往 ${c.label}`}
                onClick={() => onNavigate(c.hash)}
              >
                {c.label}
              </button>
            ) : (
              <span className="nx-crumb-t">{c.label}</span>
            )}
          </span>
        );
      })}
      <span className="nx-crumb-br" aria-hidden>]</span>
    </nav>
  );
}
