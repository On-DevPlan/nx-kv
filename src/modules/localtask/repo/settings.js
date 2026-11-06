// 本机设置仓储：settings 表的 lt.* 五个键（超时 / 收尾指令 / ack / 交付模板 / 附件段）。
//
// 为什么走 k/v 而不是宽表：这些键会持续增加，加键零迁移（schema G2 的取舍）。
// value 一律 JSON 文本（'240' / '["a","b"]' / '"…"'），读写都在这里序列化。
// 凭据（token/baseUrl/email/userId/groupId）**绝不进这张表** —— 它们留在 config.json。
import { db, txw } from './open.js';
import { nowMs } from '../../../core/db/time.js';
import {
  DEFAULT_TIMEOUT_SEC,
  MAX_TIMEOUT_SEC,
  clampTimeoutSec,
} from '../store-io.js';
import {
  DEFAULT_TASK_SUFFIX,
  clampTaskSuffixList,
  clampAckPromptList,
  clampDeliveryTemplate,
  clampAttachTemplate,
} from '../task-templates.js';

const KEYS = {
  timeoutSec: 'lt.timeoutSec',
  taskSuffix: 'lt.taskSuffix',
  ackPrompt: 'lt.ackPrompt',
  deliveryTemplate: 'lt.deliveryTemplate',
  attachTemplate: 'lt.attachTemplate',
};

function readSetting(conn, key) {
  const row = conn.get('SELECT value FROM settings WHERE key = :k', { k: key });
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

function writeSetting(conn, key, value) {
  conn.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (:k, :v, :at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { k: key, v: JSON.stringify(value === undefined ? null : value), at: nowMs() }
  );
}

/** 读全部 lt.* 设置（缺省回落内置默认 —— 与旧 emptyStore 的白名单同口径）。 */
export function getLtSettings() {
  const conn = db();
  return {
    timeoutSec: clampTimeoutSec(readSetting(conn, KEYS.timeoutSec)),
    // 键不存在（从没改过）→ clamp 给默认模板；显式 '' / []（关闭）→ 保留为空列表
    taskSuffix: clampTaskSuffixList(readSetting(conn, KEYS.taskSuffix)),
    ackPrompt: clampAckPromptList(readSetting(conn, KEYS.ackPrompt)),
    deliveryTemplate: clampDeliveryTemplate(readSetting(conn, KEYS.deliveryTemplate)),
    attachTemplate: clampAttachTemplate(readSetting(conn, KEYS.attachTemplate)),
  };
}

/** 写部分设置（只改传入项；校验沿用 store-io 的 clamp，非法值截到合法域）。 */
export function setLtSettings(patch = {}) {
  return txw((conn) => {
    if (patch.timeoutSec !== undefined) {
      writeSetting(conn, KEYS.timeoutSec, clampTimeoutSec(patch.timeoutSec));
    }
    if (patch.taskSuffix !== undefined) {
      writeSetting(conn, KEYS.taskSuffix, clampTaskSuffixList(patch.taskSuffix));
    }
    if (patch.ackPrompt !== undefined) {
      writeSetting(conn, KEYS.ackPrompt, clampAckPromptList(patch.ackPrompt));
    }
    if (patch.deliveryTemplate !== undefined) {
      writeSetting(conn, KEYS.deliveryTemplate, clampDeliveryTemplate(patch.deliveryTemplate));
    }
    if (patch.attachTemplate !== undefined) {
      writeSetting(conn, KEYS.attachTemplate, clampAttachTemplate(patch.attachTemplate));
    }
    return getLtSettings();
  });
}

/** 面板/CLI 的设置视图（与旧 settingsView 同形状；派生字段在这里补齐）。 */
export function settingsView() {
  const s = getLtSettings();
  const suffixList = s.taskSuffix;
  return {
    timeoutSec: s.timeoutSec,
    recommendedSec: DEFAULT_TIMEOUT_SEC,
    maxSec: MAX_TIMEOUT_SEC,
    taskSuffix: suffixList.join('\n\n'),
    taskSuffixList: suffixList,
    defaultTaskSuffix: DEFAULT_TASK_SUFFIX,
    suffixEnabled: suffixList.length > 0,
    ackPromptList: s.ackPrompt,
    deliveryTemplate: s.deliveryTemplate,
    attachTemplate: s.attachTemplate,
  };
}

export { DEFAULT_TIMEOUT_SEC, MAX_TIMEOUT_SEC };
