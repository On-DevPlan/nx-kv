// localtask 仓储的连接管理（打开 / reset / 事务入口）。
//
// **repo 的每个公开函数都经这里的 db()/txw() 拿连接** —— 它们会自动打开库
// （必要时建表/迁移/导入 legacy JSON）。这消掉一整类错误：「连接没开就查」
// 不会发生，reset 后的第一次读写也正常（JSON 时代 reset 只是删文件，SQLite
// 时代必须关连接+删库文件，顺序错一步就是 EBUSY 或读到旧库）。
//
// 测试与多实例的环境约定（与 JSON 时代同一批变量，语义顺延）：
//   NX_KV_DB                    库文件路径（core/paths 的全局约定，最优先）
//   NX_KV_LOCALTASK_STORE       JSON 时代指向 `<dir>/localtasks.json`；
//                               现在映射为 `<dir>/nxkv.db`，legacy JSON 导入也以
//                               `<dir>` 为 home —— 约 25 个既有测试文件靠它隔离
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openStore, getDb, closeDb, isStoreOpen, tx } from '../../../core/db/index.js';
import { checkNodeVersion } from '../../../core/db/version.js';

let openedFor = null;

/** 按当前环境解析库路径与 legacy 目录（每次现取 —— 测试会在用例间改 env）。 */
export function resolveLocaltaskDb() {
  const ltStore = process.env.NX_KV_LOCALTASK_STORE || '';
  if (ltStore) {
    const dir = dirname(ltStore);
    return { path: process.env.NX_KV_DB || join(dir, 'nxkv.db'), appDir: dir };
  }
  return { path: process.env.NX_KV_DB || undefined, appDir: undefined };
}

/** 打开（或复用）连接；env 变了（测试中途换目录）→ 关旧连接、开新库。 */
export function openLocaltaskStore() {
  const check = checkNodeVersion();
  if (!check.ok) throw new Error(check.message);
  const target = resolveLocaltaskDb();
  if (isStoreOpen() && openedFor === target.path) return getDb();
  if (isStoreOpen()) closeDb();
  openStore({ path: target.path, appDir: target.appDir, importLegacyData: true });
  openedFor = target.path;
  return getDb();
}

/** 当前连接（自动打开）。repo 内部一律用这个，不要直接拿 core/db 的 getDb。 */
export function db() {
  return openLocaltaskStore();
}

/** 事务入口（自动打开；嵌套自动 SAVEPOINT —— 见 core/db/tx.js）。 */
export function txw(fn, opts = {}) {
  openLocaltaskStore();
  return tx(fn, opts);
}

/**
 * 测试 reset：关连接 + 删库文件（含 -wal/-shm），下次 open 重建空库。
 * JSON 时代测试删的是 `localtasks.json`；现在删的是这个。
 * **生产代码不要调**（它会把库清空）。
 */
export function resetLocaltaskStore() {
  console.error('[DBG resetLocaltaskStore] called');

  const target = resolveLocaltaskDb();
  closeDb();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      rmSync(target.path + suffix, { force: true });
    } catch {
      /* Windows 偶发句柄残留：留给下一次 */
    }
  }
  openedFor = null;
}

export { getDb };
