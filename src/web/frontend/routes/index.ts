// 路由页总表 —— 加一个页面 = 在这里多一行 `xxxPage`。
//
// 两个方向共用同一张表：`view` 查正表（hash → 面板），`component` 查反表
// （面板 → hash）。反表按 `order` 升序尝试，**第一个给出非 undefined 的赢**：
// `page` 这块面板同时被 dir 与 group 写回，组锚定页更具体，所以 order 更小。
// 同 order 时按登记顺序，行为可预测（不要去造两个同 order 的规则）。
import { cloudPage, overviewPage, reposPage } from './static.js';
import { dirPage } from './dir.js';
import { docPage } from './doc.js';
import { groupPage } from './group.js';
import { templatesPage } from './templates.js';
import type { RoutePage, RouteReverse } from './types.js';

/** 全部视图（顺序只影响可读性与同 order 的比较顺序，查表按 view 精确匹配）。 */
export const PAGES: readonly RoutePage[] = [
  dirPage,
  groupPage,
  docPage,
  templatesPage,
  reposPage,
  cloudPage,
  overviewPage,
];

const BY_VIEW = new Map(PAGES.map((p) => [p.view, p]));

/** hash 一级段 → 视图声明；未登记的视图返回 undefined（调用方按「不开面板」处理）。 */
export function pageOfView(view: string): RoutePage | undefined {
  return BY_VIEW.get(view);
}

/** 反向表（面板 component → 写回 hash 的格式化器），已按 order 升序展开。 */
export const REVERSES: readonly RouteReverse[] = PAGES
  .flatMap((p) => p.reverse || [])
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/** 某个 component 的所有写回规则（保持上表顺序）。 */
export function reversesOf(component: string): readonly RouteReverse[] {
  return REVERSES.filter((r) => r.component === component);
}
