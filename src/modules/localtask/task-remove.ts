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

/** 任务操作的公共入参（--cwd/--key + id(s)）。 */
export interface TaskOpAddress {
  cwd?: string;
  key?: string;
  id?: number | string;
  ids?: unknown;
}

/** removeTask / restoreTask 的出站形状。 */
export interface TaskRemoveResult {
  status: string;
  purged?: boolean;
  restored?: boolean;
  reason?: string;
  key: string;
  cwd: string;
  name: string;
  task?: Record<string, any>;
  removed?: Record<string, any>;
  [k: string]: any;
}

function locate(key: string, want: number, { cwd = '' }: { cwd?: string } = {}): { t: any; task: any } {
  const t = topicsRepo.getTopic(key);
  const task = t && t.tasks.find((x: any) => Number(x.id) === want);
  if (!task) {
    throw notFoundImpl(`主题「${t ? t.name : cwd}」里没有 #${want} 任务`);
  }
  return { t, task };
}

/** removeTask 的选项。 */
export interface RemoveTaskInput extends TaskOpAddress {
  purge?: boolean;
}

export async function removeTask({ cwd: rawCwd, key: rawKey, id, purge = false }: RemoveTaskInput = {}): Promise<TaskRemoveResult> {
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

/** removeTasks / cancelTasks / closeTasks 的选项。 */
export interface BatchTaskInput {
  cwd?: string;
  key?: string;
  ids?: unknown;
  purge?: boolean;
}

/**
 * 批量删除（面板「删除选中 n」用）：一个事务处理多条。
 *
 * 单条语义与 removeTask 完全一致（软删除打 deletedAt，purge 彻底摘除），
 * 但**不因个别 id 不存在而整体失败**：缺失的 id 收进 missing 让面板照实提示。
 *
 * 重复删除同一条是幂等的（deletedAt 已有值就不再改写时间戳）。
 */
export async function removeTasks({ cwd: rawCwd, key: rawKey, ids, purge = false }: BatchTaskInput = {}): Promise<Record<string, any>> {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const wants = (Array.isArray(ids) ? ids : [ids])
    .map((x) => Number(String(x ?? '').trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!wants.length) throw badInput('缺少参数 --ids <任务编号，逗号分隔或给多次>');

  openStore();
  const t = topicsRepo.getTopic(key);
  const topicId: number | null = t ? t.id : null;
  const removed: Array<Record<string, any>> = [];
  const missing: number[] = [];
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
        tasksRepo.purgeTask(topicId!, want);
        removed.push({ ...normalizeTask(cur.task), purged: true });
        continue;
      }
      const patch: Record<string, any> = { trashIndex: want };
      if (!cur.task.deletedAt) patch.deletedAt = delStamp;
      const next = tasksRepo.updateTask(topicId!, want, patch);
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

/** cancelTasks / closeTasks 的选项。 */
export interface CancelCloseTaskInput {
  cwd?: string;
  key?: string;
  ids?: unknown;
  status?: string;
  summary?: string;
}

/**
 * 批量取消待领取任务（面板「取消选中 n」用）：一个事务处理多条。
 *
 * 只接受 pending 任务：已领取（可能有 agent 正在处理）、已完成、已取消都跳过，
 * 避免误伤正在跑的会话或已留档的交付记录。取消是终态，原文保留，不写 roundSummary。
 */
export async function cancelTasks({ cwd: rawCwd, key: rawKey, ids }: CancelCloseTaskInput = {}): Promise<Record<string, any>> {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const wants = (Array.isArray(ids) ? ids : [ids])
    .map((x) => Number(String(x ?? '').trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!wants.length) throw badInput('缺少参数 --ids <任务编号，逗号分隔或给多次>');

  openStore();
  const t = topicsRepo.getTopic(key);
  const topicId: number | null = t ? t.id : null;
  const cancelled: Array<Record<string, any>> = [];
  const missing: number[] = [];
  const skipped: Array<Record<string, any>> = [];
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
      const next = tasksRepo.updateTask(topicId!, want, { status: 'cancelled' });
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
 * 批量收口「还没结束」的任务（面板「标为完成 / 取消」用）：**不要求先领取**。
 *
 * 场景一（原意）：有的任务在队列里等着被领，但其实用户已经自己干完了（或决定不做）。
 * 场景二（#184）：任务已经被 agent 领走、正在跑，用户在面板上想自己拍板收掉——
 *               以前 claimed 一律跳过，等于面板上「正在跑的任务」没有任何收口入口。
 * - status=done：写完成总结与完成时刻
 * - status=cancelled：只改状态（与 cancelTasks 同口径，原文留档）
 * 已完成、已取消、已删除、已迁移都跳过（终态幂等：重复点不会改写历史）。
 */
export async function closeTasks({ cwd: rawCwd, key: rawKey, ids, status = 'done', summary = '' }: CancelCloseTaskInput = {}): Promise<Record<string, any>> {
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
  const topicId: number | null = t ? t.id : null;
  const closed: Array<Record<string, any>> = [];
  /** 本轮里「原本已被领取」的那几条（面板据此提示「其中 N 条正在跑」）。 */
  const claimedClosed: number[] = [];
  const missing: number[] = [];
  const skipped: Array<Record<string, any>> = [];
  // 默认完成总结按「收口前的状态」区分：用户自己没写总结时，事后看反馈要能分清
  // 是「队列里没人领就已经做完」还是「agent 正在跑、用户从面板直接拍板」。
  const defaultFeedback = (wasClaimed: boolean, claimedByName: string): string => {
    if (!wasClaimed) return '用户确认已完成（任务未领取，直接关闭）';
    const who = String(claimedByName ?? '').trim();
    return who
      ? `用户确认已完成（面板直接收口；该任务由 ${who} 领取中，agent 侧回执会被忽略）`
      : '用户确认已完成（面板直接收口；该任务已被领取，agent 侧回执会被忽略）';
  };
  tx(() => {
    for (const want of wants) {
      const cur = topicId ? tasksRepo.getTaskRow(topicId, want) : null;
      if (!cur) {
        missing.push(want);
        continue;
      }
      const st = String(cur.task.status ?? '');
      const open = !cur.task.migratedTo && !cur.task.deletedAt && (st === 'pending' || st === 'claimed');
      if (!open) {
        skipped.push({
          id: want,
          status: st,
          reason: cur.task.migratedTo ? 'migrated' : cur.task.deletedAt ? 'deleted' : 'already_closed',
        });
        continue;
      }
      const feedback =
        wantStatus === 'done'
          ? String(summary ?? '').trim() || defaultFeedback(st === 'claimed', cur.task.claimedByName)
          : '';
      const ok = tasksRepo.closeOpenTask(topicId!, want, { status: wantStatus, feedback });
      if (!ok) {
        // 并发：本轮校验通过、写时状态已被别处改掉（守卫拦下）
        skipped.push({ id: want, status: st, reason: 'raced' });
        continue;
      }
      closed.push(normalizeTask(tasksRepo.getTaskRow(topicId!, want)!.task));
      if (st === 'claimed') claimedClosed.push(want);
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
    claimedClosed,
    missing,
    skipped,
    count: closed.length,
  };
}

/**
 * 恢复一条被软删除的任务（撤销删除）。
 * 与 removeTask 互为逆操作：任务仍在队列里，只是带着 deletedAt 标记。
 */
export async function restoreTask({ cwd: rawCwd, key: rawKey, id }: TaskOpAddress = {}): Promise<TaskRemoveResult> {
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

/** reorderTasks 的选项。 */
export interface ReorderTasksInput {
  cwd?: string;
  key?: string;
  id?: number | string;
  beforeId?: number | string | null;
  afterId?: number | string | null;
}

// 调整**待领取**任务的优先级：把 #id 移动到 #beforeId 之前或 #afterId 之后。
// 领取顺序 = ext_task_order 里 pending 子序列的先后（consumeFirstPending 取第一条可领），
// 故只在 pending 之间换位；已领取（历史）任务固定、不可移动。
// **seq 不动**：它是对外编号（trg_tasks_identity 锁死）；这里只改顺序单子。
export async function reorderTasks({ cwd: rawCwd, key: rawKey, id, beforeId, afterId }: ReorderTasksInput = {}): Promise<Record<string, any>> {
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
  const drag = t.tasks.find((x: any) => Number(x.id) === dragId);
  const target = t.tasks.find((x: any) => Number(x.id) === targetId);
  if (!drag || !target) {
    throw notFoundImpl(`主题「${t.name}」里找不到任务 #${drag ? targetId : dragId}`);
  }
  if (drag.status !== 'pending' || target.status !== 'pending') {
    throw badInput('只有「待领取」任务可以调整优先级（已领取/已完成的任务是固定历史）');
  }

  tx(() => {
    topicsRepo.mutateOrder(key, (order) => {
      // 单子里没有的（新插入未记录）先补齐，再做与 JSON 数组等价的 splice
      const list = [...order];
      for (const s of t.tasks.map((x: any) => x.id)) {
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
