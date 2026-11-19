// SVG 资产库 · 总表。
//
// 这里是**唯一**的资产入口：界面上的图标、仓库页的图标组件、资产库页的列表
// 全部从这里取。加一份资产 = 在对应分类文件里加一条 + 在这里自动收进来
// （分类文件按 group 拆开是为了单文件行数可控，不是为了分家）。
import type { SvgAsset, SvgGroupId, SvgGroupMeta } from './types.js';
import { SVG_GROUPS } from './types.js';
import { NAV_ASSETS } from './catalog-nav.js';
import { REPO_ASSETS } from './catalog-repo.js';
import { DOC_ASSETS } from './catalog-doc.js';
import { STATE_ASSETS } from './catalog-state.js';
import { ACT_ASSETS } from './catalog-act.js';

export { SVG_GROUPS };
export type { SvgAsset, SvgEl, SvgGroupId, SvgGroupMeta } from './types.js';
export { p, f, c, r } from './types.js';

/** 全库（顺序 = 资产库页默认展示序）。 */
export const SVG_ASSETS: SvgAsset[] = [
  ...NAV_ASSETS,
  ...REPO_ASSETS,
  ...DOC_ASSETS,
  ...STATE_ASSETS,
  ...ACT_ASSETS,
];

const BY_NAME = new Map<string, SvgAsset>(SVG_ASSETS.map((a) => [a.name, a]));

/** 按名字取资产（调用方拿到的 undefined = 资产不存在，渲染层直接不画）。 */
export function assetOf(name: string): SvgAsset | undefined {
  return BY_NAME.get(name);
}

/** 资产名是否已登记（单测与调用点兜底用）。 */
export function hasAsset(name: string): boolean {
  return BY_NAME.has(name);
}

/** 某一分类的资产。 */
export function assetsOfGroup(group: SvgGroupId): SvgAsset[] {
  return SVG_ASSETS.filter((a) => a.group === group);
}

/** 分类元信息（分类条 / 统计用）。 */
export function groupMetaOf(id: SvgGroupId): SvgGroupMeta {
  return SVG_GROUPS.find((g) => g.id === id) || SVG_GROUPS[0]!;
}

/** 检索：名字 / 中文名 / 关键词，大小写不敏感；空串返回全库。 */
export function searchAssets(q: string): SvgAsset[] {
  const kw = String(q || '').trim().toLowerCase();
  if (!kw) return SVG_ASSETS;
  return SVG_ASSETS.filter((a) => {
    const hay = [a.name, a.label, ...(a.keys || [])].join(' ').toLowerCase();
    return hay.includes(kw);
  });
}

/** 资产库统计：总数 / 已挂载数 / 分类数。 */
export function hubStats(): { total: number; mounted: number; groups: number } {
  return {
    total: SVG_ASSETS.length,
    mounted: SVG_ASSETS.filter((a) => !!a.where).length,
    groups: SVG_GROUPS.length,
  };
}
