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
import { isGlobalKey, resolveTaskKey, topicKeyFor } from './paths.js';
import { normalizeSummary, normalizeText, stampNow } from './store-io.js';
import { normalizeTask, foreignResolver, isPending, relocateTask } from './task-view.js';
import { openLocaltaskStore as openStore, topics as topicsRepo, tasks as tasksRepo, txw as tx } from './repo/index.js';
import { normalizeBlockBy } from './dag.js';

/** 下一条 history 节点编号（任务内自增） */
function nextHistoryId(history) {
  let max = 0;
  for (const h of history || []) {
    const n = Number(h && h.id) || 0;
    if (n > max) max = n;
  }
  return max + 1;
}

/** 把当前任务态压成一条 history 节点（就地重开前留档） */
function snapshotNode(task, { kind, quote, feedback, attachments } = {}) {
  const excerpt =
    String(task.text ?? '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) || '';
  return {
    id: nextHistoryId(task.history),
    kind: kind === 'comment' ? 'comment' : kind === 'origin' ? 'origin' : 'reopen',
    at: stampNow(),
    text: String(task.text ?? ''),
    summary: String(task.roundSummary ?? ''),
    status: String(task.status || 'pending'),
    completedAt: String(task.completedAt ?? ''),
    quote: String(quote ?? ''),
    feedback: String(feedback ?? ''),
    attachments: Array.isArray(attachments)
      ? attachments
          .filter((a) => a && typeof a === 'object')
          .map((a) => ({
            id: String(a.id || ''),
            name: String(a.name || ''),
            type: a.type === 'image' ? 'image' : 'file',
            size: String(a.size || ''),
            url: a.url ? String(a.url) : '',
          }))
      : [],
    excerpt: excerpt.replace(/^#+\s*/, '').slice(0, 100),
  };
}

// 把一条任务重新开放（用户的**修改反馈** / 重做 / 划选评论）。
//
// 语义（任务 #74）：**就地重开原任务**——同一编号、同一 md，不新建队列行。
//   - 旧态压进 `history[]`（可追链、可点开旁路查看）
//   - 正文 = 调用方拼好的（面板口径：原正文 + 上一轮完成总结 + 本轮反馈）
//   - 清领取/完成标记，状态回到 pending，等再领（同号继续）
//   - 落点：默认同主题；带改过归属（moveTo）就搬整条任务
//
// 对比 #59「新建 md + 归档」：那会把同一件活拆成多条待领，验收/评论闭环断在新号上；
// #74 要求 ack 与评论统一回写原任务，历史用链可视化而不是多条归档任务。
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
  attachments,
} = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  openStore();
  const t = topicsRepo.getTopic(key);
  if (!t) throw notFound('主题不存在: ' + key);
  const task = t.tasks.find((x) => Number(x.id) === want);
  if (!task || task.deletedAt) throw notFound('任务不存在或已删除: #' + want);
  // 终态里**只有 cancelled 拒绝重开**：done 允许就地重开（#74 的"完成验收后回待领取"），
  // cancelled 是"被新号取代/明确作废"的留档行，重开它等于让一条死记录复活。
  // 词表见 src/shared/task-status.js。
  if (task.status === 'cancelled') {
    throw badInput(`#${want} 已取消（被新任务取代或明确作废）——不能再重开；要继续做请新建任务`);
  }

  const kind = rawKind === 'comment' ? 'comment' : 'reopen';
  const before = {
    status: task.status,
    consumedAt: task.consumedAt || '',
    completedAt: task.completedAt || '',
    roundSummary: task.roundSummary || '',
  };

  if (!Array.isArray(task.history)) task.history = [];
  // 首次重开：先落一条 origin，把「改之前」的正文留住（后续节点只记事件态）。
  if (task.history.length === 0) {
    task.history.push(snapshotNode(task, { kind: 'origin' }));
  }

  const body = String(text ?? '').trim();
  const fb = String(feedback ?? '').trim();
  if (body) {
    task.text = preserveFrontmatter(task.text, normalizeText(body));
  } else if (fb) {
    // #79：反馈不带 text —— 服务端把反馈段**追加**到盘上当前正文。
    // base 永远是服务端正文（完整、最新）：面板会话 doc 可能落后于盘上
    // （别的会话改过 / 上一轮重开追加过 / 首轮还没加载完），拿旧正文整篇拼回去
    // 重写，就是「评论一次丢一次」。只有显式给 text（带未保存编辑的整篇回写）
    // 才替换正文。段名 / 锚定 / 加粗与面板共用 src/shared/feedback-text.js。
    const heading = String(feedbackHeading ?? '').trim()
      || (kind === 'comment' ? PLAIN_FEEDBACK_HEADING : FEEDBACK_HEADING);
    const useBold = typeof feedbackBold === 'boolean' ? feedbackBold : kind !== 'comment';
    task.text = preserveFrontmatter(task.text, appendFeedback({
      base: task.text,
      heading,
      quote,
      feedback: fb,
      bold: useBold,
    }));
  }

  // 本轮事件节点：记反馈/选区/附件；text 取**更新后**的正文（旁路点开即这一轮交付形态）
  const node = snapshotNode(task, {
    kind,
    quote,
    feedback: feedback || '',
    attachments,
  });
  // origin 已占「改前」；事件节点用更新后正文，避免与 origin 完全重复时仍要能看反馈字段
  task.history.push(node);

  // 重开 = 重新进入待领取：清领取/完成标记，让 get/wait 能再领到同一条。
  // （划选评论也走此入口——反馈已写进正文，下一轮 agent 从同号再领。）
  task.status = 'pending';
  task.consumedAt = '';
  task.completedAt = '';
  task.roundSummary = '';
  task.claimedFrom = '';
  task.claimedBy = '';
  task.claimedByName = '';

  task.reopenCount = (Number(task.reopenCount) || 0) + 1;
  task.lastReopenedAt = stampNow();
  // 链上的「当前尖」语义：forkKind 记最近一次事件种类（兼容旧 chain 查询展示）
  task.forkKind = kind;

  // 落点：默认同主题；带改过归属（moveTo）就搬整条（repo 版搬家在**同一事务**里跑）。
  let host = t;
  let moved = false;
  let movedFrom = null;
  if (moveTo && moveTo.cwd) {
    // 新寻址：key 由完整 cwd 派生（topicKeyFor 现在吃完整路径，不再吃 basename）
    const toKey = topicKeyFor(String(moveTo.cwd));
    if (toKey !== t.key) {
      const relocated = relocateTask(t, want, moveTo);
      if (relocated) {
        host = relocated.topic;
        moved = true;
        movedFrom = { key, name: t.name, id: want };
      }
    }
  }

  // blockBy 仍指向自己时清掉（编号没变，一般不会；搬家后仍校验一次）
  tx(() => {
    tasksRepo.updateTask(host.id, Number(task.id), {
      text: task.text,
      status: 'pending',
      consumedAt: '',
      completedAt: '',
      roundSummary: '',
      claimedFrom: '',
      claimedBy: '',
      claimedByName: '',
      reopenCount: task.reopenCount,
      lastReopenedAt: task.lastReopenedAt,
      forkKind: task.forkKind,
      blockBy: normalizeBlockBy(task.blockBy, Number(task.id)),
      history: task.history,
    });
    topicsRepo.updateTopic(host.key, { bumpRevision: true });
    if (host.key !== key) topicsRepo.updateTopic(key, { bumpRevision: true });
    return true;
  });

  const hostView = topicsRepo.getTopic(host.key);
  const live = hostView.tasks.find((x) => Number(x.id) === Number(task.id)) || task;
  return {
    status: 'ok',
    reopened: true,
    forked: false, // #74：不再新建
    id: Number(live.id),
    key: hostView.key,
    name: hostView.name,
    before,
    kind,
    historyId: node.id,
    moved,
    movedFrom,
    task: normalizeTask(live, hostView.tasks),
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
// 探针来自 timegoal 模块（独立 store，NX_KV_TIMEGOAL_STORE）：
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
