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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT_SCHEMA_VERSION } from './version.js';
import { tx } from './tx.js';
import { stampFileTag } from './time.js';

/**
 * 迁移步骤表。未来加列 → 追加 `{ version: 2, file: '002_xxx.sql' }`，
 * **绝不改 001**（已经发布出去的库不会重跑 001）。
 */
export const MIGRATIONS = [{ version: 1, file: '001.sql' }];

/** 读一份 schema 文件（随包发布，运行时按 URL 取，保持 SQL 可独立 review）。 */
export function readSchemaSql(file) {
  return readFileSync(new URL('./schema/' + file, import.meta.url), 'utf8');
}

// 连接级 PRAGMA：由 driver.js 在每个连接上执行（journal_mode 在事务里改不动），
// `user_version` 由本文件按步骤写入。留在 .sql 里是为了让人读到"这个库怎么跑"。
const CONNECTION_PRAGMA_RE =
  /^\s*PRAGMA\s+(journal_mode|foreign_keys|busy_timeout|synchronous|user_version)\b/i;

/** 从 schema 文件里取出可在事务内执行的 DDL（过滤掉连接级 PRAGMA）。 */
export function ddlOf(sql) {
  return String(sql)
    .split('\n')
    .filter((line) => !CONNECTION_PRAGMA_RE.test(line))
    .join('\n');
}

/** `PRAGMA user_version`（没设过 = 0）。 */
export function userVersion(db) {
  const row = db.get('PRAGMA user_version');
  return Number((row && row.user_version) || 0);
}

/**
 * 写 `PRAGMA user_version`。
 * PRAGMA 不支持绑定参数，只能拼字符串 —— 所以这里强制转成整数，
 * 杜绝把外部字符串拼进 SQL。
 */
export function setUserVersion(db, version) {
  const v = Math.max(0, Math.trunc(Number(version) || 0));
  db.exec('PRAGMA user_version = ' + v);
}

/** 库里有多少张业务表（不含 sqlite_ 内部表）。0 = 空文件 / 全新库。 */
export function countTables(db) {
  const row = db.get(
    "SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  return Number((row && row.c) || 0);
}

/** meta 表存在吗？（判据见 schema/001.sql 的 G1 注释） */
export function hasMetaTable(db) {
  const row = db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'");
  return !!row;
}

/** 读一个 meta 值；不存在返回 `null`。 */
export function getMeta(db, key) {
  if (!hasMetaTable(db)) return null;
  const row = db.get('SELECT value FROM meta WHERE key = :key', { key });
  return row ? row.value : null;
}

/** 写一个 meta 值（UPSERT）。必须在事务内调用（与 user_version 同一事务）。 */
export function setMeta(db, key, value, atMs = Date.now()) {
  db.run(
    `INSERT INTO meta (key, value, updated_at) VALUES (:key, :value, :at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { key, value: value === null || value === undefined ? '' : String(value), at: atMs }
  );
}

/** 存储种类标志（`meta.store_kind`）；没有 meta 表或没有该键都返回 `null`。 */
export function storeKindOf(db) {
  return getMeta(db, 'store_kind');
}

/** 需要执行的步骤（`from` 之后、`to` 及之前）。 */
export function pendingSteps(from, to = CURRENT_SCHEMA_VERSION) {
  const lo = Number(from) || 0;
  return MIGRATIONS.filter((s) => s.version > lo && s.version <= to).sort((a, b) => a.version - b.version);
}

/**
 * 按步升级。
 *
 * @param {object} db 连接（core/db/driver.js）
 * @param {object} [opts]
 * @param {number} [opts.from] 起始版本（缺省读 user_version）
 * @param {number} [opts.to=CURRENT_SCHEMA_VERSION] 目标版本
 * @returns {number[]} 实际执行的版本号
 */
export function migrate(db, { from, to = CURRENT_SCHEMA_VERSION } = {}) {
  const applied = [];
  let cur = from === undefined ? userVersion(db) : Number(from) || 0;
  for (const step of pendingSteps(cur, to)) {
    const sql = ddlOf(readSchemaSql(step.file));
    tx(
      (conn) => {
        // 双检：并发进程可能刚把这一步做完（锁在 BEGIN IMMEDIATE 上拿到）。
        const now = userVersion(conn);
        if (now >= step.version) return;
        conn.exec(sql);
        setUserVersion(conn, step.version);
        // meta 表可能还没建（001 里建），所以只有建好之后才写 schema_version。
        if (hasMetaTable(conn)) setMeta(conn, 'schema_version', String(step.version));
      },
      { db, mode: 'IMMEDIATE' }
    );
    // 事务里可能因并发跳过，但无论谁做的，此刻库都已在 step.version
    if (userVersion(db) >= step.version) applied.push(step.version);
    cur = step.version;
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
export function backupDatabase(db, { dir, tag, keep = 5, from } = {}) {
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
  const removed = [];
  if (keep > 0) {
    let names = [];
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
export function fileHasContent(path) {
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
}
