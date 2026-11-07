// （#54 自 service.js 拆出）队列出口的任务生命周期：consumeFirstPending（D-first 领取，
// 跳过被依赖/闸门挡住的 pending）、completeTask（完成门禁：timegoal 未到点返回 blocked
// 业务值而不是抛错）、reopenTask（用户修改反馈 → **就地重开原任务**，历史进 history 链）。
import { badInput, notFound } from '../../core/errors.js';
import { formatDuration } from '../../core/instruction-template.js';
import { preserveFrontmatter } from '../../shared/frontmatter.js';
import {
  FEEDBACK_HEADING,
  PLAIN_FEEDBACK_HEADING,
  appendFeedback,
} from '../../shared/feedback-text.js';
import { findFirstReadyPending } from './dag.js';
import { basename } from 'node:path';
import { isGlobalKey, resolveTaskKey, topicKeyFor } from './paths.js';
import { normalizeSummary, normalizeText, stampNow } from './store-io.js';
import { normalizeTask, foreignResolver, isPending } from './task-view.js';
import {
  openLocaltaskStore as openStore,
  topics as topicsRepo,
  tasks as tasksRepo,
  links as linksRepo,
  txw as tx,
} from './repo/index.js';

/**
 * 解析 supersededBy：本地是数字（同主题 seq），跨队列搬家后写的是 "key:seq"。
 * 主题 key 本身不含 ':'（见 core/topic-key.js），所以最后一个 ':' 就是分隔符。
 */
function supersederRef(raw, sameKey) {
  if (raw == null || raw === '' || typeof raw === 'object') return null;
  const s = String(raw);
  const at = s.lastIndexOf(':');
  if (at > 0) {
    const seq = Number(s.slice(at + 1));
    if (!Number.isFinite(seq) || seq <= 0) return null;
    return { key: s.slice(0, at), seq };
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? { key: sameKey, seq: n } : null;
}

// 把一条任务重新开放（用户的**修改反馈** / 重做 / 划选评论）——
// **T04 派生模型**：重开 = 派生一条新任务，不再就地改写旧行。
//
//   · 旧任务定格：done 保持 done；claimed/pending → cancelled + ext_superseded_by
//     （旧的执行历史不该被抹掉——它记录的是"那一轮实际发生了什么"）
//   · 新任务：round = 旧.round + 1；正文 = 旧正文 + 上轮总结 + 本轮反馈（buildReopenText
//     的 #74 口径：原正文、总结、反馈顺序固定）；状态 pending，立即可领
//   · task_links(src=新, dst=旧, type=reopen|comment) 是链的唯一来源（history[] 下线）
//   · 落点：默认同主题；带 moveTo 就直接落在目标主题（派生不需要先建后搬）
//
// 对比旧就地重开：同号继续的口径改为"新号接着做"——对外编号不漂移（每个 round
// 一个编号），验收/评论闭环挂在 task_links 上。
export async function reopenTask({
  cwd: rawCwd,
  key: rawKey,
  id,
  text,
  moveTo,
  kind: rawKind,
  quote,
  feedback,
  feedbackHeading,
  feedbackBold,
  attachments: _attachments,
} = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  let want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  openStore();
  const t = topicsRepo.getTopic(key);
  if (!t) throw notFound('主题不存在: ' + key);
  let curTopic = t;
  let task = t.tasks.find((x) => Number(x.id) === want);
  if (!task || task.deletedAt) throw notFound('任务不存在或已删除: #' + want);
  // cancelled 的两种形态：
  //   · 被 superseded（ext_superseded_by 指着链尖）→ **顺着链走到当前尖**，从尖派生
  //     （二次评论/继续重开是正常流程——反馈落在最新一代上，而不是让死记录复活）
  //   · 手动作废（无 superseder）→ 拒绝（要继续请新建任务）
  {
    // 顺链走尖：被取代就跳到取代者，直到没有后继。跨队列的取代者存成 "key:seq"，
    // 所以游标要带着 topic 一起走 —— 只按原主题查会解析到同号的另一条任务。
    let cur = want;
    let guard = 0;
    for (;;) {
      const row = tasksRepo.getTaskRow(curTopic.id, cur);
      if (!row || row.task.status !== 'cancelled' || row.task.supersededBy == null) break;
      const next = supersederRef(row.task.supersededBy, curTopic.key);
      if (!next || (next.key === curTopic.key && next.seq === cur) || guard++ > 32) break;
      const nextTopic = next.key === curTopic.key ? curTopic : topicsRepo.getTopic(next.key);
      if (!nextTopic) throw notFound('取代者所在主题不存在: ' + next.key);
      const nextTask = nextTopic.tasks.find((x) => Number(x.id) === next.seq);
      if (!nextTask) throw notFound('链尖任务不存在: #' + next.seq);
      curTopic = nextTopic;
      cur = next.seq;
      task = nextTask;
    }
    if (task.status === 'cancelled') {
      throw badInput(`#${task.id} 已取消（明确作废）——不能再重开；要继续做请新建任务`);
    }
    want = cur;
  }
  const srcKey = curTopic.key;

  const kind = rawKind === 'comment' ? 'comment' : 'reopen';
  const before = {
    status: task.status,
    consumedAt: task.consumedAt || '',
    completedAt: task.completedAt || '',
    roundSummary: task.roundSummary || '',
  };

  const body = String(text ?? '').trim();
  const fb = String(feedback ?? '').trim();

  // ── 新任务正文（#74 口径）：显式 text 整篇替换；否则旧正文 + 本轮反馈段。
  // 反馈不带 text 时，反馈段追加在**旧任务的当前正文**上（base 永远是服务端正文，
  // 防「评论一次丢一次」#79）。上轮完成总结已在旧正文里（done 时追加），不重复拼。
  let newText = task.text;
  if (body) {
    newText = preserveFrontmatter(task.text, normalizeText(body));
  } else if (fb) {
    const heading = String(feedbackHeading ?? '').trim()
      || (kind === 'comment' ? PLAIN_FEEDBACK_HEADING : FEEDBACK_HEADING);
    const useBold = typeof feedbackBold === 'boolean' ? feedbackBold : kind !== 'comment';
    newText = preserveFrontmatter(task.text, appendFeedback({
      base: task.text,
      heading,
      quote,
      feedback: fb,
      bold: useBold,
    }));
  }

  // ── 落点：默认同主题（链尖所在主题）；带 moveTo 就直接派生到目标主题
  let hostKey = srcKey;
  let moved = false;
  let movedFrom = null;
  if (moveTo && moveTo.cwd) {
    const toKey = topicKeyFor(String(moveTo.cwd));
    if (toKey !== srcKey) {
      hostKey = toKey;
      moved = true;
      movedFrom = { key: srcKey, name: curTopic.name, id: want };
    }
  }

  const parentRowId = tasksRepo.getTaskRow(curTopic.id, want).row.id;
  const created = tx((conn) => {
    // 1. 派生新任务：round = 旧.round + 1，状态 pending 立即可领
    const hostTopic = topicsRepo.ensureTopic(hostKey, {
      cwd: hostKey === srcKey ? curTopic.cwd : String(moveTo.cwd),
      name: hostKey === srcKey ? curTopic.name : basename(String(moveTo.cwd)),
    });
    const inserted = tasksRepo.insertTask(hostTopic.id, {
      text: newText,
      status: 'pending',
      round: (Number(task.reopenCount) || 0) + 1 + 1, // splitTaskFields: round = reopenCount + 1
      fromSrc: task.from || '',
      timegoal: task.timegoal || null, // 时间目标声明跟着活走（再次领取重新计时）
      // 依赖/闸门跟着活走：同队列时本地 seq 仍然有效；跨队列只带 "key:seq" 绝对引用
      blockBy:
        hostKey === srcKey
          ? task.blockBy || []
          : (task.blockBy || []).filter((d) => String(d).includes(':')),
      blocksFollowing: !!task.blocksFollowing,
      createdAt: stampNow(),
    });
    // 2. 链：src=新, dst=旧（task_links 是链的唯一来源）
    linksRepo.addLink({
      srcId: Number(
        (conn.get('SELECT id FROM tasks WHERE topic_id = :t AND seq = :s', {
          t: hostTopic.id,
          s: inserted.id,
        }) || {}).id
      ),
      dstId: parentRowId,
      type: kind,
      note: fb,
      atMs: Date.now(),
    });
    // 3. 旧任务定格：done 保持 done；claimed/pending → cancelled + superseded 标记
    if (task.status === 'done') {
      // done 是终态、保持不变——上一轮的交付事实不因重开而消失
    } else {
      // supersededBy 必须带上绝对地址：搬到别的队列后，光写目标队列的 seq 会被
      // 顺链逻辑按源主题解析到一条完全无关的任务上。
      tasksRepo.updateTask(curTopic.id, want, {
        status: 'cancelled',
        supersededBy: hostKey === srcKey ? inserted.id : `${hostKey}:${inserted.id}`,
      });
    }
    topicsRepo.updateTopic(srcKey, { bumpRevision: true });
    if (hostKey !== srcKey) topicsRepo.updateTopic(hostKey, { bumpRevision: true });
    // 队列顺序：新任务追加到尾（JSON 时代 push 的等价物）
    topicsRepo.mutateOrder(hostKey, (order) => {
      const list = [...order];
      const at = list.indexOf(inserted.id);
      if (at >= 0) list.splice(at, 1);
      list.push(inserted.id);
      return list;
    });
    return inserted;
  });

  const hostView = topicsRepo.getTopic(hostKey);
  const live = hostView.tasks.find((x) => Number(x.id) === created.id) || null;
  return {
    status: 'ok',
    reopened: true,
    forked: false,
    id: created.id,
    parentId: want,
    key: hostView.key,
    name: hostView.name,
    before,
    kind,
    moved,
    movedFrom,
    task: live ? normalizeTask(live, hostView.tasks) : normalizeTask(created.task),
  };
}

// 取走该主题第一条 pending；没有则返回 null。roundSummary 显式指定本轮完成总结，
// 缺省回落到主题当前 summary（等待中即本轮现状）。
// by = 领取方身份 {key,name,cwd}（wait 传入），用于记领取审计。
export async function consumeFirstPending(key, roundSummary, by) {
  openStore();
  const t = topicsRepo.getTopic(key);
  if (!t) return null;
  // D-first：跳过被 blockBy / 闸门挡住的 pending，按队列序取第一条**可领**的
  // 跨队列依赖经 resolveForeign 认 completedAt（直接查库，永远最新）
  const task = findFirstReadyPending(t.tasks || [], { resolveForeign: foreignResolver() });
  if (!task || !isPending(task)) return null;
  // 领取 = 带守卫的单条 UPDATE（pending ∧ 未删除）：两个进程抢同一条时，
  // changes=0 的一方拿 null —— 「不重复领取」是结构性保证。
  const claimed = tx(() =>
    tasksRepo.claimTask(t.id, task.id, {
      summary: roundSummary || t.summary || '',
      from: isGlobalKey(key) ? 'global' : 'local',
      byKey: by && by.key,
      byName: by && by.name,
    })
  );
  if (!claimed) return null; // 被并发抢先：调用方按「没有可领」处理（下轮重试）
  // 注意：**不动等待态** —— wait 轮询期间 waiting 仍为真（agent 还阻塞着），
  // 清等待是 wait 自己收尾的事（clearWaiting）。与 JSON 时代 markConsumed 的行为一致。
  tx(() => {
    topicsRepo.updateTopic(key, { bumpRevision: true });
    return true;
  });
  return normalizeTask(claimed);
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
  openStore();
  const t = topicsRepo.getTopic(key);
  if (!t) throw notFound('主题不存在: ' + key);
  const task = t.tasks.find((x) => Number(x.id) === want);
  if (!task || task.deletedAt) throw notFound('任务不存在或已删除: #' + want);
  // 「已完成」的幂等分支必须排在领取判定**之前**：done 行的 status 已经不是 claimed，
  // 先判 claimed 会把它误报成「还没领取」（旧代码里 done 与 claimed 共用 consumed，
  // 所以顺序无所谓；词表一分家就暴露了）。
  if (task.status === 'done' || task.completedAt) {
    return {
      status: 'ok',
      already: true,
      id: want,
      key,
      doneAt: task.completedAt || '',
      feedback: task.roundSummary || '',
      completedAt: task.completedAt,
      task: normalizeTask(task),
    };
  }
  if (task.status !== 'claimed') {
    return {
      status: 'blocked',
      reason: 'not_claimed',
      id: want,
      key,
      name: t.name,
      hint: '任务还没被领取——先 wait/get 领取，干完再标完成',
    };
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
  // 完成 = 带守卫的单条 UPDATE（claimed ∧ 未删除 → done），反馈与时刻同事务写入。
  // 状态升为终态 done（词表见 src/shared/task-status.js）。
  // 旧代码靠「consumed + completedAt」两个字段表达「已完成」——两个真值源迟早分叉，
  // 统一后 status 是唯一的状态真值，completedAt / roundSummary 只是"何时/结论"的载体。
  const doneAtMs = Date.now();
  const okDone = tx(() => {
    const changed = tasksRepo.completeTask(t.id, want, { feedback: summary, atMs: doneAtMs });
    if (changed) topicsRepo.updateTopic(key, { bumpRevision: true });
    return changed;
  });
  if (!okDone) {
    // 并发窗口：刚好被别人完成 / 被删除 —— 按 already 口径返回当前行（幂等语义）
    const fresh = topicsRepo.getTopic(key).tasks.find((x) => Number(x.id) === want);
    return {
      status: 'ok',
      already: true,
      id: want,
      key,
      doneAt: fresh ? fresh.completedAt : '',
      feedback: fresh ? fresh.roundSummary : '',
      completedAt: fresh ? fresh.completedAt : '',
      task: fresh ? normalizeTask(fresh) : normalizeTask(task),
    };
  }
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
  const doneView = topicsRepo.getTopic(key).tasks.find((x) => Number(x.id) === want) || task;
  return {
    status: 'ok',
    completed: true,
    id: want,
    key,
    name: t.name,
    // 词表统一后的规范字段名（旧名 completedAt/roundSummary 在 T03 后仍随视图返回）
    doneAt: doneView.completedAt,
    feedback: doneView.roundSummary || '',
    completedAt: doneView.completedAt,
    goal,
    task: normalizeTask(doneView),
  };
}
// ─── 时间目标到点 → 本轮立刻收尾 ───────────────────────────────────────
//
// 以前 wait 只认两种结束：拿到任务，或自己的超时（最长 10 分钟）。
// 但如果这个目录挂着**时间目标**，预算到点这一局就该结束了 —— agent 不该在
// 预算外继续空等（它等的正是"下一条任务"，而预算已经用完）。
//
// 探针来自 timegoal 模块（T06 起目标进库：goals / goal_checks 表）：
//   - 用**动态 import**：两个模块互不依赖是刻意设计（见 timegoal/service.js 的
//     模块边界说明），这里只在真的 wait 时才按需加载，不给启动路径加负担。
//   - **fail-open**：加载失败 / 读不到 / 这个目录没有目标 → 一律当作"没有截止
//     时刻"，wait 照原样按超时走。探针坏了绝不能把 wait 卡死。
//   - 键是同一个：localtask 与 timegoal 都按 (cwd, group) 派生 key（见 core/topic-key.js）；
//     所以「同名目录」= 同一个 key = 同一个目标。
//
// ⚠️ **只在"等待期间到期"才取消**：等待开始时目标就已经过期的，**不**取消。
// 否则一个用完了预算的目录会永远等不了（每次 wait 都秒回 cancelled）——
// 那不是"到点自动取消"，那是把目录焊死了。这种情况该由 agent 自己的
// `timegoal check`（reached:true）去处理。
//
// （goal 探针与目标上下文已随 wait 编排迁往 tasktool/wait.js——任务工具语义归
// tasktool，队列本体不再依赖 timegoal 模块。）
