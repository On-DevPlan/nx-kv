// 本机设置仓储：settings 表的 lt.* 键（超时 / 追加模式）。
//
// 为什么走 k/v 而不是宽表：这些键会持续增加，加键零迁移（schema G2 的取舍）。
// value 一律 JSON 文本（'240' / '"xml"'），读写都在这里序列化。
// 凭据（token/baseUrl/email/userId/groupId）**绝不进这张表** —— 它们留在 config.json。
//
// 提示词模板模型（#152 重构）：
//   - **模板正文的唯一真相是插件类**（modules/promptplug/plugins/*.ts 的 `templates`）。
//     没有 JSON 注册表、没有 DB seed、也没有「每区块 active + list」这套落库模型，
//     也没有从库里派生出来的镜像——要用正文就读插件类（activeTemplateOf）。
//   - #238 补上了**用户层**的落库（用户在设置页加/改/启用的那几条）：那是 promptplug
//     自己的键（settings 表，一段一个 `prompt.tpl.<段>`），由 template-store.ts 读写，
//     与本文件的 lt.* 无关。
//   - 因此本文件只剩一个真正可写的键：`lt.timeoutSec`（#186 起 appendMode 已删除，只保留 XML）。
import { db, txw } from './open.js';
import { nowMs } from '../../../../core/db/time.js';
import {
  DEFAULT_TIMEOUT_SEC,
  MAX_TIMEOUT_SEC,
  clampTimeoutSec,
} from '../store-io.js';
import type { DbApi } from '../../../../core/db/driver.js';
import { activeTemplateOf } from '../../../promptplug/index.js';

const KEYS = {
  timeoutSec: 'lt.timeoutSec',
};

function readSetting(conn: DbApi, key: string): any {
  const row = conn.get('SELECT value FROM settings WHERE key = :k', { k: key });
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

function writeSetting(conn: DbApi, key: string, value: unknown): void {
  conn.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (:k, :v, :at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { k: key, v: JSON.stringify(value === undefined ? null : value), at: nowMs() }
  );
}

/** 一条模板 → 「多条」视图（按空行拆分；旧 CLI 字段兼容用）。 */
function splitEntries(template: unknown): string[] {
  const s = String(template ?? '').trim();
  return s ? s.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean) : [];
}

/** 读全部 lt.* 设置。 */
export function getLtSettings(): Record<string, any> {
  const conn = db();
  return {
    timeoutSec: clampTimeoutSec(readSetting(conn, KEYS.timeoutSec)),
    // 旧视图字段：ack 段落正文来自 ack 插件类的内置模板，仍按「多条」形态给出，
    // 让老 CLI 的 localtask config 输出不必断代（#152：只是回显，不可写）。
    ackPrompt: splitEntries(activeTemplateOf('ack')),
  };
}

/** setLtSettings 的 patch 形状（#152：模板不再可写，只留两个键）。 */
export interface LtSettingsPatch {
  timeoutSec?: unknown;
}

/** 写部分设置（只改传入项；校验沿用 store-io 的 clamp）。 */
export function setLtSettings(patch: LtSettingsPatch = {}): Record<string, any> {
  return txw((conn) => {
    if (patch.timeoutSec !== undefined) {
      writeSetting(conn, KEYS.timeoutSec, clampTimeoutSec(patch.timeoutSec));
    }
    return getLtSettings();
  });
}

/** 面板/CLI 的设置视图（派生兼容字段在这里补齐）。 */
export function settingsView(): Record<string, any> {
  const s = getLtSettings();
  return {
    timeoutSec: s.timeoutSec,
    recommendedSec: DEFAULT_TIMEOUT_SEC,
    maxSec: MAX_TIMEOUT_SEC,
    ackPromptList: s.ackPrompt,
  };
}

export { DEFAULT_TIMEOUT_SEC, MAX_TIMEOUT_SEC } from '../store-io.js';
export { DEFAULT_ACK_PROMPT } from '../../lifecycle/task-templates.js';
