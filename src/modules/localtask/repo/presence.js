// 等待态仓储：topic_presence 表（瞬态数据独立成表 —— schema P0-4 的落地）。
//
// 为什么等待态不进 topics 行：wait 进程被 SIGKILL 时 finally 不会执行，
// waiting:true 会**永久残留**。独立成表后，残留只污染这张小表，
// 可以整表清空，不会让队列本身看起来像有人在等。
// 判据始终两条：waiting=1 **且** until_ms > now（isLiveWaiting，task-view.js）。
import { db, txw } from './open.js';
import { nowMs } from '../../../core/db/time.js';
import { getTopicRow, updateTopic } from './topics.js';

/**
 * 写等待态（upsert）。
 * @param {object} p { waiting, untilMs?, sinceMs?, cancelRequested?, summary? }
 */
export function setPresence(key, p = {}) {
  return txw((conn) => {
    const at = nowMs();
    const topic = getTopicRow(key);
    if (!topic) return null;
    const values = {
      waiting: p.waiting ? 1 : 0,
      since: Number(p.sinceMs) || 0,
      until: Number(p.untilMs) || 0,
      cancel: p.cancelRequested ? 1 : 0,
      id: topic.id,
      at,
    };
    conn.run(
      `INSERT INTO topic_presence (topic_id, waiting, since_ms, until_ms, cancel_requested, updated_at)
       VALUES (:id, :waiting, :since, :until, :cancel, :at)
       ON CONFLICT(topic_id) DO UPDATE SET waiting = excluded.waiting, since_ms = excluded.since_ms,
         until_ms = excluded.until_ms, cancel_requested = excluded.cancel_requested,
         updated_at = excluded.updated_at`,
      values
    );
    if (p.summary !== undefined) updateTopic(key, { summary: p.summary });
    updateTopic(key, {});
    return true;
  });
}

/**
 * 清等待态：**仅当主题仍存在**时清，绝不重建 —— 主题可能已被 force 删除，
 * 重建会让「删除主题」失效（曾在超时清理路径上把删掉的主题又建回来）。
 */
export function clearPresence(key) {
  return txw((conn) => {
    const topic = getTopicRow(key);
    if (!topic) return false;
    conn.run(
      `INSERT INTO topic_presence (topic_id, waiting, since_ms, until_ms, cancel_requested, updated_at)
       VALUES (:id, 0, 0, 0, 0, :at)
       ON CONFLICT(topic_id) DO UPDATE SET waiting = 0, since_ms = 0, until_ms = 0,
         cancel_requested = 0, updated_at = excluded.updated_at`,
      { id: topic.id, at: nowMs() }
    );
    updateTopic(key, {});
    return true;
  });
}

/** 读等待态原始行（没有 = null）。 */
export function getPresence(key) {
  const topic = getTopicRow(key);
  if (!topic) return null;
  return db().get('SELECT * FROM topic_presence WHERE topic_id = :id', { id: topic.id });
}

/**
 * 用户点「关闭」：只翻 cancel_requested 标记，**且只在真的在等时翻**。
 * @returns {boolean} 是否真的翻了（没在等 = false）
 */
export function requestCancel(key) {
  return txw((conn) => {
    const topic = getTopicRow(key);
    if (!topic) return false;
    const presence = conn.get('SELECT * FROM topic_presence WHERE topic_id = :id', { id: topic.id });
    const liveWaiting =
      presence && Number(presence.waiting) === 1 && Number(presence.until_ms) > nowMs();
    if (!liveWaiting) return false;
    conn.run(
      'UPDATE topic_presence SET cancel_requested = 1, updated_at = :at WHERE topic_id = :id',
      { id: topic.id, at: nowMs() }
    );
    updateTopic(key, {});
    return true;
  });
}

/**
 * wait 端轮询：是否被请求关闭；取到即清标记（只生效一次）。
 * @returns {boolean}
 */
export function consumeCancelRequest(key) {
  return txw((conn) => {
    const topic = getTopicRow(key);
    if (!topic) return false;
    const presence = conn.get('SELECT cancel_requested FROM topic_presence WHERE topic_id = :id', {
      id: topic.id,
    });
    if (!presence || !presence.cancel_requested) return false;
    conn.run(
      'UPDATE topic_presence SET cancel_requested = 0, updated_at = :at WHERE topic_id = :id',
      { id: topic.id, at: nowMs() }
    );
    updateTopic(key, {});
    return true;
  });
}

/** 清掉全部残留等待态（prune / 运维入口用；残留只污染这张小表，整表清空是安全的）。 */
export function clearAllPresence() {
  return txw((conn) => {
    conn.run("DELETE FROM topic_presence WHERE waiting = 0 AND cancel_requested = 0 AND until_ms = 0");
    return true;
  });
}
