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
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError, CODES, badInput } from '../errors.js';
import { isBusyError, mapSqliteError } from './errors.js';
import { stampFileTag } from './time.js';

/** 出站行：一律普通对象（null 原型已被 {@link plain} 抹平）。 */
export type Row = Record<string, any>;

/** 写语句的返回值（数字，不是 bigint）。 */
export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

/** 驱动对象：全项目唯一的 SQLite 句柄形状。 */
export interface DbApi {
  /** 库文件路径（测试与排障用）。 */
  path: string;
  readOnly: boolean;
  /** 底层 DatabaseSync（只在必须绕过封装时用：PRAGMA、VACUUM INTO）。 */
  raw(): any;
  /** 连接是否已关闭。 */
  readonly closed: boolean;
  /** 执行一段 SQL（可多语句，不能带参数）。DDL / PRAGMA 走它。 */
  exec(sql: string): void;
  /** 预编译（带缓存）。返回 StatementSync 的薄封装。 */
  prepare(sql: string): any;
  /** 取一行；没有行返回 `null`（不是 undefined：`null` 在 JSON 里才看得见）。 */
  get(sql: string, params?: unknown): any;
  /** 取全部行（每行都是普通对象）。 */
  all(sql: string, params?: unknown): Row[];
  /** 执行写语句 → `{ changes, lastInsertRowid }`（数字，不是 bigint）。 */
  run(sql: string, params?: unknown): RunResult;
  /** 取一个标量（第一列第一行）；没有行返回 `null`。 */
  scalar(sql: string, params?: unknown): any;
  /** 关连接（幂等）。**测试删库前必须先关**：Windows 上连接开着会 EBUSY。 */
  close(): void;
}

/** openRaw 的选项。 */
export interface OpenRawOptions {
  readOnly?: boolean;
  busyTimeoutMs?: number;
}

// v26.11 把 DatabaseSync 改名成 Database；两个都认，只在这里判断。
const sqliteNs = nodeSqlite as unknown as { DatabaseSync?: any; Database?: any };
const SqliteCtor = sqliteNs.DatabaseSync ?? sqliteNs.Database;

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
export function bindValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'bigint') return Number(v);
  return v;
}

/** 出站行归一：**null 原型 → 普通对象**，让 deepEqual / JSON.stringify 行为正常。 */
function plain(row: any): Row | null {
  if (row === undefined || row === null) return null;
  const out: Row = { ...row };
  // bigint 只在 readBigInts 打开时出现；这里统一成 number，避免 `1n !== 1`。
  for (const k of Object.keys(out)) if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
  return out;
}

/**
 * 参数列表归一：数组按位置、对象按名字（node:sqlite 默认允许裸名绑 `:name`）。
 * @returns {unknown[]} 直接 spread 给 StatementSync.get/all/run 的参数数组
 */
function argsOf(params: unknown): unknown[] {
  if (params === undefined || params === null) return [];
  if (Array.isArray(params)) return params.map(bindValue);
  const out: Row = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    // 允许调用方带 : / @ / $ 前缀写键名，统一剥掉（node:sqlite 只认裸名）。
    out[k.replace(/^[:@$]/, '')] = bindValue(v);
  }
  return [out];
}

/** 同步小睡（WAL 切换重试用）。 */
function sleepMsSync(ms: number): void {
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
function enableWal(api: DbApi): void {
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

// ── 残留 -shm 自愈（Windows 实测）──────────────────────────────────────
//
// 现场：上一进程没走 sqlite3_close 就退出，留下 `-shm`（`-wal` 为 0 字节）；
// 新进程以读写方式打开时，SQLite 在恢复 wal-index 阶段要 truncate 这个 shm，
// 却拿到 `disk I/O error`（扩展码 1546 = SQLITE_IOERR_TRUNCATE，偶发 5386 =
// SQLITE_IOERR_SHMMAP）。库本身与 WAL 都是好的——把 shm 改名后立刻能打开。
//
// 策略（**只改名、不删除、只重试一次**）：
//   - shm 与 0 字节 wal 一律改名为 `<file>.stale-<时间戳>` 留档；wal 有内容时一个字节不碰
//     （那里面可能还有未 checkpoint 的已提交事务）；
//   - **rename 本身就是活性探针**：Windows 不允许改名仍被别的进程映射的文件，
//     活进程（serve / 另一条 CLI）持有时会 EBUSY → 判定为「不是残留」，不插手；
//   - 重试仍失败 → 抛出带路径 / errcode / 已改名文件的错误，而不是裸 disk I/O error。
const STALE_SHM_CODES = new Set([
  1546, // SQLITE_IOERR_TRUNCATE
  5386, // SQLITE_IOERR_SHMMAP
]);

/** 残留 shm / wal 的探测结果。 */
interface StaleShmInfo {
  shm: string;
  wal: string;
  walBytes: number;
}

/** 这个错误是不是「残留 shm 导致的打开失败」（扩展码优先，缺失时退回消息）。 */
export function isStaleShmError(err: any): boolean {
  const code = Number(err && err.errcode);
  if (STALE_SHM_CODES.has(code)) return true;
  if (Number.isFinite(code) && code !== 0) return false;
  return /disk I\/O error/i.test(String((err && err.message) || ''));
}

/** 当前库的 shm / wal 状态（不存在返回 null；`walBytes` 取不到时为 -1）。 */
function staleShmInfo(dbPath: string): StaleShmInfo | null {
  if (!dbPath || dbPath === ':memory:') return null;
  const shm = `${dbPath}-shm`;
  const wal = `${dbPath}-wal`;
  if (!existsSync(shm)) return null;
  let walBytes = 0;
  try {
    walBytes = existsSync(wal) ? statSync(wal).size : 0;
  } catch {
    walBytes = -1;
  }
  return { shm, wal, walBytes };
}

/**
 * 把残留的 `-shm`（必要时连同 0 字节 `-wal`）改名留档。
 * @returns {string[]} 改名后的路径；没有可改的返回空数组
 */
export function quarantineStaleShm(dbPath: string, atMs: number = Date.now()): string[] {
  const info = staleShmInfo(dbPath);
  if (!info) return [];
  const tag = stampFileTag(atMs);
  const renamed: string[] = [];
  renameSync(info.shm, `${info.shm}.stale-${tag}`);
  renamed.push(`${info.shm}.stale-${tag}`);
  if (info.walBytes === 0) {
    try {
      renameSync(info.wal, `${info.wal}.stale-${tag}`);
      renamed.push(`${info.wal}.stale-${tag}`);
    } catch {
      // 0 字节 wal 改名失败不影响重试：SQLite 会重建它。
    }
  }
  return renamed;
}

/**
 * 打开失败时尝试一次自愈。
 *
 * **rename 即活性探针**：活进程持有 shm 时 Windows 会拒绝改名（EBUSY / EACCES），
 * 这里把改名失败当成「不是残留、有人在用」→ 返回 null，绝不继续动刀。
 * @returns {string[]|null} null = 不适用（不是 shm 残留 / 有活进程持有）；数组 = 已改名并应重试
 */
export function healStaleShmOnce(dbPath: string, err: any): string[] | null {
  if (!isStaleShmError(err)) return null;
  if (!staleShmInfo(dbPath)) return null;
  try {
    return quarantineStaleShm(dbPath);
  } catch {
    return null;
  }
}

/** 打开失败的错误装饰：带上路径、errcode 与处置建议（不吞原始消息）。 */
function decorateOpenError(err: any, dbPath: string): AppError {
  if (err instanceof AppError) return err;
  const code = Number(err && err.errcode);
  const raw = String((err && err.message) || err || '未知错误');
  const hint = /unable to open database file/i.test(raw)
    ? '目录不可写 / 文件被占用 / 盘符不存在都会报这句'
    : '若是「另一个进程正在用这个库」，先停掉那个 serve 或改用 HTTP 领取（POST /api/localtasks/claim）';
  const e = new AppError(
    CODES.INTERNAL,
    `打开库失败: ${dbPath}（errcode=${Number.isFinite(code) ? code : '?'}）：${raw}\n${hint}。` +
      '残留 -shm 只会改名留档（*.stale-<时间戳>），不会删除任何库文件。',
    { path: dbPath, errcode: Number.isFinite(code) ? code : null }
  ) as AppError & { errcode?: number };
  e.name = 'StoreOpenError';
  if (Number.isFinite(code)) e.errcode = code;
  return e;
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
export function openRaw(dbPath: string, { readOnly = false, busyTimeoutMs = 5000 }: OpenRawOptions = {}): DbApi {
  if (!dbPath) throw new TypeError('openRaw(dbPath) 需要库文件路径');
  if (dbPath !== ':memory:' && !readOnly) mkdirSync(dirname(dbPath), { recursive: true });
  if (readOnly && dbPath !== ':memory:' && !existsSync(dbPath)) {
    // 只读打开**不会**创建文件，SQLite 只会抛 "unable to open database file" ——
    // 那句话指不出真因（"库还没建"），所以在驱动层就换成能指路的错误。
    throw badInput(`库文件不存在: ${dbPath}（只读打开不会创建它）`);
  }

  /** 一次完整的「打开 + 连接级 PRAGMA」；失败时先关掉半成品再抛。 */
  const openOnce = (): DbApi => {
    let raw: any;
    try {
      raw = new SqliteCtor(dbPath, readOnly ? { readOnly: true } : {});
    } catch (err) {
      throw mapSqliteError(err);
    }

    const stmts = new Map<string, any>();
    let closed = false;

    const api: DbApi = {
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
      exec(sql: string): void {
        try {
          raw.exec(sql);
        } catch (err) {
          throw mapSqliteError(err);
        }
      },

      /** 预编译（带缓存）。返回 StatementSync 的薄封装。 */
      prepare(sql: string): any {
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
      get(sql: string, params?: unknown): any {
        try {
          return plain(api.prepare(sql).get(...argsOf(params)));
        } catch (err) {
          throw mapSqliteError(err);
        }
      },

      /** 取全部行（每行都是普通对象）。 */
      all(sql: string, params?: unknown): Row[] {
        try {
          return api.prepare(sql).all(...argsOf(params)).map(plain) as Row[];
        } catch (err) {
          throw mapSqliteError(err);
        }
      },

      /** 执行写语句 → `{ changes, lastInsertRowid }`（数字，不是 bigint）。 */
      run(sql: string, params?: unknown): RunResult {
        try {
          const r = api.prepare(sql).run(...argsOf(params));
          return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
        } catch (err) {
          throw mapSqliteError(err);
        }
      },

      /** 取一个标量（第一列第一行）；没有行返回 `null`。 */
      scalar(sql: string, params?: unknown): any {
        const row = api.get(sql, params);
        if (!row) return null;
        const keys = Object.keys(row);
        const first = keys[0];
        return first === undefined ? null : row[first];
      },

      /** 关连接（幂等）。**测试删库前必须先关**：Windows 上连接开着会 EBUSY。 */
      close(): void {
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
    try {
      api.exec('PRAGMA busy_timeout = ' + waitMs);
      api.exec('PRAGMA foreign_keys = ON');
      api.exec('PRAGMA synchronous = NORMAL');
      if (!readOnly) enableWal(api);
    } catch (err) {
      // 关键：先把本进程的映射关掉，否则 Windows 不允许后面改名 shm。
      try {
        raw.close();
      } catch {
        /* 半成品连接关不掉也继续：下面按原始错误处理 */
      }
      throw mapSqliteError(err);
    }

    return api;
  };

  try {
    return openOnce();
  } catch (err) {
    const renamed = readOnly ? null : healStaleShmOnce(dbPath, err);
    if (!renamed || renamed.length === 0) throw decorateOpenError(err, dbPath);
    try {
      return openOnce();
    } catch (err2) {
      throw decorateOpenError(err2, dbPath);
    }
  }
}
