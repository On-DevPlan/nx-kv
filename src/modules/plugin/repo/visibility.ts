// plugin_entry_visibility：按 scope_key（topic:/repo:/group:）记录入口可见性、顺序与默认项。
// 缺行 = 可见（opt-out，新入口自动出现）；is_default=1 至多一行（scope 内「新建页」默认）。
import { db, txw } from './db.js';
import type { DbApi } from '../../../core/db/driver.js';

export interface VisibilityRow {
  entryId: string;
  visible: boolean;
  sortOrder: number;
  isDefault: boolean;
}

export function rowsOfScope(scopeKey: string, conn: DbApi = db()): VisibilityRow[] {
  const rows = conn.all(
    `SELECT entry_id, visible, sort_order, is_default
       FROM plugin_entry_visibility WHERE scope_key = :s ORDER BY sort_order, entry_id`,
    { s: scopeKey },
  );
  return rows.map((r) => ({
    entryId: String(r.entry_id),
    visible: !!Number(r.visible),
    sortOrder: Number(r.sort_order) || 0,
    isDefault: !!Number(r.is_default),
  }));
}

/** 当前 scope 配的默认入口（缺省 = ''，由调用方回落插件声明）。 */
export function defaultOfScope(scopeKey: string, conn: DbApi = db()): string {
  if (!scopeKey) return '';
  const row = conn.get(
    'SELECT entry_id FROM plugin_entry_visibility WHERE scope_key = :s AND is_default = 1 LIMIT 1',
    { s: scopeKey },
  );
  return row ? String(row.entry_id) : '';
}

/** 写可见性与顺序：不碰 is_default（默认项只由 setDefault 改）。 */
export function setScope(
  scopeKey: string,
  entries: readonly { entryId: string; visible: boolean; sortOrder?: number }[],
  conn?: DbApi,
): void {
  const at = Date.now();
  const write = (c: DbApi) => {
    for (const e of entries) {
      c.run(
        `INSERT INTO plugin_entry_visibility (scope_key, entry_id, visible, sort_order, is_default, updated_at)
         VALUES (:s, :id, :visible, :sort, 0, :at)
         ON CONFLICT(scope_key, entry_id) DO UPDATE SET
           visible = excluded.visible,
           sort_order = excluded.sort_order,
           updated_at = excluded.updated_at`,
        { s: scopeKey, id: e.entryId, visible: e.visible ? 1 : 0, sort: Number(e.sortOrder) || 0, at },
      );
    }
  };
  if (conn) write(conn);
  else txw((c) => write(c));
}

/**
 * 设 scope 的「新建页」默认入口：先清后设，保证至多一行 is_default=1。
 * entryId 传空 = 跟随插件默认（清掉本 scope 的配置）。
 */
export function setDefault(scopeKey: string, entryId: string, conn?: DbApi): void {
  const at = Date.now();
  const write = (c: DbApi) => {
    c.run('UPDATE plugin_entry_visibility SET is_default = 0, updated_at = :at WHERE scope_key = :s', {
      s: scopeKey,
      at,
    });
    if (!entryId) return;
    // 缺行时插入：可见（与 opt-out 一致），顺序交给之后保存可见性时校正。
    c.run(
      `INSERT INTO plugin_entry_visibility (scope_key, entry_id, visible, sort_order, is_default, updated_at)
       VALUES (:s, :id, 1, 0, 1, :at)
       ON CONFLICT(scope_key, entry_id) DO UPDATE SET
         is_default = 1,
         updated_at = excluded.updated_at`,
      { s: scopeKey, id: entryId, at },
    );
  };
  if (conn) write(conn);
  else txw((c) => write(c));
}

/** 删除某入口在所有 scope 的可见性行（模板/入口被删时清孤儿）。 */
export function dropEntry(entryId: string, conn?: DbApi): void {
  const write = (c: DbApi) => {
    c.run('DELETE FROM plugin_entry_visibility WHERE entry_id = :id', { id: entryId });
  };
  if (conn) write(conn);
  else txw((c) => write(c));
}
