// （#54 自 service.js 拆出）迁移原语（task move / 云端迁移编排用）：只读定位、
// 迁出 tombstone（目标端写成功后才调用）、撤销迁出、云端回插待领取首位。
import { badInput } from '../../core/errors.js';
import { normalizeCwd, resolveTaskKey } from './paths.js';
import { loadStore, saveStore, stampNow, normalizeText, topicOf, nextTaskId } from './store-io.js';
import { normalizeTask, isPending } from './task-view.js';
// ─── 迁移原语（task move 用；store 封装不外泄）─────────────────────
//
// 迁移的原子性在外层 move.js 编排（先写目标端、成功才改源端），
// 这里只提供对 store 的最小读写原语，保证清单/历史/原子写都走同一条管线。

/** 只读定位一条本机任务（不落写）。返回 {task, name, key, cwd} 或抛 notFound。 */
export async function getTopicTask({ cwd: rawCwd, key: rawKey, id } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  const store = await loadStore();
  const t = store.topics[key];
  const raw = t && t.tasks.find((x) => Number(x.id) === want);
  if (!raw) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : key}」里没有 #${want} 任务`);
  }
  return { task: normalizeTask(raw), key, cwd: t.cwd || '', name: t.name || key };
}

/** 给本机任务打迁出标记（tombstone）。只在目标端已写成功后调用。 */
export async function markTaskMigrated({ cwd: rawCwd, key: rawKey, id, migratedTo } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  if (!migratedTo || migratedTo.side !== 'cloud') throw badInput('migratedTo 必须是 {side:"cloud", topic, targetId, at}');
  const store = await loadStore();
  const t = store.topics[key];
  const raw = t && t.tasks.find((x) => Number(x.id) === want);
  if (!raw) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : key}」里没有 #${want} 任务`);
  }
  if (raw.status === 'consumed') {
    const { conflict } = await import('../../core/errors.js');
    throw conflict(`主题「${t.name}」#${want} 已被领取，不能再迁移`);
  }
  raw.migratedTo = { side: 'cloud', topic: String(migratedTo.topic || ''), targetId: Number(migratedTo.targetId) || 0, at: String(migratedTo.at || stampNow()) };
  t.updatedAt = stampNow();
  await saveStore(store);
  return { status: 'ok', key, cwd: t.cwd || '', name: t.name, task: normalizeTask(raw) };
}

/** 撤销迁出：清掉 migratedTo 标记，任务回到待领取首位。 */
export async function clearTaskMigrated({ cwd: rawCwd, key: rawKey, id, toTop = true } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  const store = await loadStore();
  const t = store.topics[key];
  const raw = t && t.tasks.find((x) => Number(x.id) === want);
  if (!raw) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : key}」里没有 #${want} 任务`);
  }
  if (!raw.migratedTo) {
    return { status: 'ok', restored: false, reason: 'not_migrated', key, name: t.name, task: normalizeTask(raw) };
  }
  delete raw.migratedTo;
  // 回到待领取首位：迁出时它占着优先级位置，撤销应原样归还
  if (toTop) {
    const idx = t.tasks.indexOf(raw);
    if (idx >= 0) t.tasks.splice(idx, 1);
    t.tasks.unshift(raw);
  }
  t.updatedAt = stampNow();
  await saveStore(store);
  return { status: 'ok', restored: true, key, cwd: t.cwd || '', name: t.name, task: normalizeTask(raw) };
}

/**
 * 云端 → 本机：把一条任务插到本机主题队列的**待领取首位**（不打扰 waiter——
 * 迁移是「排进队列」，不是「回填给正在等的 agent」，语义必须分开）。
 * 返回 {task, name, key, cwd}。
 */
export async function insertTaskAtTop({ cwd: rawCwd, key: rawKey, text, from = 'cloud' } = {}) {
  const body = normalizeText(text);
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const store = await loadStore();
  const t = topicOf(store, key, cwd);
  const task = normalizeTask({ id: nextTaskId(t.tasks), text: body, status: 'pending', createdAt: stampNow(), from });
  const firstPending = t.tasks.findIndex(isPending);
  if (firstPending >= 0) t.tasks.splice(firstPending, 0, task);
  else t.tasks.unshift(task);
  t.updatedAt = stampNow();
  await saveStore(store);
  return { status: 'ok', key, cwd: t.cwd || cwd, name: t.name, task };
}
