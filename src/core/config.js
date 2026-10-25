// 本机配置：后端地址 + 登录态。
//
// 与业务数据（KV 清单）分开存放：清单在服务端，这里只存「怎么连过去」。
// 复用 store.js 的原子写语义，但结构独立——配置是单例，不是集合。
import fsp from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { badInput } from './errors.js';

export const CONFIG_PATH = join(homedir(), '.nx-kv', 'config.json');

// 测试与多实例覆盖：NX_KV_CONFIG 环境变量优先，其次是 NX_KV_STORE 所在目录
export function configPathFromEnv() {
  return process.env.NX_KV_CONFIG || CONFIG_PATH;
}

export const DEFAULT_BASE_URL = 'http://192.0.2.47:8988';

const EMPTY = () => ({
  baseUrl: process.env.NX_KV_BASE_URL || DEFAULT_BASE_URL,
  token: '',
  email: '',
  userId: 0,
  // 当前工作空间：0 = 不传 groupId（后端回落默认组）
  groupId: 0,
  // 读任务时是否自动把附件拉到本机。默认 **关**：开启意味着每次 list/get 都会
  // 触网下载，对「只想看一眼清单」的场景是纯负担；开关在面板「清单」页或
  // `nx-kv setting set --autoSyncAttachments`。
  autoSyncAttachments: false,
  // 附件本地目录覆盖；空 = 用默认 ~/.nx-kv/attachments/<groupId>/
  attachmentsDir: '',
});

let cache = null;
let cacheMtime = -1;

function normalize(data) {
  const base = EMPTY();
  if (!data || typeof data !== 'object') return base;
  return {
    baseUrl: String(data.baseUrl || base.baseUrl),
    token: String(data.token || ''),
    email: String(data.email || ''),
    userId: Number(data.userId) || 0,
    groupId: Number(data.groupId) || 0,
    autoSyncAttachments: data.autoSyncAttachments === true,
    attachmentsDir: String(data.attachmentsDir || ''),
  };
}

export async function loadConfig(explicitPath) {
  const p = explicitPath || configPathFromEnv();
  try {
    const st = await fsp.stat(p);
    if (cache && cacheMtime === st.mtimeMs) return cache;
    cache = normalize(JSON.parse(await fsp.readFile(p, 'utf8')));
    cacheMtime = st.mtimeMs;
    return cache;
  } catch {
    // 不存在或损坏：返回默认结构（首次运行；也允许外部修好后自动恢复）
    cache = normalize(null);
    cacheMtime = -1;
    return cache;
  }
}

export async function saveConfig(next, explicitPath) {
  const p = explicitPath || configPathFromEnv();
  const data = normalize(next);
  await fsp.mkdir(dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, p);
  cache = data;
  try {
    cacheMtime = (await fsp.stat(p)).mtimeMs;
  } catch {
    cacheMtime = -1;
  }
  return data;
}

export async function updateConfig(patch) {
  const cur = await loadConfig();
  return saveConfig({ ...cur, ...patch });
}

// 读配置并要求已登录。所有需要 token 的 action 都先过这里，
// 报错文案里的「未登录」是 agent 的失败分类锚点（与 kvcli 保持一致）。
export async function requireAuth() {
  const cfg = await loadConfig();
  if (!cfg.token) {
    throw badInput('未登录（先执行 nx-kv auth login <email>）');
  }
  return cfg;
}

// groupId 归一：0 / 负数 / 空 → undefined（不传参，由后端回落默认组）
export function normalizeGroupId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 解析「这次操作作用于哪个工作空间」：显式传入的 --group 优先，否则回落到本机配置
 * 里的当前工作空间。
 *
 * 放进 core 是因为**不止一个模块要用同一条规则**：todo 拿它读写 KV，
 * file 拿它选后端分组与本地附件目录。两处各写一遍的话，一旦有人只改了一处，
 * 就会出现「从 A 组读任务、往 B 组同步附件」—— 这类错不报错，只是静默地对不上。
 */
export async function resolveGroupId(groupId) {
  if (groupId !== undefined && groupId !== null && groupId !== '') return normalizeGroupId(groupId);
  const cfg = await loadConfig();
  return normalizeGroupId(cfg.groupId);
}
