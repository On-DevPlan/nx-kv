// 主题仓储（topics + topic_presence 的窄方法）。

import { db, txw } from './open.js';
import { nowMs, msToStamp } from '../../../core/db/time.js';
import { GLOBAL_TOPIC_KEY } from '../../../core/topic-key.js';
import { TOPIC_EXT, parseExt, jsonText } from './rows.js';
import { listTaskRowsByTopic, listAllTaskRows } from './tasks.js';

const SENTINEL_REPO = '__unbound__';

// 统一列清单：assembleTopic 读的是 camelCase 别名（createdAtMs/updatedAtMs），
// SELECT * 只有蛇形列名 —— 时间戳恒为空、面板排序失效都是从这里来的。
const TOPIC_SELECT = `SELECT id, key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
       deleted_at AS deletedAtMs, created_at AS createdAtMs, updated_at AS updatedAtMs
  FROM topics`;

/** 轻量主题行（不含任务）。软删的按不存在处理（restore 经 ensureTopic）。 */
export function getTopicRow(key) {
  return db().get(`${TOPIC_SELECT} WHERE key = :key AND deleted_at IS NULL`, { key });
}

/** 全部主题行（稳定序；不含软删）。 */
export function listTopicRows() {
  return db().all(`${TOPIC_SELECT} WHERE deleted_at IS NULL ORDER BY id`);
}

/**
 * 取（必要时新建）主题，返回内部行。
 * cwd 语义与 JSON 时代一致：**第一个路径为准**（稳定），后到的调用不覆盖已有 cwd。
 */
export function ensureTopic(key, { cwd = '', name = '' } = {}) {
  return txw((conn) => {
    const at = nowMs();
    let row = conn.get('SELECT id, cwd, name, ext, deleted_at FROM topics WHERE key = :key', { key });
    if (!row) {
      const ext = {};
      if (key === GLOBAL_TOPIC_KEY) ext[TOPIC_EXT.GLOBAL] = 1;
        conn.run(
          `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                               deleted_at, created_at, updated_at)
           VALUES (:key, :repo, :cwd, NULL, :name, 1, :ext, '', 0, NULL, :at, :at)`,
          {
            key,
            repo: SENTINEL_REPO,
            cwd: String(cwd || ''),
            name: String(name || (cwd ? String(cwd).split(/[\\/]/).pop() : key) || key),
            ext: jsonText(ext),
            at,
          }
        );
      row = conn.get('SELECT id, cwd, name, ext FROM topics WHERE key = :key', { key });
    } else if (row.deleted_at) {
      // 软删后再建同名队列 = 恢复那条行（同一个 key 就是同一个队列，任务/顺序都还在）
      conn.run('UPDATE topics SET deleted_at = NULL, updated_at = :at WHERE id = :id', { at, id: row.id });
      row = conn.get('SELECT id, cwd, name, ext FROM topics WHERE key = :key', { key });
    }
    if (row && cwd && !row.cwd) {
      conn.run('UPDATE topics SET cwd = :cwd, updated_at = :at WHERE id = :id', {
        cwd: String(cwd),
        at,
        id: row.id,
      });
      row = conn.get('SELECT id, cwd, name, ext FROM topics WHERE key = :key', { key });
    }
    return { id: Number(row.id), cwd: row.cwd || '', name: row.name || '', ext: parseExt(row.ext) };
  });
}

/** 组装 JSON 形态的主题对象（含 tasks / presence）。不存在返回 null。 */
export function getTopic(key) {
  const conn = db();
  const row = getTopicRow(key);
  if (!row) return null;
  return assembleTopic(conn, row);
}

/** 按内部 id 取主题（链节点归属用）。 */
export function getTopicById(id) {
  const conn = db();
  const row = conn.get(`${TOPIC_SELECT} WHERE id = :id AND deleted_at IS NULL`, { id });
  if (!row) return null;
  return assembleTopic(conn, row);
}

/** 全部主题（JSON 形态）。任务与 presence 一次批量取，避免逐主题 N+1。 */
export function listTopics() {
  const conn = db();
  const rows = listTopicRows();
  if (!rows.length) return [];
  const tasksByTopic = new Map();
  for (const x of listAllTaskRows(conn)) {
    const list = tasksByTopic.get(x.topicId) || [];
    list.push(x.task);
    tasksByTopic.set(x.topicId, list);
  }
  const presenceByTopic = new Map(
    conn.all('SELECT * FROM topic_presence').map((p) => [Number(p.topic_id), p])
  );
  return rows.map((row) =>
    assembleTopic(conn, row, {
      tasks: tasksByTopic.get(Number(row.id)) || [],
      presence: presenceByTopic.get(Number(row.id)) || null,
    })
  );
}

/** 行 + presence + 任务 + ext → JSON 形态主题（与旧 store.topics[key] 同形状）。 */
function assembleTopic(conn, row, preloaded = null) {
  const ext = parseExt(row.ext);
  const presence = preloaded
    ? preloaded.presence
    : conn.get('SELECT * FROM topic_presence WHERE topic_id = :id', { id: row.id });
  const tasks = preloaded
    ? preloaded.tasks
    : listTaskRowsByTopic(Number(row.id), conn).map((x) => x.task);
  const order = Array.isArray(ext[TOPIC_EXT.TASK_ORDER]) ? ext[TOPIC_EXT.TASK_ORDER].map(Number) : [];
  const bySeq = new Map(tasks.map((t) => [t.id, t]));
  // 队列顺序 = ext_task_order；没进单子的（新插入 / 迁移来的老数据）按 seq 补尾
  const ordered = [];
  const seen = new Set();
  for (const seq of order) {
    const t = bySeq.get(seq);
    if (t) {
      ordered.push(t);
      seen.add(seq);
    }
  }
  for (const t of tasks) {
    if (!seen.has(t.id)) ordered.push(t);
  }
  return {
    key: String(row.key),
    id: Number(row.id),
    cwd: String(row.cwd || ''),
    name: String(row.name || ''),
    summary: String(ext[TOPIC_EXT.LAST_SUMMARY] || ''),
    submitSummary: String(ext[TOPIC_EXT.SUBMIT_SUMMARY] || ''),
    manual: !!ext[TOPIC_EXT.MANUAL],
    workflowState: String(ext[TOPIC_EXT.WORKFLOW_STATE] || ''),
    workflowPlugins: Array.isArray(ext[TOPIC_EXT.WORKFLOW_PLUGINS]) ? ext[TOPIC_EXT.WORKFLOW_PLUGINS] : [],
    workflowRevision: Number(row.version) || 0,
    // 0 / 缺省 = "没发生过" → 空串（JSON 时代就是空串；epoch 0 会显示成 1970 年）
    createdAt: Number(row.createdAtMs) > 0 ? msToStamp(Number(row.createdAtMs)) : '',
    updatedAt: Number(row.updatedAtMs) > 0 ? msToStamp(Number(row.updatedAtMs)) : '',
    waiting: !!(presence && presence.waiting),
    waitingUntil: presence && Number(presence.until_ms) > 0 ? msToStamp(Number(presence.until_ms)) : '',
    waitingUntilMs: presence ? Number(presence.until_ms || 0) : 0,
    waitingSince: presence && Number(presence.since_ms) > 0 ? msToStamp(Number(presence.since_ms)) : '',
    // cwds（见过的路径）保持 JSON 形状：库里只有主 cwd，历史路径不再有地方放（T03 简化）
    cancelRequested: !!(presence && presence.cancel_requested),
    isGlobal: String(row.key) === GLOBAL_TOPIC_KEY,
    ext,
    tasks: ordered,
  };
}

/**
 * 更新主题级字段（轻量 patch，不触碰任务行）。
 * @param {object} patch
 *   { summary?, submitSummary?, manual?, workflowState?, workflowPlugins?,
 *     revision?(直接写 version), bumpRevision?:boolean, taskOrder?, name?, cwd? }
 */
export function updateTopic(key, patch = {}) {
  return txw((conn) => {
    const row = conn.get('SELECT id, ext, version FROM topics WHERE key = :key AND deleted_at IS NULL', { key });
    if (!row) return null;
    const ext = parseExt(row.ext);
    const sets = [];
    const params = { id: row.id, at: nowMs() };
    if (patch.summary !== undefined) ext[TOPIC_EXT.LAST_SUMMARY] = String(patch.summary ?? '');
    if (patch.submitSummary !== undefined) {
      ext[TOPIC_EXT.SUBMIT_SUMMARY] = String(patch.submitSummary ?? '');
    }
    if (patch.manual !== undefined) ext[TOPIC_EXT.MANUAL] = patch.manual ? 1 : 0;
    if (patch.workflowState !== undefined) {
      ext[TOPIC_EXT.WORKFLOW_STATE] = String(patch.workflowState || 'active');
    }
    if (patch.workflowPlugins !== undefined) {
      ext[TOPIC_EXT.WORKFLOW_PLUGINS] = Array.isArray(patch.workflowPlugins) ? patch.workflowPlugins : [];
    }
    if (patch.taskOrder !== undefined) {
      ext[TOPIC_EXT.TASK_ORDER] = (Array.isArray(patch.taskOrder) ? patch.taskOrder : []).map(Number);
    }
    sets.push('ext = :ext');
    params.ext = jsonText(ext);
    if (patch.bumpRevision) {
      sets.push('version = version + 1');
    } else if (patch.revision !== undefined) {
      sets.push('version = :version');
      params.version = Math.max(0, Number(patch.revision) || 0);
    }
    if (patch.name !== undefined) {
      sets.push('name = :name');
      params.name = String(patch.name ?? '');
    }
    if (patch.cwd !== undefined) {
      sets.push('cwd = :cwd');
      params.cwd = String(patch.cwd ?? '');
    }
    sets.push('updated_at = :at');
    conn.run(`UPDATE topics SET ${sets.join(', ')} WHERE id = :id`, params);
    const after = conn.get('SELECT version FROM topics WHERE id = :id', { id: row.id });
    return { id: Number(row.id), version: Number(after.version) };
  });
}

/**
 * 队列顺序单子：把 seq 数组写回 ext_task_order。
 * 与 JSON 时代的「数组位置即领取优先级」等价 —— **绝不改 seq**
 * （seq 是对外编号，trg_tasks_identity 锁死；交换编号会让历史引用指向别的任务）。
 */
export function setTaskOrder(key, seqs) {
  return updateTopic(key, { taskOrder: seqs });
}

/**
 * 在事务里改队列顺序：`fn(order)` 收到当前 seq 数组，返回新数组（或原地改后返回）。
 * 典型用法：addTask 追加（push）、插队首（unshift）、拖动排序（splice）。
 * 必须与任务行的写入包在**同一个外层事务**里（调用方用 repo.tx 包裹），
 * 否则「行写成功、顺序没跟上」会破坏队列序。
 */
export function mutateOrder(key, fn) {
  return txw((conn) => {
    const row = conn.get('SELECT id, ext FROM topics WHERE key = :key', { key });
    const ext = parseExt(row ? row.ext : '{}');
    const order = Array.isArray(ext[TOPIC_EXT.TASK_ORDER]) ? ext[TOPIC_EXT.TASK_ORDER].map(Number) : [];
    const next = fn(order) || order;
    ext[TOPIC_EXT.TASK_ORDER] = next.map(Number);
    conn.run('UPDATE topics SET ext = :ext, updated_at = :at WHERE key = :key', {
      ext: jsonText(ext),
      at: nowMs(),
      key,
    });
    return ext[TOPIC_EXT.TASK_ORDER];
  });
}

/**
 * 删主题：
 *   · 默认软删（deleted_at 打标，任务/依赖/presence 原样保留，ensureTopic 同名即恢复）；
 *   · purge=true 真删（FK 级联清任务/presence/goals）—— 只用于「全局池清空」这种
 *     同一个 key 永远会再出现的场景，否则下次 ensureTopic 会把旧任务复活。
 * @returns {boolean} 是否命中
 */
export function deleteTopic(key, { purge = false } = {}) {
  return txw((conn) => {
    if (purge) {
      const r = conn.run('DELETE FROM topics WHERE key = :key', { key });
      return Number(r.changes) > 0;
    }
    const at = nowMs();
    const r = conn.run(
      'UPDATE topics SET deleted_at = :at, updated_at = :at WHERE key = :key AND deleted_at IS NULL',
      { key, at }
    );
    return Number(r.changes) > 0;
  });
}

/**
 * 主题的待领取优先序（seq 数组）：ext_task_order 里仍处于 pending 的那些，
 * 单子里没有的 pending 按 seq 补尾 —— 与 JSON 数组序完全同构。
 */
export function pendingOrderOf(topic) {
  const pendingSeqs = topic.tasks
    .filter((t) => t.status === 'pending' && !t.deletedAt)
    .map((t) => t.id);
  const candidates = new Set(pendingSeqs);
  const ordered = [];
  const seen = new Set();
  for (const seq of topic.ext[TOPIC_EXT.TASK_ORDER] || []) {
    const n = Number(seq);
    if (candidates.has(n) && !seen.has(n)) {
      ordered.push(n);
      seen.add(n);
    }
  }
  for (const seq of pendingSeqs) {
    if (!seen.has(seq)) ordered.push(seq);
  }
  return ordered;
}

/**
 * prune 的数据形状判定：空主题 / 无 cwd 的旧模型主题 / allFinished 且无 pending。
 * 带保护规则的 deleteGuard 仍在 deletion.js（规则单一口径）。
 */
export function isPrunable(topic, { allFinished = false, hasPending = false } = {}) {
  const isLegacy = !topic.cwd;
  const isEmpty = topic.tasks.length === 0;
  const isFinished = allFinished && topic.tasks.length > 0 && !hasPending;
  return isLegacy || isEmpty || isFinished;
}
