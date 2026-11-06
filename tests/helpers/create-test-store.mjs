// 测试夹具：临时库 + 建好 schema 的连接。
//
// 为什么要这个夹具（而不是每个测试自己写 NX_KV_DB）：
//   ① **不能写用户真实库**。`~/.nx-kv/nxkv.db` 里是用户几个月的任务历史，
//      测试写进去一次就再也分不清哪些数据是真的。所以这里有一条硬保险：
//      库路径不在 `os.tmpdir()` 下面 → 直接抛错，绝不放行（设计文档 R12/R13）。
//   ② Windows 上「连接还开着就 rmSync」必报 EBUSY，而且错误会在**下一个**测试里
//      以"数据不对"的形式出现。所以删目录只能通过 `reset()`（先 closeDb 再删）。
//
// 用法：
//   const store = await createTestStore();            // 建空库（schema 就绪）
//   store.db.run('INSERT …');
//   store.seedLegacy({ localtasks: {...} });          // 放 legacy JSON
//   store.reset();                                    // 关连接 + 删临时目录
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 硬保险：只允许在系统临时目录里建库。
 *
 * 这条检查的价值不是"防手滑"，而是防「夹具改错一处 → 测试污染用户真实数据」——
 * 那是这类改造里最坏的失败模式（测试全绿、数据已经没了）。
 *
 * @param {string} p 库路径
 * @returns {string} 绝对路径
 */
export function assertUnderTmp(p) {
  const target = resolve(p);
  const root = resolve(tmpdir());
  const rel = relative(root, target);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return target;
  throw new Error(
    `拒绝在非临时目录建库：${target}\n` +
      `测试库必须落在 ${root} 下（这条检查防止测试写进用户的 ~/.nx-kv）`
  );
}

/**
 * 建一个临时 store。
 *
 * @param {object} [opts]
 * @param {boolean} [opts.open=true]          是否立刻打开
 * @param {boolean} [opts.bootstrap=true]     打开时是否执行 bootstrap（建表/升级）
 * @param {boolean} [opts.importLegacy=true]  打开时是否允许导入 legacy JSON
 * @returns {Promise<object>} store 句柄
 */
export async function createTestStore({ open = true, bootstrap = true, importLegacy = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nx-kv-dbtest-'));
  const dbPath = assertUnderTmp(join(dir, 'nxkv.db'));
  const appDir = join(dir, 'home');
  mkdirSync(appDir, { recursive: true });

  // 动态 import：这些模块在 import 时读环境算 APP_DIR，而测试要在 import 之前
  // 把路径指到临时目录。生产代码不该为了测试改结构，所以这里用动态 import。
  const core = await import('../../src/core/db/index.js');

  const handle = {
    dir,
    dbPath,
    appDir,
    db: null,
    core,
    /** 子进程（CLI）要用的环境变量：整份数据都在临时目录里。 */
    env(extra = {}) {
      return { ...process.env, NX_KV_HOME: appDir, NX_KV_DB: dbPath, ...extra };
    },
    /** 打开连接（默认走 bootstrap：建表 + 迁移）。 */
    open(opts = {}) {
      handle.db = bootstrap
        ? core.openStore({ path: dbPath, appDir, importLegacyData: importLegacy, ...opts })
        : core.openRaw(dbPath, opts);
      return handle.db;
    },
    /** 往临时 home 里写 legacy JSON（参数：{ localtasks, repos, config, timegoals, templates }）。 */
    seedLegacy(files = {}) {
      for (const [kind, data] of Object.entries(files)) {
        writeFileSync(join(appDir, `${kind}.json`), JSON.stringify(data, null, 2), 'utf8');
      }
    },
    /** 往临时 home 里写一份 docs 树（参数：{ 'repo/a/b.md': '# 内容' }）。 */
    seedDocs(tree = {}) {
      const root = join(appDir, 'docs');
      for (const [rel, text] of Object.entries(tree)) {
        const p = join(root, ...rel.split('/'));
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, text, 'utf8');
      }
    },
    /**
     * 把 `tests/fixtures/<name>/` 里的整棵树拷进临时 home。
     * @param {string} [name='legacy-json']
     */
    seedFixtureDir(name = 'legacy-json') {
      const src = fileURLToPath(new URL(`../fixtures/${name}/`, import.meta.url));
      for (const entry of readdirSync(src)) {
        cpSync(join(src, entry), join(appDir, entry), { recursive: true });
      }
      return appDir;
    },
    /** 关连接 + 删临时目录（幂等）。**必须用它清场**，别自己 rmSync。 */
    reset() {
      try {
        core.closeDb();
      } catch {
        /* 已经关了 */
      }
      handle.db = null;
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      } catch (err) {
        // 删不掉（Windows 偶发句柄未释放）不该让测试失败在收尾上，
        // 但要让它可见：临时目录残留会累积。
        if (process.env.NX_KV_TEST_VERBOSE) console.error('[createTestStore] 清理失败:', err.message);
      }
    },
  };

  if (open) handle.open();
  return handle;
}

/** 把某份 fixture 的 JSON 数据读出来（不落盘），方便测试里改写后再 seedLegacy。 */
export function readFixtureJson(name) {
  const p = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(p, 'utf8'));
}
