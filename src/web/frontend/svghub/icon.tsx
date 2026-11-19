// SVG 资产库 · 渲染层。
//
// 目录（catalog）只存数据，这里负责把数据画成 React 节点。两个入口：
//   SvgIcon   —— 通用渲染（名字 + 尺寸 + 可选标题），资产库页与各处新代码用它；
//   Icon      —— 旧接口（components/icons.tsx 的 14px/.ic 口径），调用点不动；
//   glyph     —— 给「一个组件一个图标」的旧写法（page/repos/icons.tsx）做桥。
//
// 一条规则：**没有登记的名字不画**（返回 null）。这比回退到某个默认图标好——
// 图标错了会让人以为「点的是另一件事」，漏画至少看得出来（单测也钉了这条）。
import type { ReactNode, SVGProps } from 'react';
import { assetOf } from './index.js';
import type { SvgEl } from './types.js';

/** 渲染入参：SVG 的通用属性透传（className / style / onClick 都能给）。 */
export interface SvgIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  /** 资产名（见 svghub/index.ts 的 SVG_ASSETS） */
  name: string;
  /** 边长（正方形）；缺省取资产的 size，再缺省 14 */
  size?: number;
  /** 线宽覆盖；缺省取资产的 w，再缺省 1.8 */
  weight?: number;
  /** 给了才做可访问命名（否则整颗图标对读屏隐藏） */
  title?: string;
}

/** 单个图元 → React 节点。 */
function elNode(el: SvgEl, i: number): ReactNode {
  if ('p' in el) return <path key={i} d={el.p} />;
  if ('f' in el) return <path key={i} d={el.f} fill="currentColor" stroke="none" />;
  if ('c' in el) {
    const [cx, cy, r] = el.c;
    return <circle key={i} cx={cx} cy={cy} r={r} fill={el.fill ? 'currentColor' : undefined} stroke={el.fill ? 'none' : undefined} />;
  }
  const [x, y, w, h, rx] = el.r;
  return <rect key={i} x={x} y={y} width={w} height={h} rx={rx} fill={el.fill ? 'currentColor' : undefined} stroke={el.fill ? 'none' : undefined} />;
}

/** 通用图标：按资产名直出。 */
export function SvgIcon({ name, size, weight, title, className, ...rest }: SvgIconProps) {
  const asset = assetOf(name);
  if (!asset) return null;
  const px = size ?? asset.size ?? 14;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight ?? asset.w ?? 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      className={className}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {asset.els.map(elNode)}
    </svg>
  );
}

/** 旧版图标组件入参（components/icons.tsx 的历史口径）。 */
export interface IconProps {
  name: string;
  size?: number;
  className?: string;
  title?: string;
}

/** 旧接口：`<Icon name="repo" />`。默认 14px，带 .ic 类（尺寸基准由 CSS 定）。 */
export function Icon({ name, size = 14, className = '', title }: IconProps) {
  return (
    <SvgIcon
      name={name}
      size={size}
      title={title}
      className={'ic' + (className ? ' ' + className : '')}
    />
  );
}

/**
 * 组件化桥：把资产名包成一个「一图标一组件」的写法。
 * page/repos/icons.tsx 的历史导出（IconRepo 等）靠它保持签名不变。
 */
export function glyph(name: string) {
  function AssetGlyph({ size = 15, ...rest }: Omit<SvgIconProps, 'name'>) {
    return <SvgIcon name={name} size={size} {...rest} />;
  }
  AssetGlyph.displayName = 'Glyph(' + name + ')';
  return AssetGlyph;
}
