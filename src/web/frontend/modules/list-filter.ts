// 列表关键词过滤（#149 全局统一口径，纯函数）。
//
// 全站所有「列表 + 搜索框」共用这一份匹配规则：空格分词 AND、大小写不敏感、
// 多字段命中任一即可。与 modules/board/task-search.ts 的口径一致，但这里的
// 字段由调用方声明（标题 / 副标题 / key / 归属…），不绑死某种行类型。
// 不碰网络、不碰 React，可直接单测（tests/unit/list-filter.test.mjs）。

/** 行 → 可搜索字段。空串 / null / undefined 自动跳过。 */
export type SearchFields<T> = (row: T) => Array<string | number | null | undefined>;

/**
 * 按关键词过滤列表，保持原序。
 * - q 为空（含纯空白）→ 原样返回；
 * - 空格分词后每个词都要命中（AND），命中面是 fields(row) 的任意一项（OR）；
 * - 不做正则、不做通配符，避免用户输入 `(` 之类直接抛错。
 */
export function filterByKeyword<T>(
  rows: readonly T[] | null | undefined,
  q: unknown,
  fields: SearchFields<T>
): T[] {
  const list = Array.isArray(rows) ? Array.from(rows) : [];
  const raw = String(q ?? '').trim().toLowerCase();
  if (!raw) return list;
  const tokens = raw.split(/\s+/).filter(Boolean);
  return list.filter((row) => {
    const hay = fields(row)
      .map((v) => String(v ?? '').toLowerCase())
      .filter(Boolean);
    return tokens.every((t) => hay.some((h) => h.includes(t)));
  });
}

/** 关键词是否非空（给 UI 决定要不要显示清空按钮 / 命中计数）。 */
export function hasQuery(q: unknown): boolean {
  return String(q ?? '').trim().length > 0;
}
