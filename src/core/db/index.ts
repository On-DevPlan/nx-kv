// core/db 的门面：进程级单例 + 便捷再导出。
//
// 上层（repo / service / 测试）只认这里的四个函数：
//   openStore()  首次调用执行 bootstrap（探测 → 建表/导入/升级），之后返回同一个连接
//   getDb()      拿当前连接（没开就开）
//   closeDb()    关连接 + 清单例（**测试删库前必须先调**：Windows 上连接开着会 EBUSY）
//   dbPath()     库文件路径（每次现取 —— 测试靠改 NX_KV_DB 换路径）
//
// 为什么是**进程级单例**：SQLite 的写锁是"一个连接一个事务"，同一进程里开两条
// 连接去写同一份库，等于自己跟自己抢锁（`SQLITE_BUSY`）。多进程并发靠 WAL +
// busy_timeout，进程内一律共用一条连接。
import { dbPathFromEnv, defaultStoreTarget } from '../paths.js';
import { openAndBootstrap, inspectStore } from './bootstrap.js';
import { currentDb, hasDefaultDb, setDefaultDb, resetDefaultDb, tx, txDepth } from './tx.js';
import type { DbApi } from './driver.js';
import type { BootstrapResult, StoreState } from './bootstrap.js';

/** 进程级单例：连接 + 上次 bootstrap 的结果 + 打开前是否已有内容。 */
interface Singleton {
  db: DbApi;
  result: BootstrapResult;
  existedBefore: boolean;
}

/** openStore 的选项。 */
export interface OpenStoreOptions {
  /** 库路径（缺省 `dbPath()`）。 */
  path?: string;
  /** legacy 数据目录（缺省 `APP_DIR`）。 */
  appDir?: string;
  /** 是否执行 JSON 导入。 */
  importLegacyData?: boolean;
  /** 收尾回滚（演练用）。 */
  dryRun?: boolean;
  /** 只读连接（不建表、不升级）。 */
  readOnly?: boolean;
  /** 时刻兜底。 */
  atMs?: number;
}

/** 当前单例。 */
let singleton: Singleton | null = null;
/** 当前单例是按哪个目标打开的（env 换库检测用）。 */
let openedForTarget: { path: string; appDir: string | undefined } | null = null;

/** 库文件路径（`NX_KV_DB` 优先，否则 `APP_DIR/nxkv.db`）。**每次现取**。 */
export function dbPath(): string {
  return dbPathFromEnv();
}

/**
 * 打开（或复用）进程级连接，必要时完成建表 / 导入 / 升级。
 *
 * @param {object} [opts]
 * @param {string} [opts.path]           库路径（缺省 `dbPath()`）
 * @param {string} [opts.appDir]         legacy 数据目录（缺省 `APP_DIR`）
 * @param {boolean} [opts.importLegacyData=true] 是否执行 JSON 导入
 * @param {boolean} [opts.dryRun=false]  收尾回滚（演练用）
 * @param {boolean} [opts.readOnly=false] 只读连接（不建表、不升级）
 * @returns {object} 连接
 */
export function openStore(opts: OpenStoreOptions = {}): DbApi {
  const target = opts.path
    ? { path: opts.path, appDir: opts.appDir }
    : { path: dbPathFromEnv(), appDir: defaultStoreTarget().appDir };
  if (singleton && !singleton.db.closed) {
    // env 指向了另一个库（测试中途换目录 / legacy env 切换）→ 关旧开新。
    // 这是「读路径静默换库」的统一防线：任何裸调 openStore() 的调用方
    //（config / templates / core 内部）都自动获得同一语义。
    if (
      !opts.path &&
      openedForTarget &&
      (openedForTarget.path !== target.path || (openedForTarget.appDir || '') !== (target.appDir || ''))
    ) {
      closeDb();
    } else {
      return singleton.db;
    }
  }
  const appDir = opts.appDir || target.appDir;
  const { db, result, existedBefore } = openAndBootstrap({
    path: target.path,
    appDir,
    importLegacyData: opts.importLegacyData !== false,
    dryRun: opts.dryRun === true,
    readOnly: opts.readOnly === true,
    atMs: opts.atMs,
  });
  singleton = { db, result, existedBefore };
  openedForTarget = { path: target.path, appDir };
  setDefaultDb(db);
  return db;
}

/** 当前连接（没开就开）。 */
export function getDb(): DbApi {
  if (singleton && !singleton.db.closed) return singleton.db;
  return openStore();
}

/** 上一次 bootstrap 的结果（CLI 渲染"建库 / 导入 / 升级"用）。 */
export function getBootstrapResult(): BootstrapResult | null {
  return singleton ? singleton.result : null;
}

/** 有没有已在使用的连接。 */
export function isStoreOpen(): boolean {
  return !!(singleton && !singleton.db.closed);
}

/**
 * 关连接并清单例。
 * 测试删库文件之前必须调它 —— 否则 Windows 上 `rmSync` 必报 EBUSY，
 * 而错误会在**下一个**测试里以"库文件已存在 / 数据不对"的形式出现。
 */
export function closeDb(): void {
  if (singleton) {
    try {
      singleton.db.close();
    } finally {
      singleton = null;
    }
  }
  openedForTarget = null;
  resetDefaultDb();
}

/** 测试用：等价于 closeDb()（名字表明意图，防止生产代码顺手调用）。 */
export function resetDbForTests(): void {
  closeDb();
}

/** 库状态快照（只读；`db status` 用）。 */
export function storeStatus(): StoreState {
  const db = getDb();
  return inspectStore(db);
}

// 便捷再导出：上层不必同时记三个文件路径。
export { tx, currentDb, hasDefaultDb, txDepth };
export { inspectStore } from './bootstrap.js';
export { openRaw, bindValue } from './driver.js';
export { CURRENT_SCHEMA_VERSION, REQUIRED_NODE_VERSION, checkNodeVersion } from './version.js';
export { StoreMigrationError, StoreTooNewError, NotNxKvStoreError } from './errors.js';
export { verifyStore, tableCounts, statusDistribution, findLegacyLocalTasks } from './verify.js';
export { topicKeyOf, GLOBAL_TOPIC_KEY } from '../topic-key.js';
export { nowMs, parseStampMs, parseIsoMs, msToStamp, stampFileTag } from './time.js';
