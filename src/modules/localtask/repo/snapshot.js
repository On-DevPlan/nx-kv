// WorkflowSnapshot 的 DB 适配（替换 store/topic-adapter.js 的 JSON 版）。
//
// 接口面与 JSON 版完全一致（get / set / has），SnapshotStore 与 DagMutator 不感知
// 存储换了。差别只有一个，而且是**变好**：CAS 从「先读后写」的两步（有竞态窗口）
// 变成**事务内**比较 —— 过期快照在 BEGIN IMMEDIATE 里被当场拒绝，不再依赖运气。
//
// revision 语义：topics.version 就是 revision（同一计数器，两个名字是历史遗留）。
//   - 外部写（任务行直改）→ bumpRevision（version+1）→ 在途快照必然 CAS 冲突 → fail-open 丢弃
//   - 引擎写 → set() 要求 snapshot.revision === version + 1，写完 version = revision
//
// 节点 → 任务行的写回口径与 core/workflow/project.js 的 applySnapshotToTopic 一致：
//   闸门（control / control scope 插件）→ blocks_following
//   node.state = success 且无 completedAt → 补 completedAt
//   node.state = running 且还没领走 → status = claimed
//   边 → 本地依赖取「现有 ∪ 快照边」的并集（外部直写的 blockBy 不能被引擎洗掉），
//        闸门推出来的边不写 blockBy（由 blocksFollowing 表达）
// 改动这两处语义时必须同步改 core/workflow/project.js（那边管 JSON 时代的口径）。
import { db, txw } from './open.js';
import { nowMs } from '../../../core/db/time.js';
import { parseExt, TOPIC_EXT } from './rows.js';
import { ensureTopic, updateTopic, getTopicRow } from './topics.js';
import { listTaskRowsByTopic, insertTask, updateTask } from './tasks.js';
import { topicToSnapshot } from '../../../core/workflow/project.js';

/** 主题行（+ 任务 + ext）→ 快照（只读投影）。不存在返回 null。 */
export function topicRowToSnapshot(conn, key) {
  const row = getTopicRow(key);
  if (!row) return null;
  const ext = parseExt(row.ext);
  const tasks = listTaskRowsByTopic(Number(row.id), conn).map((x) => x.task);
  const presence = conn.get('SELECT * FROM topic_presence WHERE topic_id = :id', { id: row.id });
  return topicToSnapshot({
    key,
    cwd: String(row.cwd || ''),
    name: String(row.name || ''),
    workflowState: ext[TOPIC_EXT.WORKFLOW_STATE] || 'active',
    workflowPlugins: Array.isArray(ext[TOPIC_EXT.WORKFLOW_PLUGINS]) ? ext[TOPIC_EXT.WORKFLOW_PLUGINS] : [],
    workflowRevision: Number(row.version) || 0,
    updatedAt: row.updatedAtMs ? new Date(Number(row.updatedAtMs)).toISOString() : '',
    waiting: !!(presence && presence.waiting),
    tasks,
  });
}

function isGateNode(node) {
  return node?.kind === 'control' || (node?.plugins || []).some((p) => p.scope === 'control');
}

function nowStamp() {
  return new Date(nowMs()).toISOString().replace('T', ' ').slice(0, 19);
}

/** DB 版 topic adapter：get / set / has（与 JSON 版 topic-adapter 同接口）。 */
export function createDbTopicAdapter() {
  return {
    /** @returns {object|null} WorkflowSnapshot */
    get(workflowId) {
      const conn = db();
      return topicRowToSnapshot(conn, String(workflowId));
    },

    has(workflowId) {
      return !!getTopicRow(String(workflowId));
    },

    /**
     * 原子覆盖（事务内 CAS）。
     * @throws {Error} code='CAS_CONFLICT' —— 快照已过期（外部写先落了盘）
     */
    set(snapshot) {
      const key = String(snapshot?.workflowId || '');
      if (!key) throw new Error('snapshot.workflowId required');
      return txw((conn) => {
        const topic = ensureTopic(key, {
          cwd: snapshot?.meta?.cwd || '',
          name: snapshot?.meta?.name || '',
        });
        const current = Number(
          (conn.get('SELECT version FROM topics WHERE id = :id', { id: topic.id }) || {}).version || 0
        );
        const incoming = Number(snapshot?.revision ?? 0);
        // 过期快照守卫：incoming < current = 落后的快照（外部写已把 version 顶过去）
        // → CAS 拒绝，绝不落盘。比较在 BEGIN IMMEDIATE 里做，比 JSON 版「先读后写」
        // 少一个竞态窗口。
        //   incoming === current：纯投影更新（store.create 的初始空快照 / 引擎重投影）；
        //   incoming === current + 1：saveAtomic 的正常推进（写完 version = incoming）。
        //   incoming > current：调用方把 revision 拔高 —— 与 JSON 版一致，照写
        //     （revision 是"谁后写谁赢"的凭证，不是连续计数器）。
        if (incoming < current) {
          const err = new Error(`CAS conflict: expected revision >= ${current}, got ${incoming}`);
          err.code = 'CAS_CONFLICT';
          throw err;
        }

        const rows = listTaskRowsByTopic(topic.id, conn);
        const byId = new Map(rows.map((x) => [String(x.task.id), x.task]));

        // ① 引擎新建的节点 → 补占位任务行（正文外置占位，同 JSON 版）
        for (const node of snapshot.nodes || []) {
          if (!byId.get(String(node.id))) {
            const created = insertTask(topic.id, {
              id: Number(node.id),
              text: '',
              status: 'pending',
              blocksFollowing: false,
              blockBy: [],
            });
            byId.set(String(node.id), created.task);
          }
        }

        // ② 闸门 / 节点状态 → 行字段
        for (const node of snapshot.nodes || []) {
          const task = byId.get(String(node.id));
          if (!task) continue;
          const patch = { blocksFollowing: isGateNode(node) };
          if (node.state === 'success') {
            if (!task.completedAt) patch.completedAt = nowStamp();
          } else if (node.state === 'running') {
            if (task.status !== 'claimed' && task.status !== 'done') patch.status = 'claimed';
          }
          const next = updateTask(topic.id, task.id, patch);
          if (next) byId.set(String(node.id), next);
        }

        // ③ 边 → 本地依赖（并集：外部直写的 blockBy 不能被引擎洗掉；闸门边不写 blockBy）
        const gateIds = new Set((snapshot.nodes || []).filter(isGateNode).map((n) => String(n.id)));
        for (const task of byId.values()) {
          if (task.deletedAt || task.migratedTo) continue;
          const keep = Array.isArray(task.blockBy) ? task.blockBy : [];
          const keepLocal = keep.filter((d) => !String(d).includes(':')).map(Number);
          const keepForeign = keep.filter((d) => String(d).includes(':')).map(String);
          const incomingLocal = [];
          for (const e of snapshot.edges || []) {
            if (String(e.to) !== String(task.id)) continue;
            if (gateIds.has(String(e.from))) continue;
            const n = Number(e.from);
            if (Number.isFinite(n) && n > 0) incomingLocal.push(n);
          }
          const merged = [...new Set([...keepLocal, ...incomingLocal])].sort((a, b) => a - b);
          updateTask(topic.id, task.id, { blockBy: [...merged, ...keepForeign] });
        }

        // ④ 版本 / 状态 / 插件 → topics（version 由 CAS 保证恰好 +1）
        updateTopic(key, {
          revision: incoming,
          workflowState: snapshot.state || 'active',
          workflowPlugins: Array.isArray(snapshot.workflowPlugins) ? snapshot.workflowPlugins : [],
        });
        return true;
      });
    },
  };
}
