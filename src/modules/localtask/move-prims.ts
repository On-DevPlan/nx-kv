// （#54 自 service.js 拆出）迁移原语（task move / 云端迁移编排用）：只读定位、
// 迁出 tombstone（目标端写成功后才调用）、撤销迁出、云端回插待领取首位。
//
// T03：写入走 repo 的窄方法。「回到待领取首位」「插到待领取首位」都落在
// ext_task_order 的头部 —— 与 JSON 时代 splice(0) 等价，seq 一个不动。
import { badInput } from '../../core/errors.js';
import { normalizeCwd, resolveTaskKey } from './paths.js';
import { normalizeText } from './store-io.js';
import { openLocaltaskStore as openStore, topics as topicsRepo, tasks as tasksRepo, txw as tx } from './repo/index.js';
import { normalizeTask } from './task-view.js';
// ─── 迁移原语（task move 用；store 封装不外泄）─────────────────────
//
// 迁移的原子性在外层 move.js 编排（先写目标端、成功才改源端），
// 这里只提供最小读写原语，保证清单/历史/原子性都走同一条管线。

/** 任务寻址入参（--cwd/--key + --id）。 */
export interface TaskAddressInput {
  cwd?: string;
  key?: string;
  id?: number | string;
}

/** getTopicTask / insertTaskAtTop 的出站形状（insertTaskAtTop 额外带 status）。
 *  cwd 可缺省：clearTaskMigrated 的 not_migrated 分支原样不返回 cwd（与原 .js 一致）。 */
export interface TopicTaskResult {
  status?: string;
  task: Record<string, any>;
  key: string;
  cwd?: string;
  name: string;
}

/** markTaskMigrated / clearTaskMigrated 的出站形状。 */
export interface MigrateResult extends TopicTaskResult {
  status: string;
  restored?: boolean;
  reason?: string;
}

/** 只读定位一条本机任务（不落写）。返回 {task, name, key, cwd} 或抛 notFound。 */
export async function getTopicTask({ cwd: rawCwd, key: rawKey, id }: TaskAddressInput = {}): Promise<TopicTaskResult> {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  openStore();
  const t = topicsRepo.getTopic(key);
  const raw = t && t.tasks.find((x: any) => Number(x.id) === want);
  if (!raw) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : key}」里没有 #${want} 任务`);
  }
  return { task: normalizeTask(raw), key, cwd: t.cwd || '', name: t.name || key };
}

/** markTaskMigrated 的入参（migratedTo tombstone 必须带 side:"cloud"）。 */
export interface MarkMigratedInput extends TaskAddressInput {
  migratedTo?: { side?: string; topic?: string; targetId?: number | string; at?: string };
}

/** 给本机任务打迁出标记（tombstone）。只在目标端已写成功后调用。 */
export async function markTaskMigrated({ cwd: rawCwd, key: rawKey, id, migratedTo }: MarkMigratedInput = {}): Promise<MigrateResult> {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  if (!migratedTo || migratedTo.side !== 'cloud') throw badInput('migratedTo 必须是 {side:"cloud", topic, targetId, at}');
  openStore();
  const t = topicsRepo.getTopic(key)!;
  const raw = t && t.tasks.find((x: any) => Number(x.id) === want);
  if (!raw) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t.name || key}」里没有 #${want} 任务`);
  }
  // 只有「待领取」能迁出：已领取（在干）与已交付（终态）都不该被搬走
  if (raw.status !== 'pending') {
    const { conflict } = await import('../../core/errors.js');
    throw conflict(`主题「${t.name}」#${want} 不是待领取（已领取/已交付），不能再迁移`);
  }
  const next = tx(() => {
    const out = tasksRepo.updateTask(t.id, want, {
      migratedTo: {
        side: 'cloud',
        topic: String(migratedTo!.topic || ''),
        targetId: Number(migratedTo!.targetId) || 0,
        at: String(migratedTo!.at || new Date().toISOString().replace('T', ' ').slice(0, 19)),
      },
    });
    topicsRepo.updateTopic(key, { bumpRevision: true });
    return out;
  });
  return { status: 'ok', key, cwd: t.cwd || '', name: t.name, task: normalizeTask(next) };
}

/** clearTaskMigrated 的选项（toTop = 是否回到待领取首位）。 */
export interface ClearMigratedInput extends TaskAddressInput {
  toTop?: boolean;
}

/** 撤销迁出：清掉 migratedTo 标记，任务回到待领取首位。 */
export async function clearTaskMigrated({ cwd: rawCwd, key: rawKey, id, toTop = true }: ClearMigratedInput = {}): Promise<MigrateResult> {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  openStore();
  const t = topicsRepo.getTopic(key)!;
  const raw = t && t.tasks.find((x: any) => Number(x.id) === want);
  if (!raw) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : key}」里没有 #${want} 任务`);
  }
  if (!raw.migratedTo) {
    return { status: 'ok', restored: false, reason: 'not_migrated', key, name: t.name, task: normalizeTask(raw) };
  }
  const next = tx(() => {
    const out = tasksRepo.updateTask(t.id, want, { migratedTo: null });
    if (toTop) {
      // 回到待领取首位：迁出时它占着优先级位置，撤销应原样归还
      topicsRepo.mutateOrder(key, (order) => {
        const list = [...order];
        for (const s of t.tasks.map((x: any) => x.id)) if (!list.includes(Number(s))) list.push(Number(s));
        const at = list.indexOf(want);
        if (at >= 0) list.splice(at, 1);
        list.unshift(want);
        return list;
      });
    }
    topicsRepo.updateTopic(key, { bumpRevision: true });
    return out;
  });
  return { status: 'ok', restored: true, key, cwd: t.cwd || '', name: t.name, task: normalizeTask(next) };
}

/** insertTaskAtTop 的入参。 */
export interface InsertTaskAtTopInput {
  cwd?: string;
  key?: string;
  text?: string;
  from?: string;
}

/**
 * 云端 → 本机：把一条任务插到本机主题队列的**待领取首位**（不打扰 waiter——
 * 迁移是「排进队列」，不是「回填给正在等的 agent」，语义必须分开）。
 * 返回 {task, name, key, cwd}。
 */
export async function insertTaskAtTop({ cwd: rawCwd, key: rawKey, text, from = 'cloud' }: InsertTaskAtTopInput = {}): Promise<TopicTaskResult> {
  const body = normalizeText(text);
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  openStore();
  const res = tx(() => {
    const topic = topicsRepo.ensureTopic(key, { cwd });
    const { task } = tasksRepo.insertTask(topic.id, {
      text: body,
      status: 'pending',
      from,
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });
    topicsRepo.mutateOrder(key, (order) => {
      const list = [...order];
      const at = list.indexOf(task.id);
      if (at >= 0) list.splice(at, 1);
      list.unshift(task.id);
      return list;
    });
    topicsRepo.updateTopic(key, { bumpRevision: true });
    return task;
  });
  const t = topicsRepo.getTopic(key)!;
  return { status: 'ok', key, cwd: t.cwd || cwd, name: t.name, task: normalizeTask(res) };
}
