// ref 列表的**展示规则**（纯函数）——面板与提示词/工具复用同一套口径。
//
// 这里只做「一行怎么读」：主名取什么、副标题什么时候显示、归属怎么统计与过滤。
// 不碰网络、不碰 React，所以可以直接单测（tests/unit/refs-rows.test.mjs）。
import type { BindingRow } from './api.js';

/** 一条归属的 scope（筛选器与徽标共用的四档）。 */
export type ScopeKey = 'all' | 'repo' | 'group' | 'group_repo';

/** 各档的条数（筛选器药丸上的数字）。 */
export interface ScopeCounts {
  all: number;
  repo: number;
  group: number;
  group_repo: number;
}

/**
 * 行的主名：**正文标题 → 首行摘要 → desc**。
 * desc 是「快速定位」的一句话，不该顶替标题（#107 之前它顶过，列表里只剩一长句描述）。
 */
export function labelOf(b: BindingRow): string {
  return b.title || b.summary || b.desc || '未命名文档';
}

/** 副标题（desc）：与主名相同就不重复占一行。 */
export function descOf(b: BindingRow): string {
  const desc = String(b.desc || '').trim();
  return desc && desc !== labelOf(b) ? desc : '';
}

/** 按 scope 统计条数（全部 / 仓库 / 组 / 组内）。 */
export function scopeCounts(rows: BindingRow[] | null | undefined): ScopeCounts {
  const c: ScopeCounts = { all: 0, repo: 0, group: 0, group_repo: 0 };
  for (const r of rows || []) {
    c.all += 1;
    if (r.type === 'repo' || r.type === 'group' || r.type === 'group_repo') c[r.type] += 1;
  }
  return c;
}

/** 按 scope 过滤（all = 不过滤）。 */
export function filterByScope(rows: BindingRow[] | null | undefined, scope: ScopeKey): BindingRow[] {
  const list = rows || [];
  return scope === 'all' ? list : list.filter((r) => r.type === scope);
}

/** 配置里来的 scope 归一：不认识的（含 undefined）一律当 all。 */
export function normalizeScope(v?: string | null): ScopeKey {
  return v === 'repo' || v === 'group' || v === 'group_repo' ? v : 'all';
}
