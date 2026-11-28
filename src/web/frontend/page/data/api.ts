// data 页的 API 收口：页面组件只消费这里的函数，不直接调 api()（模板约定）。
//
// 数据源是 GET /api/db/data（CLI db data 同一契约）：
// 不带 table = 全表概览；带 table = 该表的行窗口（LIMIT/OFFSET）。
import { api } from '../../api/client.js';

/** 一列（PRAGMA table_info 收窄后的两列）。 */
export interface DbColumn {
  name: string;
  type: string;
}

/** 一张表的概要。 */
export interface DbTableInfo {
  name: string;
  count: number;
  columns: DbColumn[];
}

/** GET /api/db/data（概览）的出站形状。 */
export interface DbOverview {
  path: string;
  exists: boolean;
  userVersion: number;
  currentSchemaVersion: number;
  tables: DbTableInfo[];
}

/** 一张表的行窗口（limit ≤ 1000；翻页用 offset）。行带 __rowid__（CRUD 行地址）。 */
export interface DbRows {
  path: string;
  table: string;
  count: number;
  columns: DbColumn[];
  rows: Record<string, any>[];
  limit: number;
  offset: number;
}

/** 全表概览：每张表的行数与列清单（面板首屏）。 */
export function fetchDbOverview(): Promise<DbOverview> {
  return api<DbOverview>('/api/db/data');
}

/** 一张表的行窗口（limit ≤ 1000；翻页用 offset）。 */
export function fetchDbTable(table: string, limit = 200, offset = 0): Promise<DbRows> {
  const q = `table=${encodeURIComponent(table)}&limit=${limit}&offset=${offset}`;
  return api<DbRows>(`/api/db/data?${q}`);
}

// ── #287：调试模式行级 CRUD（仅 serve --debug；后端过 PRAGMA 白名单 + 参数绑定）──

/** 更新一行的若干列（按 __rowid__ 寻址；主键列后端拒绝修改）。 */
export function updateDbRow(
  table: string,
  rowid: number,
  changes: Record<string, string | number | null>,
): Promise<{ table: string; changed: number }> {
  return api('/api/db/row-update', { method: 'POST', body: { table, rowid, changes } });
}

/** 插入一行（values 至少一列；返回新行 rowid）。 */
export function insertDbRow(
  table: string,
  values: Record<string, string | number | null>,
): Promise<{ table: string; changed: number; rowid: number }> {
  return api('/api/db/row-insert', { method: 'POST', body: { table, values } });
}

/** 删除一行（按 __rowid__）。 */
export function deleteDbRow(
  table: string,
  rowid: number,
): Promise<{ table: string; changed: number }> {
  return api('/api/db/row-delete', { method: 'POST', body: { table, rowid } });
}
