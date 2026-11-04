// （#54 自 service.js 拆出）任务的删/批量删/恢复/排序：软删除（deletedAt + trashIndex）
// 与 purge 彻底摘除两套词汇；reorder 只在 pending 子序列内换位。
import { badInput } from '../../core/errors.js';
import { normalizeCwd, resolveTaskKey } from './paths.js';
import { loadStore, saveStore, stampNow } from './store-io.js';
import { normalizeTask, topicView } from './task-view.js';
export async function removeTask({ cwd: rawCwd, key: rawKey, id, purge = false } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');

  const store = await loadStore();
  const t = store.topics[key];
  const index = t ? t.tasks.findIndex((x) => Number(x.id) === want) : -1;
  if (index < 0) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : cwd}」里没有 #${want} 任务`);
  }
  const task = t.tasks[index];
  if (purge) {
    // 彻底清除：把行真的摘出去（不可恢复）。软删除区里的"清干净"用这个。
    t.tasks.splice(index, 1);
    t.updatedAt = stampNow();
    await saveStore(store);
    return { status: 'ok', purged: true, key, cwd: t.cwd || cwd, name: t.name, removed: normalizeTask(task) };
  }
  // 软删除：行留在原地，只打一个 deletedAt 标记。
  // 为什么不是直接删：删除是最容易让人后悔的一步，而"恢复"只要一条命令。
  // 词汇与同仓的 timegoal 对齐（那边是 archivedAt + 保留期 + purge）。
  // 行不摘出去 → nextTaskId 的 max 仍覆盖它，编号不会被复用 ✓
  task.deletedAt = stampNow();
  task.trashIndex = index; // 恢复时放回原位
  t.updatedAt = stampNow();
  await saveStore(store);
  return { status: 'ok', purged: false, key, cwd: t.cwd || cwd, name: t.name, removed: normalizeTask(task) };
}

/**
 * 批量删除（面板「删除选中 n」用）：一次 loadStore / saveStore 处理多条。
 *
 * 单条语义与 removeTask 完全一致（软删除打 deletedAt，purge 彻底摘除），
 * 但**不因个别 id 不存在而整体失败**：缺失的 id 收进 missing 让面板照实提示。
 * 为什么不做成「循环调 removeTask」：那会变成 N 次读盘 + N 次整份写盘，
 * 中间任何一次失败都会留下「删了一半、不知道删到哪」的状态。
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

  const store = await loadStore();
  const t = store.topics[key];
  const removed = [];
  const missing = [];
  for (const want of wants) {
    const index = t ? t.tasks.findIndex((x) => Number(x.id) === want) : -1;
    if (index < 0) {
      missing.push(want);
      continue;
    }
    const task = t.tasks[index];
    if (purge) {
      // 彻底清除：行真的摘出去（不可恢复）。与 removeTask 同一套词汇。
      t.tasks.splice(index, 1);
      removed.push({ ...normalizeTask(task), purged: true });
      continue;
    }
    if (!task.deletedAt) task.deletedAt = stampNow();
    task.trashIndex = index; // 恢复时放回原位（与 removeTask 一致）
    removed.push({ ...normalizeTask(task), purged: false });
  }
  if (removed.length) {
    t.updatedAt = stampNow();
    await saveStore(store);
  }
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
 * 恢复一条被软删除的任务（撤销删除）。
 * 与 removeTask 互为逆操作：任务仍在队列里，只是带着 deletedAt 标记。
 */
export async function restoreTask({ cwd: rawCwd, key: rawKey, id } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');

  const store = await loadStore();
  const t = store.topics[key];
  const task = t && t.tasks.find((x) => Number(x.id) === want);
  if (!task) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : cwd}」里没有 #${want} 任务`);
  }
  if (!task.deletedAt) {
    return { status: 'ok', restored: false, reason: 'not_deleted', key, cwd: t.cwd || cwd, name: t.name, task: normalizeTask(task) };
  }
  task.deletedAt = '';
  delete task.trashIndex;
  t.updatedAt = stampNow();
  await saveStore(store);
  return { status: 'ok', restored: true, key, cwd: t.cwd || cwd, name: t.name, task: normalizeTask(task) };
}
// 调整**待领取**任务的优先级：把 #id 移动到 #beforeId 之前或 #afterId 之后。
// 领取顺序 = tasks 数组里 pending 子序列的先后（consumeFirstPending 取第一条 pending），
// 故只在 pending 之间换位；已领取（历史）任务固定、不可移动。
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

  const store = await loadStore();
  const t = store.topics[key];
  if (!t) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题（key ${key}）不存在`);
  }
  const drag = t.tasks.find((x) => Number(x.id) === dragId);
  const target = t.tasks.find((x) => Number(x.id) === targetId);
  if (!drag || !target) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(
      `主题「${t.name}」里找不到任务 #${drag ? targetId : dragId}`
    );
  }
  if (drag.status === 'consumed' || target.status === 'consumed') {
    throw badInput('只有「待领取」任务可以调整优先级（已领取任务是固定历史）');
  }

  const from = t.tasks.indexOf(drag);
  t.tasks.splice(from, 1);
  const ti = t.tasks.indexOf(target); // 删除 drag 后目标下标自动修正
  t.tasks.splice(hasBefore ? ti : ti + 1, 0, drag);
  t.updatedAt = stampNow();

  await saveStore(store);
  return { status: 'ok', key, cwd: t.cwd || '', name: t.name, topic: topicView(t) };
}
