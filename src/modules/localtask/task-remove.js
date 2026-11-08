// （#54 自 service.js 拆出）任务的删/批量删/恢复/排序：软删除（deletedAt + trashIndex）
// 与 purge 彻底摘除两套词汇；reorder 只在 pending 子序列内换位。
//
// T03：写入走 repo.tasks / repo.topics 的窄方法。**顺序（优先级）不在 seq 里** ——
// seq 是对外编号、不可变（trg_tasks_identity 锁死），拖动排序改的是
// topics.ext.ext_task_order（JSON 数组序的等价物，见 repo/topics.js 顶部说明）。
import { badInput, notFound as notFoundImpl } from '../../core/errors.js';
import { normalizeCwd, resolveTaskKey } from './paths.js';
import { openLocaltaskStore as openStore, topics as topicsRepo, tasks as tasksRepo, txw as tx } from './repo/index.js';
import { normalizeTask, topicView } from './task-view.js';

function locate(key, want, { cwd = '' } = {}) {
  const t = topicsRepo.getTopic(key);
  const task = t && t.tasks.find((x) => Number(x.id) === want);
  if (!task) {
    throw notFoundImpl(`主题「${t ? t.name : cwd}」里没有 #${want} 任务`);
  }
  return { t, task };
}

export async function removeTask({ cwd: rawCwd, key: rawKey, id, purge = false } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');

  openStore();
  const { t, task } = locate(key, want, { cwd });
  const topicId = t.id;
  if (purge) {
    // 彻底清除：把行真的摘出去（不可恢复）。软删除区里的"清干净"用这个。
    tx(() => {
      const ok = tasksRepo.purgeTask(topicId, want);
      if (ok) {
        topicsRepo.mutateOrder(key, (order) => order.filter((s) => s !== want));
        topicsRepo.updateTopic(key, { bumpRevision: true });
      }
      return ok;
    });
    return { status: 'ok', purged: true, key, cwd: t.cwd || cwd, name: t.name, removed: normalizeTask(task) };
  }
  // 软删除：行留在原地，只打一个 deletedAt 标记。
  // 为什么不是直接删：删除是最容易让人后悔的一步，而"恢复"只要一条命令。
  // 词汇与同仓的 timegoal 对齐（那边是 archivedAt + 保留期 + purge）。
  // 行不摘出去 → 编号不会被复用 ✓（deleted_at 只是把行挡在派发之外）
  const next = tx(() => {
    const out = tasksRepo.updateTask(topicId, want, {
      deletedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      trashIndex: want, // 恢复时放回原位（旧字段语义保留在 ext）
    });
    topicsRepo.updateTopic(key, { bumpRevision: true });
    return out;
  });
  return { status: 'ok', purged: false, key, cwd: t.cwd || cwd, name: t.name, removed: normalizeTask(next) };
}

/**
 * 批量删除（面板「删除选中 n」用）：一个事务处理多条。
 *
 * 单条语义与 removeTask 完全一致（软删除打 deletedAt，purge 彻底摘除），
 * 但**不因个别 id 不存在而整体失败**：缺失的 id 收进 missing 让面板照实提示。
 *
 * 重复删除同一条是幂等的（deletedAt 已有值就不再改写时间戳）。
 */
export async function removeTasks({ cwd: rawCwd, key: rawKey, ids, purge = false } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const wants = (Array.isArray(ids) ? ids : [ids])
    .map((x) => Number(String(x ?? '').trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!wants.length) throw badInput('缺少参数 --ids <任务编号，逗号分隔或给多次>');

  openStore();
  const t = topicsRepo.getTopic(key);
  const topicId = t ? t.id : null;
  const removed = [];
  const missing = [];
  const delStamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const out = tx(() => {
    for (const want of wants) {
      const cur = topicId ? tasksRepo.getTaskRow(topicId, want) : null;
      if (!cur) {
        missing.push(want);
        continue;
      }
      if (purge) {
        // 彻底清除：行真的摘出去（不可恢复）。与 removeTask 同一套词汇。
        tasksRepo.purgeTask(topicId, want);
        removed.push({ ...normalizeTask(cur.task), purged: true });
        continue;
      }
      const patch = { trashIndex: want };
      if (!cur.task.deletedAt) patch.deletedAt = delStamp;
      const next = tasksRepo.updateTask(topicId, want, patch);
      removed.push({ ...normalizeTask(next), purged: false });
    }
    if (removed.length) topicsRepo.updateTopic(key, { bumpRevision: true });
    if (purge && removed.length) {
      topicsRepo.mutateOrder(key, (order) => order.filter((s) => !removed.some((r) => r.id === s)));
    }
    return true;
  });
  void out;
  return {
    status: 'ok',
    key,
    cwd: t ? t.cwd || cwd : cwd,
    name: t ? t.name : key,
    purged: !!purge,
    removed,
    missing,
    count: removed.length,
  };
}

/**
 * 批量取消待领取任务（面板「取消选中 n」用）：一个事务处理多条。
 *
 * 只接受 pending 任务：已领取（可能有 agent 正在处理）、已交付、已取消都跳过，
 * 避免误伤正在跑的会话或已留档的交付记录。取消是终态，原文保留，不写 roundSummary。
 */
export async function cancelTasks({ cwd: rawCwd, key: rawKey, ids } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const wants = (Array.isArray(ids) ? ids : [ids])
    .map((x) => Number(String(x ?? '').trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!wants.length) throw badInput('缺少参数 --ids <任务编号，逗号分隔或给多次>');

  openStore();
  const t = topicsRepo.getTopic(key);
  const topicId = t ? t.id : null;
  const cancelled = [];
  const missing = [];
  const skipped = [];
  tx(() => {
    for (const want of wants) {
      const cur = topicId ? tasksRepo.getTaskRow(topicId, want) : null;
      if (!cur) {
        missing.push(want);
        continue;
      }
      if (cur.task.status !== 'pending' || cur.task.migratedTo || cur.task.deletedAt) {
        skipped.push({
          id: want,
          status: cur.task.status,
          reason: cur.task.migratedTo ? 'migrated' : cur.task.deletedAt ? 'deleted' : 'not_pending',
        });
        continue;
      }
      const next = tasksRepo.updateTask(topicId, want, { status: 'cancelled' });
      cancelled.push(normalizeTask(next));
    }
    if (cancelled.length) topicsRepo.updateTopic(key, { bumpRevision: true });
    return true;
  });
  return {
    status: 'ok',
    key,
    cwd: t ? t.cwd || cwd : cwd,
    name: t ? t.name : key,
    cancelled,
    missing,
    skipped,
    count: cancelled.length,
  };
}

/**
 * 批量收口「待领取」任务（面板「标为完成 / 取消」用）：**不要求先领取**。
 *
 * 场景：有的任务在队列里等着被领，但其实用户已经自己干完了（或决定不做）。
 * 以前只有 agent 领取后走 completeTask 才能收口；这里补上用户侧的直接操作。
 * - status=done：写完成总结与完成时刻（总结缺省为「用户确认已完成（任务未领取，直接关闭）」）
 * - status=cancelled：只改状态（与 cancelTasks 同口径，原文留档）
 * 已领取（可能有 agent 正在处理）、已交付、已取消、已删除都跳过。
 */
export async function closeTasks({ cwd: rawCwd, key: rawKey, ids, status = 'done', summary = '' } = {}) {
  const wantStatus = String(status ?? 'done');
  if (wantStatus !== 'done' && wantStatus !== 'cancelled') {
    throw badInput('--status 只接受 done / cancelled');
  }
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const wants = (Array.isArray(ids) ? ids : [ids])
    .map((x) => Number(String(x ?? '').trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!wants.length) throw badInput('缺少参数 --ids <任务编号，逗号分隔或给多次>');

  openStore();
  const t = topicsRepo.getTopic(key);
  const topicId = t ? t.id : null;
  const closed = [];
  const missing = [];
  const skipped = [];
  const feedback =
    wantStatus === 'done'
      ? String(summary ?? '').trim() || '用户确认已完成（任务未领取，直接关闭）'
      : '';
  tx(() => {
    for (const want of wants) {
      const cur = topicId ? tasksRepo.getTaskRow(topicId, want) : null;
      if (!cur) {
        missing.push(want);
        continue;
      }
      if (cur.task.status !== 'pending' || cur.task.migratedTo || cur.task.deletedAt) {
        skipped.push({
          id: want,
          status: cur.task.status,
          reason: cur.task.migratedTo ? 'migrated' : cur.task.deletedAt ? 'deleted' : 'not_pending',
        });
        continue;
      }
      const ok = tasksRepo.closePendingTask(topicId, want, { status: wantStatus, feedback });
      if (!ok) {
        skipped.push({ id: want, status: cur.task.status, reason: 'not_pending' });
        continue;
      }
      closed.push(normalizeTask(tasksRepo.getTaskRow(topicId, want).task));
    }
    if (closed.length) topicsRepo.updateTopic(key, { bumpRevision: true });
    return true;
  });
  return {
    status: 'ok',
    key,
    cwd: t ? t.cwd || cwd : cwd,
    name: t ? t.name : key,
    closeStatus: wantStatus,
    closed,
    missing,
    skipped,
    count: closed.length,
  };
}

/**
 * 恢复一条被软删除的任务（撤销删除）。
 * 与 removeTask 互为逆操作：任务仍在队列里，只是带着 deletedAt 标记。
 */
export async function restoreTask({ cwd: rawCwd, key: rawKey, id } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');

  openStore();
  const { t, task } = locate(key, want, { cwd });
  if (!task.deletedAt) {
    return { status: 'ok', restored: false, reason: 'not_deleted', key, cwd: t.cwd || cwd, name: t.name, task: normalizeTask(task) };
  }
  const next = tx(() =>
    tasksRepo.updateTask(t.id, want, { deletedAt: '', trashIndex: undefined })
  );
  topicsRepo.updateTopic(key, { bumpRevision: true });
  return { status: 'ok', restored: true, key, cwd: t.cwd || cwd, name: t.name, task: normalizeTask(next) };
}

// 调整**待领取**任务的优先级：把 #id 移动到 #beforeId 之前或 #afterId 之后。
// 领取顺序 = ext_task_order 里 pending 子序列的先后（consumeFirstPending 取第一条可领），
// 故只在 pending 之间换位；已领取（历史）任务固定、不可移动。
// **seq 不动**：它是对外编号（trg_tasks_identity 锁死）；这里只改顺序单子。
export async function reorderTasks({ cwd: rawCwd, key: rawKey, id, beforeId, afterId } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const dragId = Number(id);
  const hasBefore = beforeId !== undefined && beforeId !== null;
  const hasAfter = afterId !== undefined && afterId !== null;

  if (!Number.isFinite(dragId) || dragId <= 0) {
    throw badInput('reorder 缺少 --id <要移动的任务编号>');
  }
  if (hasBefore === hasAfter) {
    throw badInput('reorder 需且仅需 --before <编号> 或 --after <编号> 之一');
  }
  const targetId = Number(hasBefore ? beforeId : afterId);
  if (!Number.isFinite(targetId) || targetId <= 0) {
    throw badInput('reorder 的目标任务编号非法');
  }
  if (targetId === dragId) throw badInput('不能把任务移动到它自己旁边');

  openStore();
  const t = topicsRepo.getTopic(key);
  if (!t) {
    throw notFoundImpl(`主题（key ${key}）不存在`);
  }
  const drag = t.tasks.find((x) => Number(x.id) === dragId);
  const target = t.tasks.find((x) => Number(x.id) === targetId);
  if (!drag || !target) {
    throw notFoundImpl(`主题「${t.name}」里找不到任务 #${drag ? targetId : dragId}`);
  }
  if (drag.status !== 'pending' || target.status !== 'pending') {
    throw badInput('只有「待领取」任务可以调整优先级（已领取/已交付的任务是固定历史）');
  }

  tx(() => {
    topicsRepo.mutateOrder(key, (order) => {
      // 单子里没有的（新插入未记录）先补齐，再做与 JSON 数组等价的 splice
      const list = [...order];
      for (const s of t.tasks.map((x) => x.id)) {
        if (!list.includes(Number(s))) list.push(Number(s));
      }
      const from = list.indexOf(dragId);
      if (from >= 0) list.splice(from, 1);
      const ti = list.indexOf(targetId); // 移除 drag 后目标下标自动修正
      list.splice(hasBefore ? ti : ti + 1, 0, dragId);
      return list;
    });
    topicsRepo.updateTopic(key, { bumpRevision: true });
    return true;
  });
  return { status: 'ok', key, cwd: t.cwd || '', name: t.name, topic: topicView(topicsRepo.getTopic(key)) };
}
