// core/json-store.js —— JSON 文件存储的**统一原语**（任务 #66 存储层隔离）。
//
// 为什么存在：迁 SQLite 之前先把「代码层面」收口。此前的现状是同一条
// 「串行写队列 + tmp+rename 原子写 + Windows EPERM/EACCES 退避」被复制了 6 份
// （localtask / repos / timegoal / templates / docs / config），每份措辞略有出入——
// 收口之后：
//   1. 行为只有一份，修一处全体生效；
//   2. SQLite 迁移时只需给这层换 driver（load/save/mutate 三个动作就是 driver 面），
//      业务模块的调用点一行不改。
//
// 接口刻意贴 SQLite 的形态：
//   load()            → 读（缺失/损坏回落 empty；可选 legacy 兜底、mtime 缓存、损坏隔离）
//   save(data)        → 写（进程内串行 + 原子落盘；SQLite 下 = 一个 UPSERT 事务）
//   mutate(fn)        → 读-改-写（fn 抛错不落盘；SQLite 下 = 一个事务）
//
// 边界（有意不收进来的）：
//   - docs/ 文档树与附件仓是**文件形态的真相源**（用户可读 / 二进制），不迁 SQLite，
//     不强行套这层；docs/store.js 的 queuedWrite 继续自持。
//   - config.js 带 explicitPath 参数与 mtime 缓存语义，属单例小数据——是否迁 SQLite
//     待定，暂不接入（接入需为每次显式路径建实例，收益为负）。
import fsp from 'node:fs/promises';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

// Windows 上目标文件可能被并发读者或杀软短暂锁住，rename 偶发 EPERM/EACCES——
// 小退避重试几次即可（跨进程并发写仍靠 rename 原子性 last-writer-wins 兜底）。
const RENAME_RETRY = 4;
const backoff = (i) => new Promise((r) => setTimeout(r, 25 * (i + 1)));

async function renameWithRetry(tmp, p) {
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(tmp, p);
      return;
    } catch (err) {
      if (i >= RENAME_RETRY || (err.code !== 'EPERM' && err.code !== 'EACCES')) throw err;
      await backoff(i);
    }
  }
}

/** 原子写一段文本（JSON 之外的文件也用它；tmp + rename + 锁退避）。 */
export async function atomicWriteText(p, text) {
  await fsp.mkdir(dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, text, 'utf8');
  await renameWithRetry(tmp, p);
}

/**
 * 同步版原子写（**只在必须同步的钩子里用**——如 process.on('exit')，异步写根本
 * 来不及落盘）。没有重试：锁冲突时由调用方的 catch 兜底，宁可这次没写上，
 * 也不能留下半个 tmp 冒充正身。
 */
export function atomicWriteTextSync(p, text, { mkdirp = true } = {}) {
  if (mkdirp) mkdirSync(dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, p);
}

// 损坏隔离的时间戳（定宽：字典序即时间序）
function corruptStamp() {
  const ts = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    String(ts.getFullYear()) +
    pad(ts.getMonth() + 1) +
    pad(ts.getDate()) +
    '-' +
    pad(ts.getHours()) +
    pad(ts.getMinutes()) +
    pad(ts.getSeconds()) +
    '-' +
    pad(ts.getMilliseconds(), 3)
  );
}

/**
 * 建一个 JSON 文件 store。
 *
 * @param {object} o
 * @param {() => string} o.path           存储路径（**每次调用现取**——测试靠改 env 换路径）
 * @param {() => object} [o.empty]        缺失/损坏时的返回值工厂（不给 = {}）
 * @param {(data: object) => object|null} [o.normalize]
 *   解析后的整形（白名单重建 / 版本迁移）。返回 null = 「JSON 合法但不认识」→ 落 empty，
 *   **不做损坏隔离**（那是「形状不认识」，不是「文件坏了」）；normalize 抛错 = 损坏。
 * @param {() => string|null} [o.legacyPath] 主文件 ENOENT 时的兜底读取（改名前旧文件）
 * @param {number} [o.quarantineKeep=0]   >0：解析失败时把坏文件改名 `.corrupt-<时间戳>`
 *   保留 N 份（超出删最旧）——防止下次 save 把坏文件原地覆盖、数据无声清零。
 * @param {boolean} [o.cache=false]       mtime 缓存（配置类单例用；业务 store 不用）
 */
export function createJsonStore({
  path: pathOf,
  empty,
  normalize,
  legacyPath,
  quarantineKeep = 0,
  cache = false,
} = {}) {
  if (typeof pathOf !== 'function') throw new TypeError('createJsonStore: path 必须是 () => string');
  const emptyOf = typeof empty === 'function' ? empty : () => ({});
  const shape = typeof normalize === 'function' ? normalize : (d) => (d && typeof d === 'object' ? d : null);

  // 同进程串行写队列：并发写共用同一个 .tmp，不排队会互相吃掉对方的 rename 源
  let queue = Promise.resolve();
  let cacheVal = null;
  let cacheMtime = -1;

  async function quarantine(p) {
    try {
      await fsp.access(p);
    } catch {
      return; // 文件不存在（或探不到）→ 不是「损坏」，不备份
    }
    try {
      await fsp.rename(p, `${p}.corrupt-${corruptStamp()}`);
    } catch {
      return; // 改名失败（Windows 偶发文件锁）→ 保留原文件等下次，绝不吞掉坏文件
    }
    try {
      const dir = dirname(p);
      const prefix = basename(p) + '.corrupt-';
      const corrupts = (await fsp.readdir(dir)).filter((f) => f.startsWith(prefix)).sort();
      for (const f of corrupts.slice(0, Math.max(0, corrupts.length - quarantineKeep))) {
        await fsp.rm(`${dir}/${f}`, { force: true });
      }
    } catch {
      /* 备份清理失败不影响主流程 */
    }
  }

  function cached(val, mtime) {
    cacheVal = val;
    cacheMtime = mtime;
    return val;
  }

  async function load() {
    const p = pathOf();
    if (cache) {
      try {
        const st = await fsp.stat(p);
        if (cacheVal && cacheMtime === st.mtimeMs) return cacheVal;
      } catch {
        /* stat 失败 → 走完整读取（缺失/损坏在下面统一处理） */
      }
    }
    let raw = null;
    try {
      raw = await fsp.readFile(p, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT' && typeof legacyPath === 'function') {
        const lp = legacyPath();
        if (lp) {
          try {
            raw = await fsp.readFile(lp, 'utf8');
          } catch {
            raw = null;
          }
        }
      }
      if (raw === null) return cache ? cached(emptyOf(), -1) : emptyOf();
    }
    let data = null;
    let corrupt = false;
    try {
      data = JSON.parse(raw);
    } catch {
      corrupt = true;
    }
    if (!corrupt) {
      try {
        data = shape(data);
      } catch {
        corrupt = true;
      }
    }
    if (corrupt) {
      if (quarantineKeep > 0) await quarantine(p);
      return cache ? cached(emptyOf(), -1) : emptyOf();
    }
    if (data === null || data === undefined) return emptyOf(); // 形状不认识 ≠ 文件损坏
    if (cache) {
      const st = await fsp.stat(p).catch(() => null);
      return cached(data, st ? st.mtimeMs : -1);
    }
    return data;
  }

  function save(data) {
    const run = queue.then(async () => {
      await atomicWriteText(pathOf(), JSON.stringify(data, null, 2));
      if (cache) {
        try {
          cacheVal = data;
          cacheMtime = (await fsp.stat(pathOf())).mtimeMs;
        } catch {
          cacheVal = data;
          cacheMtime = -1;
        }
      }
    });
    queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async function mutate(fn) {
    const cur = structuredClone(await load());
    const out = fn(cur);
    await save(cur);
    return out;
  }

  return { load, save, mutate, path: pathOf };
}
