// schema 升级链：`PRAGMA user_version` 驱动的迁移步骤。
//
// 为什么每步**一个事务**（而不是全程一个大事务）：升级是「版本 N 已可用」的累加
// 过程，一步失败时库停在上一版**可用状态**，比整体回滚更好排障 —— 回滚到 v1
// 意味着「用户的数据还在，但一列都读不出来」。
//
// 与业务层的关系：**不给业务层懒升级的机会**。升级只发生在 bootstrap 里，
// 拿着旧 schema 干活的路径一条都不留（懒升级 = 某条路径用旧列名写数据，且不报错）。
//
// 备份：升级前必须 `VACUUM INTO`（WAL 下直接复制 .db 会拿到不一致快照）。
// `VACUUM` 不能在事务里跑，所以备份是**升级事务之前**的独立动作。
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT_SCHEMA_VERSION } from './version.js';
import { MIGRATION_STEPS, planMigrationPath, readMigrationSql } from './migrations/index.js';
import type { MigrationStep } from './migrations/index.js';
import { tx } from './tx.js';
import { stampFileTag } from './time.js';
import type { DbApi } from './driver.js';

/** migrate 的选项。 */
export interface MigrateOptions {
  /** 起始版本（缺省读 user_version）。 */
  from?: number;
  /** 目标版本（缺省 `CURRENT_SCHEMA_VERSION`）。 */
  to?: number;
  /** 传给 step.apply 的迁移上下文（路径、时间戳等）。 */
  context?: any;
}

/** 备份的选项。 */
export interface BackupOptions {
  /** 备份目录。 */
  dir?: string;
  /** 文件名标签（默认 `nxkv-v<from>-<时间戳>`）。 */
  tag?: string;
  /** 保留最近几份（按文件名排序，定宽时间戳 → 字典序即时间序）。 */
  keep?: number;
  /** 备份时的源版本（缺省读 user_version）。 */
  from?: number;
}

/** 备份结果。 */
export interface BackupResult {
  path: string;
  removed: string[];
}

/**
 * 迁移步骤表 = migrations/index.js 的直接边。未来加版本 → 在那边追加
 * `{ from: N, to: N+1, file: 'vN+1.sql' }`，**绝不改已发布的 vN.sql**。
 *
 * `apply(conn, ctx)` 与 DDL 在**同一个事务**里执行，用于纯 SQL 表达不了的数据迁移
 * （manifest.json 台账、正文 fileId 引用、docs 树扫描等）。
 */
export const MIGRATIONS = MIGRATION_STEPS;

/** 读一份版本快照 / 跃迁脚本（随包发布，运行时按 URL 取，保持 SQL 可独立 review）。 */
export function readSchemaSql(file: string): string {
  return readMigrationSql(file);
}

// 连接级 PRAGMA：由 driver.js 在每个连接上执行（journal_mode 在事务里改不动），
// `user_version` 由本文件按步骤写入。留在 .sql 里是为了让人读到"这个库怎么跑"。
const CONNECTION_PRAGMA_RE =
  /^\s*PRAGMA\s+(journal_mode|foreign_keys|busy_timeout|synchronous|user_version)\b/i;

/** 从 schema 文件里取出可在事务内执行的 DDL（过滤掉连接级 PRAGMA）。 */
export function ddlOf(sql: unknown): string {
  return String(sql)
    .split('\n')
    .filter((line) => !CONNECTION_PRAGMA_RE.test(line))
    .join('\n');
}

/** `PRAGMA user_version`（没设过 = 0）。 */
export function userVersion(db: DbApi): number {
  const row = db.get('PRAGMA user_version');
  return Number((row && row.user_version) || 0);
}

/**
 * 写 `PRAGMA user_version`。
 * PRAGMA 不支持绑定参数，只能拼字符串 —— 所以这里强制转成整数，
 * 杜绝把外部字符串拼进 SQL。
 */
export function setUserVersion(db: DbApi, version: unknown): void {
  const v = Math.max(0, Math.trunc(Number(version) || 0));
  db.exec('PRAGMA user_version = ' + v);
}

/** 库里有多少张业务表（不含 sqlite_ 内部表）。0 = 空文件 / 全新库。 */
export function countTables(db: DbApi): number {
  const row = db.get(
    "SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  return Number((row && row.c) || 0);
}

/** meta 表存在吗？（判据见 schema/001.sql 的 G1 注释） */
export function hasMetaTable(db: DbApi): boolean {
  const row = db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'");
  return !!row;
}

/** 读一个 meta 值；不存在返回 `null`。 */
export function getMeta(db: DbApi, key: string): string | null {
  if (!hasMetaTable(db)) return null;
  const row = db.get('SELECT value FROM meta WHERE key = :key', { key });
  return row ? row.value : null;
}

/** 写一个 meta 值（UPSERT）。必须在事务内调用（与 user_version 同一事务）。 */
export function setMeta(db: DbApi, key: string, value: unknown, atMs: number = Date.now()): void {
  db.run(
    `INSERT INTO meta (key, value, updated_at) VALUES (:key, :value, :at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { key, value: value === null || value === undefined ? '' : String(value), at: atMs }
  );
}

/** 存储种类标志（`meta.store_kind`）；没有 meta 表或没有该键都返回 `null`。 */
export function storeKindOf(db: DbApi): string | null {
  return getMeta(db, 'store_kind');
}

/**
 * 需要执行的步骤（`from` 之后、`to` 及之前）。
 * 路径由 migrations/index.js 的边映射表规划：缺边会抛出明确错误，不静默跳过。
 */
export function pendingSteps(from: unknown, to: unknown = CURRENT_SCHEMA_VERSION): MigrationStep[] {
  return planMigrationPath(from, to);
}

/**
 * 按步升级。
 *
 * @param {object} db 连接（core/db/driver.js）
 * @param {object} [opts]
 * @param {number} [opts.from] 起始版本（缺省读 user_version）
 * @param {number} [opts.to=CURRENT_SCHEMA_VERSION] 目标版本
 * @param {object} [opts.context] 传给 step.apply 的迁移上下文（路径、时间戳等）
 * @returns {number[]} 实际执行的版本号
 */
export function migrate(db: DbApi, { from, to = CURRENT_SCHEMA_VERSION, context = {} }: MigrateOptions = {}): number[] {
  const applied: number[] = [];
  let cur = from === undefined ? userVersion(db) : Number(from) || 0;
  for (const step of pendingSteps(cur, to)) {
    const sql = ddlOf(readSchemaSql(step.file));
    tx(
      (conn) => {
        // 双检：并发进程可能刚把这一步做完（锁在 BEGIN IMMEDIATE 上拿到）。
        const now = userVersion(conn);
        if (now >= step.to) return;
        conn.exec(sql);
        if (typeof step.apply === 'function') step.apply(conn, context);
        setUserVersion(conn, step.to);
        // meta 表可能还没建（v1 里建），所以只有建好之后才写 schema_version。
        if (hasMetaTable(conn)) setMeta(conn, 'schema_version', String(step.to));
      },
      { db, mode: 'IMMEDIATE' }
    );
    // 事务里可能因并发跳过，但无论谁做的，此刻库都已在 step.to
    if (userVersion(db) >= step.to) applied.push(step.to);
    cur = step.to;
  }
  return applied;
}

/**
 * `VACUUM INTO` 备份。**绝不能用 copy**：WAL 下复制 .db 会拿到不一致快照。
 *
 * 返回备份文件路径。失败（如磁盘满）时抛错，调用方决定是"中止升级"还是"警告继续" ——
 * 升级前备份失败**必须中止**：没有退路的 schema 变更是不可接受的。
 *
 * @param {object} db 连接
 * @param {object} opts
 * @param {string} opts.dir 备份目录
 * @param {string} [opts.tag] 文件名标签（默认 `nxkv-v<from>-<时间戳>`）
 * @param {number} [opts.keep=5] 保留最近几份（按文件名排序，定宽时间戳 → 字典序即时间序）
 * @returns {{path: string, removed: string[]}}
 */
export function backupDatabase(db: DbApi, { dir, tag, keep = 5, from }: BackupOptions = {}): BackupResult {
  if (!dir) throw new TypeError('backupDatabase 需要 dir（备份目录）');
  const fromVersion = from === undefined ? userVersion(db) : Number(from) || 0;
  const base = tag || `nxkv-v${fromVersion}-${stampFileTag()}`;

  // VACUUM INTO **不会**替你建目录：目标目录不存在时 SQLite 报的是
  // "unable to open database: <path>"（看着像库坏了，其实只是目录没建）。
  mkdirSync(dir, { recursive: true });

  // 文件名只到秒：同一秒里连跑两次会撞名。VACUUM INTO 遇到已存在的目标直接报
  // "output file already exists"（不会覆盖，这是好事），这里补一个序号后缀。
  let target = join(dir, base + '.db');
  for (let n = 2; existsSync(target) && n < 100; n++) {
    target = join(dir, `${base}-${n}.db`);
  }

  // VACUUM INTO 接受表达式，所以目标路径可以绑定参数（不拼字符串，免转义问题）。
  db.run('VACUUM INTO ?', [target]);

  // 保留最近 N 份：多删少留是为了"备份不会自己把磁盘吃满"，keep=0 表示不清理。
  // 清理范围 = 我们自己产出的备份（升级前的 nxkv-v* 与手动 nxkv-manual-*），
  // 别把用户手工放进来的 .db 也删了。
  const removed: string[] = [];
  if (keep > 0) {
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter((f) => /^nxkv-(v|manual-).*\.db$/.test(f)).sort();
    } catch {
      names = [];
    }
    const victims = names.slice(0, Math.max(0, names.length - keep));
    for (const f of victims) {
      try {
        rmSync(join(dir, f), { force: true });
        removed.push(f);
      } catch {
        /* 删不掉就留着，不影响主流程 */
      }
    }
  }
  return { path: target, removed };
}

/** 文件是否存在且非空（"有没有库"的判据）。 */
export function fileHasContent(path: string): boolean {
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
}
