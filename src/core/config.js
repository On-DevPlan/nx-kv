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

export const DEFAULT_BASE_URL = 'http://47.110.80.47:8988';

const EMPTY = () => ({
  baseUrl: process.env.NX_KV_BASE_URL || DEFAULT_BASE_URL,
  token: '',
  email: '',
  userId: 0,
  // 当前工作空间：0 = 不传 groupId（后端回落默认组）
  groupId: 0,
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
