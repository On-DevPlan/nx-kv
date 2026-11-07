// core/atomic-file.js —— 原子文件写原语（tmp + rename + Windows 锁退避）。
//
// **通用 JSON 文件 store 已随 SQLite 迁移下线（T07）**，唯一还活着的消费者是
// panel-presence.js 的 panels.json 同步写 —— 这两个原子写原语原样搬来保留，
// 别处不许再长出「JSON 文件 store」（业务数据一律进 nxkv.db）。
import fsp from 'node:fs/promises';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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
