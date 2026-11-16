// schema v10 → v11 的数据迁移（在 v11.sql 的同一个事务里执行）。
//
// 口径：
//   · 孤儿定义 = 没有任何 ref_bindings 行的未删除 ref；
//   · 存量孤儿的失绑起算时间统一按**升级时刻**（context.atMs）落库，
//     因此升级后仍有完整的 TTL 缓冲，不会被立刻清掉；
//   · 有绑定的 ref 清掉 orphan_since（0 = 未计时）；
//   · 不碰 updated_at：迁移不该改变文档列表的最近更新排序。
export interface V11Context {
  atMs?: number;
}

export interface OrphanSinceBackfillResult {
  orphaned: number;
  bound: number;
}

export function migrateOrphanRefs(
  conn: any,
  { atMs = Date.now() }: V11Context = {}
): OrphanSinceBackfillResult {
  const orphaned = conn.run(
    `UPDATE refs SET state = 'orphan', orphan_since = :at
      WHERE deleted_at IS NULL
        AND orphan_since = 0
        AND id NOT IN (SELECT ref_id FROM ref_bindings)`,
    { at: atMs }
  );
  const bound = conn.run(
    `UPDATE refs SET state = '', orphan_since = 0
      WHERE deleted_at IS NULL
        AND (state <> '' OR orphan_since <> 0)
        AND id IN (SELECT ref_id FROM ref_bindings)`
  );
  return { orphaned: Number(orphaned.changes) || 0, bound: Number(bound.changes) || 0 };
}
