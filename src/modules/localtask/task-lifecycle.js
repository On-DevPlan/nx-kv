// （#54 自 service.js 拆出）队列出口的任务生命周期：consumeFirstPending（D-first 领取，
// 跳过被依赖/闸门挡住的 pending）、completeTask（完成门禁：timegoal 未到点返回 blocked
// 业务值而不是抛错）、reopenTask（用户修改反馈 → **新建一条任务**，旧任务归档）。
import { badInput, notFound } from '../../core/errors.js';
import { formatDuration } from '../../core/instruction-template.js';
import { preserveFrontmatter } from '../../shared/frontmatter.js';
import { findFirstReadyPending } from './dag.js';
import { basename } from 'node:path';
import { isGlobalKey, resolveTaskKey, topicKeyFor } from './paths.js';
import { loadStore, saveStore, stampNow, normalizeSummary, normalizeText, bumpWorkflowRevision, topicOf, nextTaskId } from './store-io.js';
import { normalizeTask, foreignResolver, isPending } from './task-view.js';
import { normalizeBlockBy } from './dag.js';
import { markConsumed } from './waiters.js';
// 把一条任务重新开放（用户的**修改反馈** / 重做 / 加评论）。
//
// 语义（任务 #59）：**新建一条任务**（新的 md），旧任务**归档**——状态只往前。
//   - 旧任务：状态前进到终态 archived，正文、完成总结、领取记录**一个字都不动**（留档）；
//     它不会再回到「重新开始」，也就没有「完成等待验收 → 重新开始」这条回退边。
//   - 新任务：正文 = 调用方拼好的（面板口径：原正文 + 上一轮完成总结 + 本轮反馈），
//     forkOf 指回上一条（'队列key:旧编号'），supersededBy 记在旧任务上。
//   - 落点：默认同主题；带改过归属（moveTo）就落那边——归属决定落点。
//
// 为什么不再「就地改同一条、把状态翻回 pending」：
//   1. 那是**回退边**——完成等待验收的任务被拉回重新开始，历史被抹掉；
//   2. 就地改写会覆盖旧正文——上轮做过什么、用户评了什么，都被新正文吃掉；
//   3. 现在链条可追：旧任务留档、新任务指回它，状态机 pending → consumed → archived。
export async function reopenTask({ cwd: rawCwd, key: rawKey, id, text, moveTo } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  const store = await loadStore();
  const t = store.topics[key];
  if (!t) throw notFound('主题不存在: ' + key);
  const old = t.tasks.find((x) => Number(x.id) === want);
  if (!old || old.deletedAt) throw notFound('任务不存在或已删除: #' + want);
  if (old.status === 'archived') {
    throw badInput(`#${want} 已归档（被新任务取代）——不能再重开；要继续做请新建任务`);
  }
  const before = { status: old.status, consumedAt: old.consumedAt || '', completedAt: old.completedAt || '' };
  const body = String(text ?? '').trim();

  // 落点：默认同主题；带改过归属（moveTo）就落那边——归属决定落点。
  let host = t;
  let moved = false;
  let movedFrom = null;
  if (moveTo && moveTo.cwd) {
    const toKey = topicKeyFor(basename(String(moveTo.cwd)));
    if (toKey !== t.key) {
      host = topicOf(store, toKey, moveTo.cwd, moveTo.name || '');
      moved = true;
      movedFrom = { key, name: t.name, id: want };
    }
  }

  // 新任务：正文用调用方拼好的（面板口径 = 原正文 + 上一轮完成总结 + 本轮反馈）；
  // 没给正文就沿用旧正文（只归档、不改内容）。
  const newId = nextTaskId(host.tasks);
  const forked = normalizeTask({
    id: newId,
    text: body ? preserveFrontmatter(old.text, normalizeText(body)) : old.text,
    status: 'pending',
    createdAt: stampNow(),
    forkOf: `${key}:${want}`,
    forkKind: 'reopen', // 验收反馈 / 重做派生（#69 任务链；评论派生是 addTask 的 'comment'）
    // 同一件活，约束也接着走：
    //   timegoal       时间目标继承——新任务从**再次领取**开始重新计时（与旧口径一致）
    //   blocksFollowing 闸门继承——旧任务归档后不再挡人，闸门得由新任务接着当
    //   blockBy        上游依赖继承（去掉指向自己的那条）
    timegoal: old.timegoal || null,
    blocksFollowing: !!old.blocksFollowing,
    blockBy: normalizeBlockBy(old.blockBy, newId),
  });
  host.tasks.push(forked);

  // 旧任务：**前进**到终态（归档）。正文与完成总结一个字都不动——留档。
  old.status = 'archived';
  old.archivedAt = stampNow();
  old.archivedReason = 'superseded';
  old.supersededBy = { key: host.key, id: newId };
  old.reopenCount = (Number(old.reopenCount) || 0) + 1;
  old.lastReopenedAt = stampNow();

  host.updatedAt = stampNow();
  bumpWorkflowRevision(host);
  if (host !== t) bumpWorkflowRevision(t);
  await saveStore(store);
  return {
    status: 'ok',
    reopened: true,
    forked: true,
    id: newId, // 新任务编号（面板据此切到新的 md）
    key: host.key,
    name: host.name,
    before,
    from: { key, id: want }, // 上一条（已归档）
    moved,
    movedFrom,
    task: normalizeTask(forked, host.tasks),
    archived: normalizeTask(old, t.tasks),
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

