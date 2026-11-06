// 本机配置：凭据留文件（config.json），偏好进库（settings 表）。
//
// ── 拆分（D4 裁决）─────────────────────────────────────────────────────
//
//   进库（settings 表，`app.*` 键，value 是 JSON 文本）：
//     autoSyncAttachments / attachmentsDir / gitRepoRoot / gitDevRoot
//     —— 业务配置，与数据同生命周期（备份 / VACUUM INTO 跟着库走）。
//     localtask 的 5 个键（lt.*）T03 已进库，见 localtask/repo/settings.js。
//
//   留文件（config.json，**精确 5 个字段**）：
//     baseUrl / token / email / userId / groupId
//     —— 凭据与会话身份。**绝不进库**：库会被 `VACUUM INTO` 备份、被
//     `db inspect` dump、被人拷走排障，凭据一旦进库就跟着这些通道扩散。
//
// `loadConfig()` / `saveConfig()` / `updateConfig()` 的签名与返回形状**完全不变**
// —— 内部拼「文件 5 项 + settings 表」再 normalize 一次返回，调用方零感知。
//
// 白名单纪律（#82 的教训）：CREDENTIAL_KEYS / PREF_KEYS **显式枚举**每个字段。
// 不在白名单里的字段，两边都不写 —— 新增配置项必须同时在 normalize 与对应
// 白名单里登记，漏一处就是「设置了但下次启动丢掉」。
//
// settings 读取**不做长缓存**：单条 SELECT 是微秒级，缓存只会带来
// 「serve 改了设置、CLI 读到过期值」这类最难查的跨进程过期。
import fsp from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { badInput } from './errors.js';
import { readSettingRaw, writeSettingRaw } from './db/settings.js';
import { tx } from './db/tx.js';
import { openStore } from './db/index.js';
import { nowMs } from './db/time.js';

export const CONFIG_PATH = join(homedir(), '.nx-kv', 'config.json');

// 测试与多实例覆盖：NX_KV_CONFIG 环境变量优先，其次是 NX_KV_STORE 所在目录
export function configPathFromEnv() {
  return process.env.NX_KV_CONFIG || CONFIG_PATH;
}

export const DEFAULT_BASE_URL = 'http://192.0.2.47:8988';

// ── 显式白名单（#82 的教训：不列出的字段两边都不写）────────────────────

/** 留在 config.json 的字段（凭据 + 会话身份）。config.json 的键集合精确等于它。 */
export const CREDENTIAL_KEYS = Object.freeze(['baseUrl', 'token', 'email', 'userId', 'groupId']);

/** 进 settings 表（`app.*` 前缀）的偏好字段。 */
export const PREF_KEYS = Object.freeze(['autoSyncAttachments', 'attachmentsDir', 'gitRepoRoot', 'gitDevRoot']);

/** settings 表里偏好字段的键名。 */
export const APP_SETTING_KEYS = Object.freeze(PREF_KEYS.map((k) => 'app.' + k));

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
  // 参考仓库（type=ref）的存储根目录。**空 = clone 拒绝执行**：用户必须显式指一个
  // 非 C 盘的目录（参考仓库动辄几十 MB～GB 级，不能默默堆进 homedir）。
  gitRepoRoot: '',
  // 导入布局时开发仓库（type=dev）的默认克隆根；空 = 导入时 dev 只登记不克隆。
  gitDevRoot: '',
});

let cache = null;
let cacheMtime = -1;

/** 全量归一（文件 5 项 + settings 偏好合并后跑一次，保证形状与类型稳定）。 */
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
    gitRepoRoot: String(data.gitRepoRoot || ''),
    gitDevRoot: String(data.gitDevRoot || ''),
  };
}

/** 从 settings 表读偏好（每次现读 —— 不缓存，跨进程改设置立刻可见）。 */
function readPrefs() {
  const db = openStore();
  const prefs = {};
  for (const key of APP_SETTING_KEYS) {
    const v = readSettingRaw(db, key);
    if (v !== undefined) prefs[key.slice('app.'.length)] = v;
  }
  return prefs;
}

/** 把偏好写进 settings 表（一个事务；只写白名单里的字段）。 */
function writePrefs(next) {
  const at = nowMs();
  tx(
    (conn) => {
      for (const k of PREF_KEYS) {
        if (next[k] === undefined) continue;
        writeSettingRaw(conn, 'app.' + k, next[k], at);
      }
    },
    { db: openStore(), mode: 'IMMEDIATE' }
  );
}

export async function loadConfig(explicitPath) {
  const p = explicitPath || configPathFromEnv();
  let filePart;
  try {
    const st = await fsp.stat(p);
    if (!(cache && cacheMtime === st.mtimeMs)) {
      cache = normalize(JSON.parse(await fsp.readFile(p, 'utf8')));
      cacheMtime = st.mtimeMs;
    }
    filePart = cache;
  } catch {
    // 不存在或损坏：返回默认结构（首次运行；也允许外部修好后自动恢复）
    filePart = normalize(null);
    cache = filePart;
    cacheMtime = -1;
  }
  // 偏好从 settings 表现读（迁移后文件里不再有它们），覆盖合并后归一
  return normalize({ ...filePart, ...readPrefs() });
}

export async function saveConfig(next, explicitPath) {
  const full = normalize(next);
  // ① 文件：只写凭据白名单里的字段（**键集合精确等于 CREDENTIAL_KEYS** ——
  //    偏好进了 settings，再写回文件会让「凭据文件」再次长出业务配置）。
  const filePart = {};
  for (const k of CREDENTIAL_KEYS) filePart[k] = full[k];
  const p = explicitPath || configPathFromEnv();
  await fsp.mkdir(dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(filePart, null, 2), 'utf8');
  await fsp.rename(tmp, p);
  // ② settings：偏好白名单（值不变就不写占位 —— loadConfig 侧缺键回落默认）
  writePrefs(full);
  cache = normalize({ ...filePart });
  try {
    cacheMtime = (await fsp.stat(p)).mtimeMs;
  } catch {
    cacheMtime = -1;
  }
  return full;
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
