// repos 域仓储的连接管理（打开 / reset / 事务入口）。
//
// 与 localtask/repo/open.js 同一模式（T03 定下的形状）：
//
// **repo 的每个公开函数都经这里的 db()/txw() 拿连接** —— 自动打开库（必要时
// 建表/迁移/导入 legacy JSON）。reset 后的第一次读写也正常（SQLite 时代
// reset 是「关连接 + 删库文件」，顺序错一步就是 Windows EBUSY 或读到旧库）。
//
// 测试与多实例的环境约定（与 JSON 时代同一批变量，语义顺延）：
//   NX_KV_DB                库文件路径（core/paths 的全局约定，最优先）
//   NX_KV_REPOS_STORE       JSON 时代指向 `<dir>/repos.json`；现在映射为
//                           `<dir>/nxkv.db`，legacy JSON 导入也以 `<dir>` 为
//                           home —— 约 20 个既有测试文件靠它隔离
//
// 为什么与 localtask 共用同一个进程级单例（core/db 的 singleton）：库只有
// 一个（nxkv.db），两条 open 路径解析出同一个文件时必须复用同一条连接，
// 否则就是自己跟自己抢 SQLITE_BUSY。
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openStore, getDb, closeDb, isStoreOpen, tx } from '../../../core/db/index.js';
import { checkNodeVersion } from '../../../core/db/version.js';
import type { DbApi } from '../../../core/db/driver.js';
import type { TxOptions } from '../../../core/db/tx.js';

let openedFor: string | null | undefined = null;

/** resolveReposDb 的返回形状：库路径与 legacy 目录都可能缺省（走全局约定）。 */
export interface ReposDbTarget {
  path: string | undefined;
  appDir: string | undefined;
  explicit: boolean;
}

/** 按当前环境解析库路径与 legacy 目录（每次现取 —— 测试会在用例间改 env）。 */
export function resolveReposDb(): ReposDbTarget {
  const rsStore = process.env.NX_KV_REPOS_STORE || '';
  const explicit = !!(rsStore || process.env.NX_KV_DB);
  if (rsStore) {
    const dir = dirname(rsStore);
    return { path: process.env.NX_KV_DB || join(dir, 'nxkv.db'), appDir: dir, explicit };
  }
  // 没有 env 覆盖：缺省落到 APP_DIR/nxkv.db，但**不主动换连接** ——
  // 进程里已有连接（比如 localtask 先开的，指向自己的测试目录）时必须复用，
  // 否则读路径会静默换到真实 ~/.nx-kv 的库上（localtask-stale 类用例就是这么红的）。
  return { path: process.env.NX_KV_DB || undefined, appDir: undefined, explicit };
}

/** 打开（或复用）连接；env 指定了另一个库（测试中途换目录）→ 关旧连接、开新库。 */
export function openReposStore(): DbApi {
  const check = checkNodeVersion();
  if (!check.ok) throw new Error(check.message);
  if (isStoreOpen()) {
    const target = resolveReposDb();
    // 无显式覆盖，或目标就是本模块上次打开的那个 → 复用（库只有一个，单例共享）
    if (!target.explicit || openedFor === target.path) return getDb();
    closeDb();
  }
  const target = resolveReposDb();
  openStore({ path: target.path, appDir: target.appDir, importLegacyData: true });
  openedFor = target.path;
  return getDb();
}

/** 当前连接（自动打开）。repo 内部一律用这个，不要直接拿 core/db 的 getDb。 */
export function db(): DbApi {
  return openReposStore();
}

/** 事务入口（自动打开；嵌套自动 SAVEPOINT —— 见 core/db/tx.js）。 */
export function txw<T>(fn: (conn: DbApi) => T, opts: TxOptions = {}): T {
  openReposStore();
  return tx(fn, opts);
}

/**
 * 测试 reset：关连接 + 删库文件（含 -wal/-shm），下次 open 重建空库。
 * JSON 时代测试删的是 `repos.json`；现在删的是这个。
 * **生产代码不要调**（它会把库清空）。
 */
export function resetReposStore(): void {
  const target = resolveReposDb();
  closeDb();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      rmSync(String(target.path) + suffix, { force: true });
    } catch {
      /* Windows 偶发句柄残留：留给下一次 */
    }
  }
  openedFor = null;
}

export { getDb, closeDb, isStoreOpen };
