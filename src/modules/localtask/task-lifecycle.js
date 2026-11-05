// （#54 自 service.js 拆出）队列出口的任务生命周期：consumeFirstPending（D-first 领取，
// 跳过被依赖/闸门挡住的 pending）、completeTask（完成门禁：timegoal 未到点返回 blocked
// 业务值而不是抛错）、reopenTask（用户修改反馈 → 回到待领取）。
import { badInput, notFound } from '../../core/errors.js';
import { formatDuration } from '../../core/instruction-template.js';
import { preserveFrontmatter } from '../../shared/frontmatter.js';
import { findFirstReadyPending } from './dag.js';
import { isGlobalKey, resolveTaskKey } from './paths.js';
import { loadStore, saveStore, stampNow, normalizeSummary, normalizeText, bumpWorkflowRevision } from './store-io.js';
import { normalizeTask, foreignResolver, isPending, relocateInStore } from './task-view.js';
import { markConsumed } from './waiters.js';
// 把一条任务重新开放（用户的**修改反馈** → 重新进入执行循环）。
//
// 语义：被领取/已完成的任务再次变回 pending——
//   - 领取时间作废：新一轮从**再次领取**开始计时（与「领取即计时」的口径一致，
//     任务级 timegoal 也会随之重新起表）；
//   - 完成标记清空：上一轮不算数；
//   - 上一轮的完成总结（roundSummary）**保留**——agent 下一轮接手时能看到自己上轮做了什么。
// 任务正文就是 Markdown，用户在面板里改完存回来即走这条路。
export async function reopenTask({ cwd: rawCwd, key: rawKey, id, text, moveTo } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  const store = await loadStore();
  const t = store.topics[key];
  if (!t) throw notFound('主题不存在: ' + key);
  const task = t.tasks.find((x) => Number(x.id) === want);
  if (!task || task.deletedAt) throw notFound('任务不存在或已删除: #' + want);
  const before = { status: task.status, consumedAt: task.consumedAt || '', completedAt: task.completedAt || '' };
  if (text !== undefined && text !== null && String(text).trim()) {
    // 改文案不该把 frontmatter 一起改没——归组信息（board/project/介绍引用）保住，
    // 新正文自带的 frontmatter 优先。丢了它任务就从组 / 项目面板里掉出去。
    task.text = preserveFrontmatter(task.text, normalizeText(text));
  }
  task.status = 'pending';
  task.consumedAt = '';
  task.completedAt = '';
  task.reopenCount = (Number(task.reopenCount) || 0) + 1;
  task.lastReopenedAt = stampNow();
  // 归属变了（reopen 的正文可能带着改过的 project）→ 先翻回待领取再搬家，
  // 搬家守卫按 pending 口径放行；同一主题 → 不搬。
  let host = t;
  let moved = false;
  let movedFrom = null;
  if (moveTo) {
    const movedTo = relocateInStore(store, t, task, moveTo);
    if (movedTo) {
      host = movedTo.topic;
      moved = true;
      movedFrom = { key, name: t.name, id: want };
    }
  }
  host.updatedAt = stampNow();
  bumpWorkflowRevision(host);
  if (host !== t) bumpWorkflowRevision(t);
  await saveStore(store);
  return {
    status: 'ok',
    reopened: true,
    id: Number(task.id),
    key: host.key,
    name: host.name,
    before,
    moved,
    movedFrom,
    task: normalizeTask(task, host.tasks),
  };
}
// 取走该主题第一条 pending；没有则返回 null。roundSummary 显式指定本轮完成总结，
// 缺省回落到主题当前 summary（等待中即本轮现状）。
// by = 领取方身份 {key,name,cwd}（wait 传入），用于记领取审计。
export async function consumeFirstPending(key, roundSummary, by) {
  const store = await loadStore();
  const t = store.topics[key];
  if (!t) return null;
  // D-first：跳过被 blockBy / 闸门挡住的 pending，按数组序取第一条**可领**的
  // 跨队列依赖经 resolveForeign 认 completedAt
  const task = findFirstReadyPending(t.tasks || [], { resolveForeign: foreignResolver(store) });
  if (!task || !isPending(task)) return null;
  markConsumed(task, roundSummary || t.summary || '', {
    from: isGlobalKey(key) ? 'global' : 'local',
    byKey: by && by.key,
    byName: by && by.name,
  });
  t.updatedAt = stampNow();
  bumpWorkflowRevision(t);
  await saveStore(store);
  return normalizeTask(task);
}
// ─── 标记完成（任务工具的完成门禁）────────────────────────────────────
//
// 「完成」= agent 认为本轮工作收尾。带时间目标的任务在这里被**门禁**：
// 时间未到 → 拒绝标记完成。返回 blocked 业务结果而不是抛错——agent 要据此行动
// （派出 sub agent 重新提出新的需求，或等到点）；抛错会把这条指令埋进错误堆里。
// 到点 → 放行并自动记录最终 check（「结束必须 check」的记录器语义，落 timegoal 日志）。
export async function completeTask({ cwd: rawCwd, key: rawKey, id, summary: rawSummary, progress: rawProgress } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  const summary = normalizeSummary(rawSummary); // 完成总结必填（记为该任务的终态）
  const progress = String(rawProgress ?? '').trim().slice(0, 2000);
  const store = await loadStore();
  const t = store.topics[key];
  if (!t) throw notFound('主题不存在: ' + key);
  const task = t.tasks.find((x) => Number(x.id) === want);
  if (!task || task.deletedAt) throw notFound('任务不存在或已删除: #' + want);
  if (task.status !== 'consumed') {
    return {
      status: 'blocked',
      reason: 'not_claimed',
      id: want,
      key,
      name: t.name,
      hint: '任务还没被领取——先 wait/get 领取，干完再标完成',
    };
  }
  if (task.completedAt) {
    return { status: 'ok', already: true, id: want, key, completedAt: task.completedAt, task: normalizeTask(task) };
  }
  let goal = null;
  if (task.timegoal) {
    // 门禁：查任务级 goal。动态 import——tasktool/wait.js 静态引用本模块，这里走动态避免环。
    const { taskGoalState, recordTaskCheck } = await import('../tasktool/taskgoal.js');
    const st = await taskGoalState({ topicKey: key, taskId: want });
    if (st.hasGoal && !st.reached) {
      return {
        status: 'blocked',
        reason: 'goal_not_reached',
        id: want,
        key,
        name: t.name,
        deadline: st.goal.deadline,
        durationSec: st.goal.durationSec,
        remainingSec: st.remainingSec,
        remainingHuman: formatDuration(st.remainingSec),
        hint: '时间未到，不能标记完成——请派出 sub agent 重新提出新的需求；到点后（timegoal check 返回 reached:true）再来标完成',
      };
    }
    if (st.hasGoal) {
      const rec = await recordTaskCheck({ topicKey: key, taskId: want, summary, progress: progress || '完成' });
      goal = { recorded: rec.recorded, reached: true, checkedAt: rec.checkedAt };
    } else {
      // goal 已被保留期清理（任务拖了 7 天以上才标完成）→ 放行 + 说明：
      // 门禁防的是「提前收工」，时间早已远超要求的不拦。
      goal = { recorded: false, reason: 'goal_expired' };
    }
  }
  task.completedAt = stampNow();
  task.roundSummary = summary;
  t.updatedAt = stampNow();
  bumpWorkflowRevision(t);
  await saveStore(store);
  // 单一写路径：完成 → Mutator 标 success + 调度一轮（fail-open）
  try {
    const { markTaskSuccess } = await import('./writes.js');
    await markTaskSuccess(key, want);
  } catch {
    try {
      const { refreshTopicAfterComplete } = await import('./engine.js');
      await refreshTopicAfterComplete(key);
    } catch {
      /* ignore */
    }
  }
  return {
    status: 'ok',
    completed: true,
    id: want,
    key,
    name: t.name,
    completedAt: task.completedAt,
    goal,
    task: normalizeTask(task),
  };
}
// ─── 时间目标到点 → 本轮立刻收尾 ───────────────────────────────────────
//
// 以前 wait 只认两种结束：拿到任务，或自己的超时（最长 10 分钟）。
// 但如果这个目录挂着**时间目标**，预算到点这一局就该结束了 —— agent 不该在
// 预算外继续空等（它等的正是"下一条任务"，而预算已经用完）。
//
// 探针来自 timegoal 模块（独立 store，NX_KV_TIMEGOAL_STORE）：
//   - 用**动态 import**：两个模块互不依赖是刻意设计（见 timegoal/service.js 的
//     模块边界说明），这里只在真的 wait 时才按需加载，不给启动路径加负担。
//   - **fail-open**：加载失败 / 读不到 / 这个目录没有目标 → 一律当作"没有截止
//     时刻"，wait 照原样按超时走。探针坏了绝不能把 wait 卡死。
//   - 键是同一个：两个模块的 topicKeyFor 都是 sha1(小写目录名) 前 16 位，
//     所以「同名目录」= 同一个 key = 同一个目标。
//
// ⚠️ **只在"等待期间到期"才取消**：等待开始时目标就已经过期的，**不**取消。
// 否则一个用完了预算的目录会永远等不了（每次 wait 都秒回 cancelled）——
// 那不是"到点自动取消"，那是把目录焊死了。这种情况该由 agent 自己的
// `timegoal check`（reached:true）去处理。
//
// （goal 探针与目标上下文已随 wait 编排迁往 tasktool/wait.js——任务工具语义归
// tasktool，队列本体不再依赖 timegoal 模块。）

