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
import { loadStore, saveStore, stampNow, normalizeSummary, normalizeText, bumpWorkflowRevision } from './store-io.js';
import { normalizeTask, foreignResolver, isPending } from './task-view.js';
import { normalizeBlockBy } from './dag.js';
import { markConsumed } from './waiters.js';

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
  const store = await loadStore();
  const t = store.topics[key];
  if (!t) throw notFound('主题不存在: ' + key);
  const task = t.tasks.find((x) => Number(x.id) === want);
  if (!task || task.deletedAt) throw notFound('任务不存在或已删除: #' + want);
  // 旧口径（#59）归档的 superseded 任务仍拒绝——那是被新号取代的残留，不是本条活。
  if (task.status === 'archived') {
    throw badInput(`#${want} 已归档（被新任务取代）——不能再重开；要继续做请新建任务`);
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

  // 落点：默认同主题；带改过归属（moveTo）就搬整条。
  let host = t;
  let moved = false;
  let movedFrom = null;
  if (moveTo && moveTo.cwd) {
    const toKey = topicKeyFor(basename(String(moveTo.cwd)));
    if (toKey !== t.key) {
      const { relocateInStore } = await import('./task-view.js');
      const relocated = relocateInStore(store, t, task, moveTo);
      if (relocated) {
        host = relocated.topic;
        moved = true;
        movedFrom = { key, name: t.name, id: want };
      }
    }
  }

  // blockBy 仍指向自己时清掉（编号没变，一般不会；搬家后仍校验一次）
  task.blockBy = normalizeBlockBy(task.blockBy, Number(task.id));

  host.updatedAt = stampNow();
  bumpWorkflowRevision(host);
  if (host !== t) bumpWorkflowRevision(t);
  await saveStore(store);

  return {
    status: 'ok',
    reopened: true,
    forked: false, // #74：不再新建
    id: Number(task.id),
    key: host.key,
    name: host.name,
    before,
    kind,
    historyId: node.id,
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
