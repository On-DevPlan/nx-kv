// settings 表的裸 k/v 读写（value 一律 JSON 文本）。
//
// 为什么在 core：settings 表的消费方横跨多个域 —— core/config.js（偏好 4 项，
// 凭据绝不进库）与 tasktool 的队列级 timegoal（goal 是"按键取值"的运行时状态，
// 不参与任何关系查询）都要经这里读写。core 不得 import modules（分层规则），
// 所以裸访问器落在 core，域语义（clamp / 白名单 / 键名）留在各自的模块里。
//
// 硬规则（schema G2）：**凡需要出现在 WHERE 里的东西不许进 settings** ——
// 它只做「按键取值」；前缀列举（listByPrefix）只给"整表导出/清理"用，
// 不当查询条件。
import { nowMs } from './time.js';

/** 读一个键；不存在返回 undefined；JSON 损坏按不存在处理（脏数据不炸读取）。 */
export function readSettingRaw(conn, key) {
  const row = conn.get('SELECT value FROM settings WHERE key = :k', { k: String(key || '') });
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

/** 写一个键（upsert）。value 先 JSON 序列化 —— 调用方只给"值"。 */
export function writeSettingRaw(conn, key, value, atMs = nowMs()) {
  conn.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (:k, :v, :at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { k: String(key || ''), v: JSON.stringify(value === undefined ? null : value), at: atMs }
  );
}

/** 删一个键（幂等）。返回是否真删了。 */
export function deleteSettingRaw(conn, key) {
  const r = conn.run('DELETE FROM settings WHERE key = :k', { k: String(key || '') });
  return Number(r.changes) > 0;
}

/** 按前缀列举（整表导出/清理用；不是查询条件）。 */
export function listSettingsByPrefix(conn, prefix) {
  const rows = conn.all('SELECT key, value FROM settings ORDER BY key');
  const p = String(prefix || '');
  return rows
    .filter((r) => r.key.startsWith(p))
    .map((r) => {
      let value;
      try {
        value = JSON.parse(r.value);
      } catch {
        value = undefined;
      }
      return { key: r.key, value };
    });
}
