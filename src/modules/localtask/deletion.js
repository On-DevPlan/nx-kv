// （#54 自 service.js 拆出）主题删除：四条删除路径共用的同一套判定（deleteGuard：
// 全局池/等待中/有未领取 → 需 --force）+ 单个/批量删除。
//
// 删除 = 软删 topics 行（deleted_at 打标；任务/依赖/presence 保留，同名目录再出现即恢复）。
// 全局池例外：同一个 key 永远会再出现，软删会被下一次 ensureTopic 复活成「没删掉」，
// 所以 force 清空全局池走真删（FK 级联清任务）。
import { badInput } from '../../core/errors.js';
import { isGlobalKey, normalizeCwd, resolveTopicKey } from './paths.js';
import { openLocaltaskStore as openStore, topics as topicsRepo } from './repo/index.js';
import { isLiveWaiting, isPending, topicView } from './task-view.js';
// ─── 删除判定：四条删除路径共用同一套规则 ──────────────────────────────
//
// 以前「删任务 / 删主题 / 批量删除 / prune」各有各的保护规则，
// 面板只暴露其中两套 → 同一个动作在 CLI 与面板上表现不一样，看着像乱。
// 现在规则只写一份，四个入口都调它：
//
//   protected（全局共享池）→ 需要 --force
//   waiting（正阻塞等待）  → 需要 --force（agent 会超时收尾）
//   has_pending（有未领取）→ 需要 --force（活还没人领）
//   manual（手动登记的目录）→ 只在 prune 里保留，不参与普通删除
//
// force=true 仍然强删（老用法不变）。
export const DELETE_REASONS = {
  protected: '全局共享池',
  waiting: '等待中',
  has_pending: '有未领取任务',
  manual: '手动登记',
};

/**
 * 判定一个主题能不能删。
 * @returns {{ok:boolean, reason?:string, pending?:number, message?:string}}
 */
export function deleteGuard(topic, { force = false, key = '', scope = 'topic' } = {}) {
  if (isGlobalKey(key)) {
    return force
      ? { ok: true }
      : { ok: false, reason: 'protected', message: '全局主题是共享任务池，默认不能删除（确认要清空请加 --force）' };
  }
  if (isLiveWaiting(topic)) {
    return force
      ? { ok: true }
      : { ok: false, reason: 'waiting', message: '主题正在等待中，不能删除（确认要删请加 --force，agent 将超时收尾）' };
  }
  const pending = countPending(topic);
  // prune 只清"旧脏数据"，不是"删主题"：它不因未领取任务而跳过
  //（否则会改变 prune 既有语义——它本来就只清空主题/旧模型主题）。
  if (scope !== 'prune' && pending > 0 && !force) {
    return {
      ok: false,
      reason: 'has_pending',
      pending,
      message: `主题「${topic.name || key}」还有 ${pending} 条未领取任务，删除会一并丢掉（确认要删请加 --force）`,
    };
  }
  if (scope === 'prune' && topic.manual) {
    return { ok: false, reason: 'manual', message: '手动登记的目录不会被 prune 清理（请用 topic remove）' };
  }
  return { ok: true };
}

// 主题里还有多少条**未领取且未删除**的任务（= 还没人领的活）。
// 删除保护用它：队列里还堆着活就不该被一声不吭地清空。
function countPending(t) {
  if (!t || !Array.isArray(t.tasks)) return 0;
  return t.tasks.filter(isPending).length;
}

// 删除整个主题（连同其全部任务）。默认拒绝删除「等待中」主题——那会让正阻塞的
// agent 只能等到超时；force=true 才强删（agent 随后超时收尾）。
// 全局主题同样默认拒绝（共享池，删掉会让所有 worker 的候补来源消失）；
// force=true 清空全局任务池。
export async function removeTopic({ cwd: rawCwd, key: rawKey, force = false } = {}) {
  if (!rawKey && !rawCwd) {
    throw badInput('需要 --cwd "<工作目录>" 或 --key "<主题key>"');
  }
  const key = resolveTopicKey({ key: rawKey, cwd: rawCwd });
  openStore();
  const t = topicsRepo.getTopic(key);
  if (!t) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题不存在（key ${key}）`);
  }
  // 删除判定只写一份（deleteGuard）：全局共享池 / 等待中 / 有未领取任务 → 都要 --force。
  const guard = deleteGuard(t, { force, key });
  if (!guard.ok) throw badInput(guard.message);
  const view = topicView(t);
  topicsRepo.deleteTopic(key, { purge: isGlobalKey(key) });
  return { status: 'removed', key, name: t.name, cwd: t.cwd, topic: view };
}

// 批量删除主题：keys / cwds（数组，可并用），或 all=true 清空全部。
// 默认把「等待中」「不存在」计入 skipped 而不删；force=true 连等待中一起删。
export async function removeTopics({ keys, cwds, all = false, force = false } = {}) {
  const hasList = (a) => Array.isArray(a) && a.some((x) => String(x).trim());
  if (!all && !hasList(keys) && !hasList(cwds)) {
    throw badInput('需要 --keys "<key,key>" 或 --cwds "<目录,目录>"，或 --all');
  }

  openStore();
  const allTopics = topicsRepo.listTopics();
  const byKey = new Map(allTopics.map((t) => [t.key, t]));
  let targets;
  if (all) {
    targets = allTopics.map((t) => t.key);
  } else {
    const list = [];
    if (Array.isArray(keys)) list.push(...keys.map((x) => String(x).trim()).filter(Boolean));
    if (Array.isArray(cwds)) {
      for (const c of cwds) if (String(c).trim()) list.push(normalizeCwd(c).key);
    }
    targets = [...new Set(list)];
  }

  const removed = [];
  const skipped = [];
  for (const key of targets) {
    const t = byKey.get(key);
    if (!t) {
      skipped.push({ key, reason: 'not_found' });
      continue;
    }
    // 判定与单删共用同一套规则（deleteGuard）——批量与单个的语义必须一致
    const g = deleteGuard(t, { force, key });
    if (!g.ok) {
      skipped.push({ key, name: t.name, cwd: t.cwd, reason: g.reason, pending: g.pending || 0 });
      continue;
    }
    removed.push({ key, name: t.name, cwd: t.cwd });
  }
  for (const r of removed) topicsRepo.deleteTopic(r.key, { purge: isGlobalKey(r.key) });
  return { status: 'ok', all: !!all, count: removed.length, removed, skipped };
}
