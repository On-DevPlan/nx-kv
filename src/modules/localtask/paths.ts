// （#54 自 service.js 拆出）全局主题常量 + 存储位置 + 「工作目录 → 主题 key」的纯解析。
import { basename, join, resolve } from 'node:path';
import { topicKeyOf } from '../../core/topic-key.js';
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

export function isGlobalKey(key: unknown): boolean {
  return key === GLOBAL_KEY;
}
// ─── 存储位置（历史兼容层已随 T07 下线；存储进 nxkv.db，见 repo/open.js）───

// 改名前的存储文件（sessiontasks.json）。显式覆盖（NX_KV_LOCALTASK_STORE）时
// 不迁移；新文件缺失时读它（T07 收档改名后由 import-json 的 findLegacy 兜底）。
export function legacyStorePath(): string | null {
  if (process.env.NX_KV_LOCALTASK_STORE) return null;
  return join(APP_DIR, 'sessiontasks.json');
}
// ─── 工作目录 → 主题 ───────────────────────────────────────────────

/** 归一化后的主题定位结果。 */
export interface NormalizedCwd {
  cwd: string;
  name: string;
  key: string;
}

/**
 * 归一化工作目录并解析主题。
 * @param {string} [raw] 目录路径；缺省/空 → 进程当前 cwd
 * @returns {{cwd:string, key:string}}
 */
export function normalizeCwd(raw?: unknown): NormalizedCwd {
  const trimmed = raw && String(raw).trim() ? String(raw).trim() : '';
  let cwd: string;
  try {
    cwd = resolve(trimmed || process.cwd());
  } catch {
    cwd = process.cwd();
  }
  const name = basename(cwd);
  return { cwd, name, key: topicKeyOf(cwd, '') };
}

// 队列身份（T03 起与 topics.key 同一派生）：**完整 cwd**（小写折叠）+ 无组上下文。
//
// 旧版是 `sha1(目录名)`——同名目录共用一条队列，路径可能被另一个同名目录覆盖
// （面板显示的路径跟着变，看着像队列跑到别处去了）。新版修正这个语义：
// 不同路径 = 不同队列。**旧 key 一律失效、不做别名解析**（设计裁决）——
// 旧 key 只留在 topics.ext.ext_legacy_key 作取证，CLI 提示「旧版 key 请改用 --cwd」。
// 全局池：topicKeyOf('') === '__GLOBAL__'，与旧 GLOBAL_KEY 同值，地址不变。
export function topicKeyFor(name: unknown): string {
  // 保留旧名（几个调用点按名字寻址），但**语义已变**：它只该用于「从 cwd 派生」，
  // 不再接受裸目录名 —— 名字仍在是为了调用点少改一处。
  return topicKeyOf(String(name ?? ''), '');
}

/** 任务级 / 主题级寻址入参：--key 与 --cwd 二选一（或同时给且一致）。 */
export interface KeyResolveInput {
  key?: string;
  cwd?: string;
}

// 任务级寻址：显式 key 优先（全局主题只能按 key 定位——它没有 cwd），否则按工作目录
//
// ⚠️ 同时给了 --cwd 与 --key、且两者**指向不同主题**时，现在直接报错。
// 以前是静默以 key 为准 —— 改错一个 key 就动到了别的目录的队列，没人会发现。
// 两者指向同一个主题时（脚本常见写法）照常工作，不破坏既有用法。
export function resolveTaskKey({ key: rawKey, cwd: rawCwd }: KeyResolveInput): string {
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
export function resolveTopicKey({ key: rawKey, cwd: rawCwd }: KeyResolveInput): string {
  return resolveTaskKey({ key: rawKey, cwd: rawCwd });
}
