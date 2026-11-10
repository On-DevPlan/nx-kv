// 常量与纯函数：状态判据、时长解析、ref id、任务引用解析、空报告工厂。
// 本文件不碰数据库，供导入管线的各阶段共用。
import crypto from 'node:crypto';

/** legacy 写入层的正文上限（迁移时超长按截断 + 标记，不整体失败）。 */
export const MAX_BODY = 20_000;

/** 迁移时承载「对不上真实仓库的队列」的哨兵仓库 key。 */
export const SENTINEL_REPO_KEY = '__unbound__';
export const SENTINEL_REPO_NAME = '未绑定仓库';

/** legacy 文件名（只认这几个；`repos.backup.*.json` 不参与）。 */
export const LEGACY_FILES = {
  localtasks: 'localtasks.json',
  sessiontasks: 'sessiontasks.json',
  repos: 'repos.json',
  timegoals: 'timegoals.json',
  templates: 'templates.json',
  config: 'config.json',
};

/** config.json 里属于「偏好」的 4 个字段（其余是凭据，**绝不进库**）。 */
export const CONFIG_PREF_KEYS = ['autoSyncAttachments', 'attachmentsDir', 'gitRepoRoot', 'gitDevRoot'];

/** localtasks store 里属于「本机设置」的 5 个字段。 */
export const LOCALTASK_SETTING_KEYS = [
  'timeoutSec',
  'taskSuffix',
  'ackPrompt',
  'deliveryTemplate',
  'attachTemplate',
];

/** 稳定的 ref id：locator 的纯函数（同一份文档换台机器也是同一个 id；路径统一 POSIX）。 */
export function refIdOf(locator) {
  return 'ref_' + crypto.createHash('sha1').update(String(locator).replace(/\\/g, '/'), 'utf8').digest('hex').slice(0, 16);
}

/** 空报告。所有分支都填它，调用方（CLI / 测试）只读这一个对象。 */
export function emptyReport() {
  return {
    sources: [],
    imported: {
      repos: 0,
      members: 0,
      topics: 0,
      tasks: 0,
      presence: 0,
      links: 0,
      deps: 0,
      goals: 0,
      goalChecks: 0,
      refs: 0,
      refBindings: 0,
      templates: 0,
      settings: 0,
    },
    distribution: { pending: 0, claimed: 0, done: 0, cancelled: 0 },
    warnings: [],
    discarded: [],
  };
}

export const jsonText = (v) => JSON.stringify(v === undefined ? null : v);

/**
 * legacy 任务的 5 步嵌套判据。
 *
 * @param {object} task legacy 任务行
 * @returns {{status: string, unknown: boolean, archived: boolean, hasSummary: boolean}}
 */
export function mapLegacyStatus(task) {
  const raw = String((task && task.status) ?? '').trim();
  const summaryRaw = task ? task.roundSummary : undefined;
  const hasSummary = summaryRaw !== undefined && summaryRaw !== null && String(summaryRaw).trim() !== '';

  // 第 0 步：**新词直通**。T02 之后 JSON 里可能已是 pending/claimed/done/cancelled
  // （跑过 rewrite-json-status.mjs 的机器），它们不是 legacy 词，原样认领 ——
  // 「两条都要认」：旧词按判据映射，新词原样保留。
  if (raw === 'claimed' || raw === 'done' || raw === 'cancelled') {
    return { status: raw, unknown: false, archived: raw === 'cancelled', hasSummary };
  }

  // 第 2 步：pending 优先于一切 —— 即使带了 roundSummary（历史残留 / 就地重开的空串）
  if (raw === 'pending') return { status: 'pending', unknown: false, archived: false, hasSummary };
  // 第 3 步
  if (raw === 'consumed') {
    return { status: hasSummary ? 'done' : 'claimed', unknown: false, archived: false, hasSummary };
  }
  // 第 4 步
  if (raw === 'archived') {
    return { status: hasSummary ? 'done' : 'cancelled', unknown: false, archived: true, hasSummary };
  }
  // 第 5 步：未知状态不猜语义 —— 当 pending（可领）并报告，因为"丢失"比"重领"更糟
  return { status: 'pending', unknown: true, archived: false, hasSummary };
}

/**
 * 旧 timegoal 的时长写法：既可能是 `{durationSec: 1800}`（新夹具），
 * 也可能是 `{duration: "2h"}`（真机上更早的存档）。只认 durationSec 会让后者
 * 静默变成 0 → 目标被跳过，迁移报告却说「已迁入 goals」。
 */
const DURATION_UNITS = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1, 秒: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60, 分: 60, 分钟: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, 小时: 3600, 时: 3600,
  d: 86400, day: 86400, days: 86400, 天: 86400, 日: 86400,
  w: 604800, week: 604800, weeks: 604800, 周: 604800,
};

export function legacyDurationSec(tg) {
  const direct = Math.trunc(Number(tg && tg.durationSec) || 0);
  if (direct > 0) return direct;
  const raw = tg && tg.duration;
  if (Number.isFinite(Number(raw)) && Number(raw) > 0) return Math.trunc(Number(raw));
  const m = /^(\d+(?:\.\d+)?)\s*([a-zA-Z一-龥]+)$/.exec(String(raw || '').trim());
  if (!m) return 0;
  const unit = DURATION_UNITS[m[2].toLowerCase()];
  return unit ? Math.trunc(Number(m[1]) * unit) : 0;
}

/** `"topicKey:id"` → { legacyKey, seq }；解析不出来返回 null。 */
export function parseTaskRef(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const at = s.lastIndexOf(':');
  if (at <= 0) return null;
  const seq = Math.trunc(Number(s.slice(at + 1)) || 0);
  if (!seq) return null;
  return { legacyKey: s.slice(0, at), seq };
}

export function stringOrNull(v) {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

export function numberOrNull(n) {
  return Number.isFinite(n) ? n : null;
}
