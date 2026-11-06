// node:sqlite 的唯一引用点（全项目只此一处）。
//
// 为什么收在一处：`node:sqlite` 仍是 experimental，API 有改动史
// （v26.11 `DatabaseSync` → `Database`；v26.10 `undefined` 绑定行为变化）。
// 只在这里碰它，升级时改一个文件即可。
//
// ── 三个实测坑，全在这个文件里解决 ────────────────────────────────────
//
// 1. **每次 import 都往 stderr 打 ExperimentalWarning**，会污染冒烟测试里对
//    stdout+stderr 的文案断言。→ `import './quiet.js'` **必须排在 node:sqlite 之前**
//    （ESM 依赖按 import 声明顺序求值）。
//
// 2. **行对象是 null 原型**（`Object.getPrototypeOf(row) === null`）→
//    `assert.deepEqual(row, {a:1})` 失败。→ 出站一律 `{...row}`。
//
// 3. **`undefined` 不能绑定**（22.x 抛 `Provided value cannot be bound`；
//    真正的隐式 null 是 26.10 才有的），`boolean` 同样不能绑定。→ 入站统一
//    `bindValue()`：`undefined → null`、`boolean → 0|1`、`Date → ms`、`bigint → number`。
//
// 另一个约束：`PRAGMA journal_mode / foreign_keys / busy_timeout / synchronous`
// 是**连接级**设置，每个连接都要设（SQLite 的 foreign_keys 默认**关**，漏了它
// 所有 REFERENCES 都不会生效，而且不报错）。这些在 openRaw 里一次设好。
import './quiet.js';
import * as nodeSqlite from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { badInput } from '../errors.js';
import { isBusyError, mapSqliteError } from './errors.js';

// v26.11 把 DatabaseSync 改名成 Database；两个都认，只在这里判断。
const SqliteCtor = nodeSqlite.DatabaseSync ?? nodeSqlite.Database;

if (typeof SqliteCtor !== 'function') {
  throw new Error(
    '当前 Node 没有内置 SQLite（node:sqlite）。nx-kv 需要 Node >= 22.13.0，' +
      '请升级 Node 后再运行（`nx-kv version` 可看当前版本）。'
  );
}

/** 语句缓存上限：超过就整体清空（简单可靠，避免无界增长）。 */
const STMT_CACHE_MAX = 256;

/**
 * 入站参数归一：把 JS 侧的值转成 SQLite 能绑定的类型。
 *
 * @param {unknown} v
 * @returns {string|number|null|Uint8Array} 可绑定值
 */
export function bindValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'bigint') return Number(v);
  return v;
}

/** 出站行归一：**null 原型 → 普通对象**，让 deepEqual / JSON.stringify 行为正常。 */
function plain(row) {
  if (row === undefined || row === null) return null;
  const out = { ...row };
  // bigint 只在 readBigInts 打开时出现；这里统一成 number，避免 `1n !== 1`。
  for (const k of Object.keys(out)) if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
  return out;
}

/**
 * 参数列表归一：数组按位置、对象按名字（node:sqlite 默认允许裸名绑 `:name`）。
 * @returns {unknown[]} 直接 spread 给 StatementSync.get/all/run 的参数数组
 */
function argsOf(params) {
  if (params === undefined || params === null) return [];
  if (Array.isArray(params)) return params.map(bindValue);
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    // 允许调用方带 : / @ / $ 前缀写键名，统一剥掉（node:sqlite 只认裸名）。
    out[k.replace(/^[:@$]/, '')] = bindValue(v);
  }
  return [out];
}

/** 同步小睡（WAL 切换重试用）。 */
function sleepMsSync(ms) {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, Math.max(0, ms));
}

/**
 * 把库切到 WAL（**文件级持久设置**，切一次之后每个连接都受益）。
 *
 * 为什么不能简单 `exec('PRAGMA journal_mode = WAL')`：切换需要短暂的排它锁，
 * **两个进程同时首启**时会互相撞 —— 一方拿到锁正在切，另一方会收到
 * `SQLITE_BUSY: database is locked`。而 WAL 是持久属性，另一方切换成功后本连接
 * 本来就无所谓，所以这里的策略是「重试几次，还是忙就算（不当作错误）」。
 *
 * 不这么做的现场症状：两个 `db migrate` 并发时，慢的那个直接报
 * "存储忙，请重试"，看上去像迁移失败，其实库好好的。
 */
function enableWal(api) {
  for (let i = 0; i < 4; i++) {
    try {
      api.get('PRAGMA journal_mode = WAL');
      return;
    } catch (err) {
      if (!isBusyError(err)) throw mapSqliteError(err);
      sleepMsSync(20 * (i + 1));
    }
  }
  // 4 次都忙：另一个进程正在切换 / 长期持锁。这不影响本连接的正确性
  // （WAL 一旦由任何人打开就持久生效），也不是迁移失败，所以只是放过。
}

/**
 * 打开一个原始连接。
 *
 * @param {string} dbPath 库文件路径（`:memory:` 合法）
 * @param {object} [opts]
 * @param {boolean} [opts.readOnly=false] 只读连接（`db status` 这类不触发升级的命令用）
 * @param {number}  [opts.busyTimeoutMs=5000] 写锁等待上限
 * @returns {object} 驱动对象
 */
export function openRaw(dbPath, { readOnly = false, busyTimeoutMs = 5000 } = {}) {
  if (!dbPath) throw new TypeError('openRaw(dbPath) 需要库文件路径');
  if (dbPath !== ':memory:' && !readOnly) mkdirSync(dirname(dbPath), { recursive: true });
  if (readOnly && dbPath !== ':memory:' && !existsSync(dbPath)) {
    // 只读打开**不会**创建文件，SQLite 只会抛 "unable to open database file" ——
    // 那句话指不出真因（"库还没建"），所以在驱动层就换成能指路的错误。
    throw badInput(`库文件不存在: ${dbPath}（只读打开不会创建它）`);
  }

  let raw;
  try {
    raw = new SqliteCtor(dbPath, readOnly ? { readOnly: true } : {});
  } catch (err) {
    throw mapSqliteError(err);
  }

  const stmts = new Map();
  let closed = false;

  const api = {
    /** 库文件路径（测试与排障用）。 */
    path: dbPath,
    readOnly,
    /** 底层 DatabaseSync（只在必须绕过封装时用：PRAGMA、VACUUM INTO）。 */
    raw: () => raw,
    /** 连接是否已关闭。 */
    get closed() {
      return closed;
    },

    /** 执行一段 SQL（可多语句，不能带参数）。DDL / PRAGMA 走它。 */
    exec(sql) {
      try {
        raw.exec(sql);
      } catch (err) {
        throw mapSqliteError(err);
      }
    },

    /** 预编译（带缓存）。返回 StatementSync 的薄封装。 */
    prepare(sql) {
      let st = stmts.get(sql);
      if (st) return st;
      try {
        st = raw.prepare(sql);
      } catch (err) {
        throw mapSqliteError(err);
      }
      if (stmts.size >= STMT_CACHE_MAX) stmts.clear();
      stmts.set(sql, st);
      return st;
    },

    /** 取一行；没有行返回 `null`（不是 undefined：`null` 在 JSON 里才看得见）。 */
    get(sql, params) {
      try {
        return plain(api.prepare(sql).get(...argsOf(params)));
      } catch (err) {
        throw mapSqliteError(err);
      }
    },

    /** 取全部行（每行都是普通对象）。 */
    all(sql, params) {
      try {
        return api.prepare(sql).all(...argsOf(params)).map(plain);
      } catch (err) {
        throw mapSqliteError(err);
      }
    },

    /** 执行写语句 → `{ changes, lastInsertRowid }`（数字，不是 bigint）。 */
    run(sql, params) {
      try {
        const r = api.prepare(sql).run(...argsOf(params));
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
      } catch (err) {
        throw mapSqliteError(err);
      }
    },

    /** 取一个标量（第一列第一行）；没有行返回 `null`。 */
    scalar(sql, params) {
      const row = api.get(sql, params);
      if (!row) return null;
      const keys = Object.keys(row);
      return keys.length ? row[keys[0]] : null;
    },

    /** 关连接（幂等）。**测试删库前必须先关**：Windows 上连接开着会 EBUSY。 */
    close() {
      if (closed) return;
      closed = true;
      stmts.clear();
      try {
        raw.close();
      } catch (err) {
        throw mapSqliteError(err);
      }
    },
  };

  // ── 连接级 PRAGMA：每个连接都要设，且必须在任何业务语句之前 ──
  //
  // foreign_keys 默认关：漏了它，所有 REFERENCES 静默失效（删仓库不级联、
  // 依赖能指向不存在的任务），而且**不报错**。
  const waitMs = Number.isFinite(Number(busyTimeoutMs)) ? Math.max(0, Number(busyTimeoutMs)) : 5000;
  api.exec('PRAGMA busy_timeout = ' + waitMs);
  api.exec('PRAGMA foreign_keys = ON');
  api.exec('PRAGMA synchronous = NORMAL');
  if (!readOnly) enableWal(api);

  return api;
}
