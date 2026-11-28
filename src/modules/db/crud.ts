// db 行级 CRUD（#287）：调试面板（#/data）的增删改数据源。
//
// 纪律与 service.data() 一致：表名先过 sqlite_master 白名单再双引号转义；
// 列名先过 PRAGMA table_info；值一律参数绑定（不接受拼接）。
// 整组能力只在 NX_KV_DEBUG=1（serve --debug）下开放——正常模式一律拒绝。
import { badInput, notFound } from '../../core/errors.js';
import { openStore } from '../../core/db/index.js';
import { columnsOf, userTables } from './service.js';

export interface RowMutationResult {
  table: string;
  changed: number;
  /** INSERT 时的新行 rowid（UPDATE/DELETE 无） */
  rowid?: number;
}

function requireDebugMode(): void {
  if (process.env.NX_KV_DEBUG !== '1') {
    throw badInput('仅调试模式可用：nx-kv serve --debug');
  }
}

const quoteIdent = (s: string): string => `"${String(s).replace(/"/g, '""')}"`;

function debugDb(): any {
  requireDebugMode();
  return openStore({ importLegacyData: false });
}

function assertDebugTable(db: any, table: string): string {
  if (!userTables(db).includes(table)) {
    throw notFound(`表不存在: ${table}（可用: ${userTables(db).join(', ')}）`);
  }
  return quoteIdent(table);
}

/** 行地址一律 rowid（统一寻址；WITHOUT ROWID 表不在本面板支持范围）。 */
const rowidPred = (): string => `${quoteIdent('rowid')} = ?`;

function bindable(k: string, v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw badInput(`列 ${k} 的值只能是字符串 / 数字 / null`);
}

/** 更新一行：changes 的键必须在表结构内；按 rowid 寻址（主键列也可改）。 */
export async function rowUpdate({
  table,
  rowid,
  changes,
}: {
  table: string;
  rowid: number | string;
  changes: Record<string, string | number | null>;
}): Promise<RowMutationResult> {
  const db = debugDb();
  const q = assertDebugTable(db, table);
  const cols = columnsOf(db, table).map((c) => c.name);
  const entries = Object.entries(changes || {}).filter(([k]) => cols.includes(k));
  if (!entries.length) {
    throw badInput('没有可更新的列（列名必须在表结构内）');
  }
  const sets = entries.map(([k]) => `${quoteIdent(k)} = ?`).join(', ');
  const params = [
    ...entries.map(([k, v]) => bindable(k, v)),
    typeof rowid === 'number' ? rowid : String(rowid),
  ];
  const r = db.run(`UPDATE ${q} SET ${sets} WHERE ${rowidPred()}`, params);
  return { table, changed: Number(r?.changes || 0) };
}

/** 插入一行：values 的键必须在表结构内（缺省列交 SQLite 默认值）。 */
export async function rowInsert({
  table,
  values,
}: {
  table: string;
  values: Record<string, string | number | null>;
}): Promise<RowMutationResult> {
  const db = debugDb();
  const q = assertDebugTable(db, table);
  const cols = columnsOf(db, table).map((c) => c.name);
  const entries = Object.entries(values || {}).filter(
    ([k, v]) => cols.includes(k) && v !== undefined,
  );
  if (!entries.length) throw badInput('没有可插入的列（列名必须在表结构内）');
  const names = entries.map(([k]) => quoteIdent(k)).join(', ');
  const marks = entries.map(() => '?').join(', ');
  const params = entries.map(([k, v]) => bindable(k, v));
  const r = db.run(`INSERT INTO ${q} (${names}) VALUES (${marks})`, params);
  return { table, changed: Number(r?.changes || 0), rowid: Number(r?.lastInsertRowid || 0) };
}

/** 删除一行：按 rowid 寻址。 */
export async function rowDelete({
  table,
  rowid,
}: {
  table: string;
  rowid: number | string;
}): Promise<RowMutationResult> {
  const db = debugDb();
  const q = assertDebugTable(db, table);
  const r = db.run(`DELETE FROM ${q} WHERE ${rowidPred()}`, [
    typeof rowid === 'number' ? rowid : String(rowid),
  ]);
  return { table, changed: Number(r?.changes || 0) };
}
