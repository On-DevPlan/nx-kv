// 本机偏好：全部进库（settings 表，`app.*` 键），不再有 config.json 凭据。
//
// 云端任务 / 登录移除后，config.json 里的 baseUrl / token / email / userId /
// groupId 一并废弃；旧文件即使还在也不会被读取（多余键自然忽略）。
//
// 白名单纪律（#82 的教训）：PREF_KEYS 显式枚举每个字段；不在白名单里的字段
// 不写 —— 新增配置项必须同时在 normalize 与 PREF_KEYS 里登记。
//
// settings 读取**不做长缓存**：单条 SELECT 是微秒级，缓存只会带来
// 「serve 改了设置、CLI 读到过期值」这类最难查的跨进程过期。
import { readSettingRaw, writeSettingRaw } from './db/settings.js';
import { tx } from './db/tx.js';
import { openStore } from './db/index.js';
import { nowMs } from './db/time.js';

/** 进 settings 表（`app.*` 前缀）的偏好字段。 */
export const PREF_KEYS = Object.freeze([
  'gitRepoRoot',
  'gitDevRoot',
] as const);

/** settings 表里偏好字段的键名。 */
export const APP_SETTING_KEYS = Object.freeze(PREF_KEYS.map((k) => 'app.' + k));

/** 归一后的本机偏好形状。 */
export interface AppConfig {
  gitRepoRoot: string;
  gitDevRoot: string;
}

const EMPTY = (): AppConfig => ({
  // 参考仓库（type=ref）的存储根。**空 = clone 拒绝执行**：用户必须显式指一个
  // 非 C 盘的目录（参考仓库动辄几十 MB～GB 级，不能默默堆进 homedir）。
  gitRepoRoot: '',
  // 导入布局时开发仓库（type=dev）的默认克隆根；空 = 导入时 dev 只登记不克隆。
  gitDevRoot: '',
});

let cache: AppConfig | null = null;

/** 全量归一（保证形状与类型稳定）。 */
function normalize(data: unknown): AppConfig {
  const base = EMPTY();
  if (!data || typeof data !== 'object') return base;
  const d = data as Record<string, unknown>;
  return {
    gitRepoRoot: String(d.gitRepoRoot || ''),
    gitDevRoot: String(d.gitDevRoot || ''),
  };
}

/** 从 settings 表读偏好（每次现读 —— 不缓存，跨进程改设置立刻可见）。 */
function readPrefs(): Record<string, unknown> {
  const db = openStore();
  const prefs: Record<string, unknown> = {};
  for (const key of APP_SETTING_KEYS) {
    const v = readSettingRaw(db, key);
    if (v !== undefined) prefs[key.slice('app.'.length)] = v;
  }
  return prefs;
}

/** 把偏好写进 settings 表（一个事务；只写白名单里的字段）。 */
function writePrefs(next: AppConfig): void {
  const at = nowMs();
  tx(
    (conn) => {
      for (const k of PREF_KEYS) {
        if (next[k] === undefined) continue;
        writeSettingRaw(conn, 'app.' + k, next[k], at);
      }
    },
    { db: openStore(), mode: 'IMMEDIATE' },
  );
}

export async function loadConfig(): Promise<AppConfig> {
  cache = normalize(readPrefs());
  return cache;
}

export async function saveConfig(next: unknown): Promise<AppConfig> {
  const full = normalize(next);
  writePrefs(full);
  cache = full;
  return full;
}

export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const cur = await loadConfig();
  return saveConfig({ ...cur, ...patch });
}
