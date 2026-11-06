// 同步事务。
//
// ── 这个文件存在的唯一理由：把「async 事务」这个静默丢写的坑堵死 ──────
//
// `node:sqlite` 是**同步** API。事务的正确形态是：
//     BEGIN IMMEDIATE …（同步的写）… COMMIT
// 一旦有人写成 `tx(async () => { await fetch(...); db.run(写入) })`：
//   - `fn` 返回 Promise，`tx` 立刻 `COMMIT`（因为同步代码已经跑完）；
//   - 那个 `await` 之后的写入落在**事务外**，一个个自动提交；
//   - 更糟的是：如果中途抛错，`ROLLBACK` 早已执行过，后面的写入照样提交。
// 结果 = **一半进去、一半没进去，而且不报错**。这是本轮改造的头号风险（R4）。
//
// 所以：`tx()` 检测到返回 Promise 就抛 `TypeError`，一个都不放过。
// 需要异步 I/O（git / fs / 网络 / notify）时：**事务外取，事务内写**。
//
// 另外两条同样重要的：
//   1. 锁必须拿在 `BEGIN IMMEDIATE` 上（不是 `BEGIN`）—— 两个进程同时首启
//      只能有一个真正迁移；先读版本再锁 = TOCTOU。
//   2. 嵌套调用自动降级为 `SAVEPOINT`（深度计数），这样「一个 service 函数 =
//      一个顶层事务」与「repo 方法内部自开事务」可以共存而不互相提交。
import { isBusyError } from './errors.js';

/** 当前进程的默认连接（由 bootstrap 在打开库之后装进来）。 */
let defaultDb = null;

/** 由 bootstrap 调用：登记进程级默认连接。 */
export function setDefaultDb(db) {
  defaultDb = db;
}

/** 清掉默认连接（closeDb / 测试用）。 */
export function resetDefaultDb() {
  defaultDb = null;
}

/** 取默认连接；没有就报一条能指路的错（而不是 `Cannot read properties of null`）。 */
export function currentDb() {
  if (!defaultDb) {
    throw new Error('数据库尚未打开：先调 core/db 的 openStore()（或 nx-kv db status）');
  }
  return defaultDb;
}

/** 有没有默认连接（不抛）。 */
export function hasDefaultDb() {
  return !!defaultDb;
}

// 事务深度按连接记（WeakMap：连接被回收时自动清理）。
const states = new WeakMap();

function stateOf(db) {
  let st = states.get(db);
  if (!st) {
    st = { depth: 0 };
    states.set(db, st);
  }
  return st;
}

/** 当前连接的事务深度（0 = 不在事务里）。测试用来断言「事务真的关掉了」。 */
export function txDepth(db = defaultDb) {
  if (!db) return 0;
  return stateOf(db).depth;
}

function isThenable(v) {
  return !!v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
}

/** 同步睡（BUSY 退避用）。CLI 里没有并发任务要跑，阻塞事件循环可接受。 */
function sleepSync(ms) {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, Math.max(0, ms));
}

const SYNC_ONLY_MESSAGE =
  '事务体必须是同步函数：tx(fn) 检测到 fn 返回 Promise。\n' +
  '原因：node:sqlite 是同步 API，第一个 await 之后 COMMIT 已执行，' +
  '后续写入会落到事务外且不报错（静默丢写）。\n' +
  '做法：异步 I/O（git / fs / 网络 / notify）放在事务外，事务内只写库。';

/**
 * 在一个同步事务里跑 `fn`。
 *
 * @template T
 * @param {(db: object) => T} fn 事务体，**必须同步**（返回 Promise 立即抛 TypeError）
 * @param {object} [opts]
 * @param {'IMMEDIATE'|'DEFERRED'|'EXCLUSIVE'} [opts.mode='IMMEDIATE'] 顶层事务模式
 * @param {number} [opts.retries=3] SQLITE_BUSY 退避重试次数（只对顶层生效）
 * @param {object} [opts.db] 连接（缺省用默认连接）
 * @param {boolean} [opts.rollback=false] 收尾 `ROLLBACK` 而不是 `COMMIT`（`--dry-run` 用）
 * @returns {T}
 */
export function tx(fn, { mode = 'IMMEDIATE', retries = 3, db = null, rollback = false } = {}) {
  if (typeof fn !== 'function') throw new TypeError('tx(fn) 需要一个函数');
  const conn = db || currentDb();
  const st = stateOf(conn);

  // 嵌套：SAVEPOINT（`rollback` 在嵌套层无意义，忽略）
  if (st.depth > 0) return runSavepoint(conn, st, fn);

  let attempt = 0;
  for (;;) {
    try {
      return runTop(conn, st, mode, fn, rollback);
    } catch (err) {
      // BUSY 只重试顶层：BEGIN 会等 busy_timeout，等不到再退避重试几次。
      if (isBusyError(err) && attempt < Math.max(0, Number(retries) || 0)) {
        attempt += 1;
        sleepSync(25 * attempt);
        continue;
      }
      throw err;
    }
  }
}

function runTop(conn, st, mode, fn, rollback) {
  const m = String(mode || 'IMMEDIATE').toUpperCase();
  const begin = m === 'DEFERRED' || m === 'EXCLUSIVE' ? m : 'IMMEDIATE';
  conn.exec('BEGIN ' + begin);
  st.depth = 1;
  let out;
  try {
    out = fn(conn);
    if (isThenable(out)) {
      // 吞掉那个 Promise 的后续异常：它已经不属于任何事务，抛出来只会变成
      // unhandledRejection 噪音（真因由下面这条 TypeError 说明）。
      try {
        out.catch(() => {});
      } catch {
        /* 非标准 thenable，忽略 */
      }
      throw new TypeError(SYNC_ONLY_MESSAGE);
    }
  } catch (err) {
    st.depth = 0;
    try {
      conn.exec('ROLLBACK');
    } catch {
      /* 事务可能已被 SQLite 自己回滚（如某些约束错误），忽略 */
    }
    throw err;
  }
  st.depth = 0;
  try {
    conn.exec(rollback ? 'ROLLBACK' : 'COMMIT');
  } catch (err) {
    try {
      conn.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  return out;
}

function runSavepoint(conn, st, fn) {
  const name = 'sp_' + st.depth;
  conn.exec('SAVEPOINT ' + name);
  st.depth += 1;
  let out;
  try {
    out = fn(conn);
    if (isThenable(out)) {
      try {
        out.catch(() => {});
      } catch {
        /* ignore */
      }
      throw new TypeError(SYNC_ONLY_MESSAGE);
    }
  } catch (err) {
    st.depth -= 1;
    try {
      conn.exec('ROLLBACK TO ' + name);
      conn.exec('RELEASE ' + name);
    } catch {
      /* ignore */
    }
    throw err;
  }
  st.depth -= 1;
  conn.exec('RELEASE ' + name);
  return out;
}
