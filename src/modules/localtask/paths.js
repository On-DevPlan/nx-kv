// （#54 自 service.js 拆出）全局主题常量 + 存储位置 + 「工作目录 → 主题 key」的纯解析。
import crypto from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { APP_DIR } from '../../core/paths.js';
import { badInput } from '../../core/errors.js';
// ─── 全局主题：跨目录共享队列（工作窃取）───────────────────────────
//
// 参考 Go runtime scheduler 的两层队列：每个 P 有 local runq，空了去 global runq
// 取，还没有才 park。这里的对应物：每个工作目录一个本地主题队列，wait 在本地
// 取不到 pending 时自动去「全局主题」领；全局也没有才阻塞。
// 任务侧用 addTask({global:true})（CLI --global）把不限定接收方的任务发布进池子。
//
// 全局主题是真实存在的主题对象（复用 topics 存储），但有特殊行为：
//   - key 固定 '__GLOBAL__'，与目录名哈希出的 16 位 hex key 永不冲突；cwd 恒为空
//   - 永不进入 waiting 状态（它是任务源，不是等待源）——countWaitingTopics 自然不计
//   - prune/remove 默认跳过（受保护），--force 才能删；等待语义（setWaiting/cancel）不适用
export const GLOBAL_KEY = '__GLOBAL__';
export const GLOBAL_NAME = '全局任务';
export const GLOBAL_CWD = ''; // 全局主题永不指向真实目录

export function isGlobalKey(key) {
  return key === GLOBAL_KEY;
}
// ─── 存储位置：可环境变量覆盖（测试隔离）；旧名/旧文件自动兼容 ──────────

export function storePath() {
  return (
    process.env.NX_KV_LOCALTASK_STORE ||
    process.env.NX_KV_SESSIONTASK_STORE || // 改名前的环境变量，兼容既有脚本
    join(APP_DIR, 'localtasks.json')
  );
}

// 改名前的存储文件。显式覆盖（任一环境变量）时不迁移；新文件缺失时读它，
// 首次保存即落到新文件（旧文件保留不删，数据零丢失）。
export function legacyStorePath() {
  if (process.env.NX_KV_LOCALTASK_STORE || process.env.NX_KV_SESSIONTASK_STORE) return null;
  return join(APP_DIR, 'sessiontasks.json');
}
// ─── 工作目录 → 主题 ───────────────────────────────────────────────

/**
 * 归一化工作目录并解析主题。
 * @param {string} [raw] 目录路径；缺省/空 → 进程当前 cwd
 * @returns {{cwd:string, key:string}}
 */
export function normalizeCwd(raw) {
  const trimmed = raw && String(raw).trim() ? String(raw).trim() : '';
  let cwd;
  try {
    cwd = resolve(trimmed || process.cwd());
  } catch {
    cwd = process.cwd();
  }
  const name = basename(cwd);
  return { cwd, name, key: topicKeyFor(name) };
}

// 主题以「目录名」标识：在名为 br_ct 的目录里执行 CLI → 自动领取 br_ct 主题队列的任务；
// 同名目录共用同一队列。Windows 折叠目录名大小写。
export function topicKeyFor(name) {
  const fold = process.platform === 'win32' ? String(name).toLowerCase() : String(name);
  return crypto.createHash('sha1').update(fold, 'utf8').digest('hex').slice(0, 16);
}
// 任务级寻址：显式 key 优先（全局主题只能按 key 定位——它没有 cwd），否则按工作目录
//
// ⚠️ 同时给了 --cwd 与 --key、且两者**指向不同主题**时，现在直接报错。
// 以前是静默以 key 为准 —— 改错一个 key 就动到了别的目录的队列，没人会发现。
// 两者指向同一个主题时（脚本常见写法）照常工作，不破坏既有用法。
export function resolveTaskKey({ key: rawKey, cwd: rawCwd }) {
  if (rawKey && String(rawKey).trim()) {
    const k = String(rawKey).trim();
    if (rawCwd && String(rawCwd).trim()) {
      const byCwd = normalizeCwd(rawCwd).key;
      if (byCwd !== k) {
        throw badInput(
          `--cwd 与 --key 指向不同的主题（--cwd → ${byCwd}，--key → ${k}），请只给一个`
        );
      }
    }
    return k;
  }
  return normalizeCwd(rawCwd).key;
}
// 定位主题 key：显式 --key 优先，否则按工作目录（目录名）推导
// 与 resolveTaskKey 同一套规则（--cwd 与 --key 矛盾时报错），别再各写一份。
export function resolveTopicKey({ key: rawKey, cwd: rawCwd }) {
  return resolveTaskKey({ key: rawKey, cwd: rawCwd });
}
