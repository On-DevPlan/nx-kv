// templates 仓储的连接管理（打开 / reset / 事务入口）。
//
// 与 repos/repo/open.js 同一模式（T05/T06 定下的形状）：
//   - repo 的每个公开函数都经这里的 db()/txw() 拿连接（自动打开库）；
//   - templates 域**没有**独立的存储文件（JSON 时代的 templates.json 已消失），
//     库就是进程共享的那一个 nxkv.db，路径由 NX_KV_DB / NX_KV_HOME 决定；
//   - **无 env 覆盖时必须复用进程内已开的连接**：localtask / repos / config 都
//     可能先打开了库（各指自己的测试目录），这里再关了重开 = 读路径静默换库
//     （T05 在 repos/repo/open.js 踩过的坑，不要再写一遍）。
import { rmSync } from 'node:fs';
import { openStore, getDb, closeDb, isStoreOpen, tx } from '../../../core/db/index.js';
import { checkNodeVersion } from '../../../core/db/version.js';

let openedFor = null;

/** 按当前环境解析库路径（每次现取 —— 测试会在用例间改 NX_KV_DB）。 */
export function resolveTemplatesDb() {
  const path = process.env.NX_KV_DB || undefined;
  return { path, appDir: path ? undefined : undefined, explicit: !!process.env.NX_KV_DB };
}

/** 打开（或复用）连接；env 显式指定了另一个库 → 关旧连接、开新库。 */
export function openTemplatesStore() {
  const check = checkNodeVersion();
  if (!check.ok) throw new Error(check.message);
  if (isStoreOpen()) {
    const target = resolveTemplatesDb();
    if (!target.explicit || openedFor === target.path) return getDb();
    closeDb();
  }
  const target = resolveTemplatesDb();
  openStore({ path: target.path, importLegacyData: true });
  openedFor = target.path;
  return getDb();
}

/** 当前连接（自动打开）。repo 内部一律用这个。 */
export function db() {
  return openTemplatesStore();
}

/** 事务入口（自动打开；嵌套自动 SAVEPOINT —— 见 core/db/tx.js）。 */
export function txw(fn, opts = {}) {
  openTemplatesStore();
  return tx(fn, opts);
}

/**
 * 测试 reset：关连接 + 删库文件。**生产代码不要调**（它会把库清空）。
 */
export function resetTemplatesStore() {
  const path = process.env.NX_KV_DB;
  closeDb();
  if (!path) return;
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      rmSync(path + suffix, { force: true });
    } catch {
      /* Windows 偶发句柄残留：留给下一次 */
    }
  }
  openedFor = null;
}

export { getDb, closeDb, isStoreOpen };
