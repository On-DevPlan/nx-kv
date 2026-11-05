// （#54 自 service.js 拆出）任务行/主题的只读视图与队列内关系原语：
// normalizeTask（含 ready 徽标）、topicView、跨队列依赖解析器（foreignResolver）、
// 队列内关系清单（queueRelationsOf）与搬家（relocateInStore）。
import { basename } from 'node:path';
import { sanitizeTaskGoal } from '../tasktool/taskgoal.js';
import { normalizeBlockBy, isReadyToClaim } from './dag.js';
import { isGlobalKey, topicKeyFor } from './paths.js';
import { stampNow, parseStampMs, topicOf, nextTaskId } from './store-io.js';
// 领取耗时（秒）：**发布 → 被领取**的时间差。
// 数据本来就在（createdAt / consumedAt），这里算成派生字段，省得每个使用方自己算，
// 也省得存一份会漂移的冗余副本。
// 只有真的被领走的才有值；还没被领的返回 null（那是"还在等"，由使用方按当前时间算）。
function pickupSecOf(t) {
  // 归档的任务也是被领走过（consumedAt 保留）——领取耗时照旧算。
  if (!t || (t.status !== 'consumed' && t.status !== 'archived')) return null;
  const created = parseStampMs(t.createdAt);
  const consumed = parseStampMs(t.consumedAt);
  if (!Number.isFinite(created) || !Number.isFinite(consumed)) return null;
  return Math.max(0, Math.round((consumed - created) / 1000));
}

// 跨队列依赖引用（"topicKey:id"）是**绝对地址**——任务搬家后依然有效；
// 本地数字 id 是**队列内相对地址**——搬走就断了。队列内语义的判定全靠这条分界。
const isForeignDep = (d) => typeof d === 'string' && d.includes(':');

/**
 * 队列内语义的关系清单（跨队列搬任务搬不动的那些）：
 *   - 自己的上游依赖（本地 id）
 *   - 自己是闸门（挡本队列后续任务）
 *   - 被本队列其他任务依赖（本地 id）
 * 外来引用（"topicKey:id"）是绝对的，搬家后依然成立，不算 blocker。
 */
export function queueRelationsOf(topic, task) {
  const rel = [];
  const self = Number(task.id);
  const localDeps = (task.blockBy || []).filter((d) => !isForeignDep(d) && Number(d) > 0);
  if (localDeps.length) rel.push(`上游依赖 #${localDeps.map((d) => Number(d)).join(', #')}`);
  if (task.blocksFollowing) rel.push('它是闸门（挡住本队列后续任务）');
  const dependents = (topic.tasks || []).filter(
    (x) => x !== task && !x.deletedAt && (x.blockBy || []).some((d) => !isForeignDep(d) && Number(d) === self),
  );
  if (dependents.length) rel.push(`被 #${dependents.map((x) => x.id).join(', #')} 依赖`);
  return rel;
}

/**
 * 把任务行从源主题搬进目标主题（改归属项目 = 换队列，归属决定落点）。
 * 同一主题 → 原样返回 null（不搬）。引用修复：源队列里指向它的本地 id 依赖已被
 * 上游拒绝；跨队列引用（含源队列其他任务对它的 "fromKey:oldId"）在搬完统改写到
 * 新地址，编排连线不断。
 */
export function relocateInStore(store, fromTopic, task, moveTo) {
  const toCwd = String(moveTo?.cwd || '').trim();
  if (!toCwd) return null;
  const toKey = topicKeyFor(basename(toCwd));
  if (toKey === fromTopic.key) return null;
  const target = topicOf(store, toKey, toCwd, moveTo.name || '');
  const oldId = Number(task.id);
  fromTopic.tasks.splice(fromTopic.tasks.indexOf(task), 1);
  let id = oldId;
  if (target.tasks.some((x) => Number(x.id) === id)) {
    // id 是队列内序号：目标队列已有同号 → 重新编号
    id = nextTaskId(target.tasks);
    task.id = id;
  }
  target.tasks.push(task);
  // 源队列里指向它的跨队列引用改写到新地址（本地 id 依赖在搬前已被拒绝，不会残留）
  for (const topic of Object.values(store.topics)) {
    for (const other of topic.tasks || []) {
      if (!Array.isArray(other.blockBy) || !other.blockBy.some((d) => isForeignDep(d))) continue;
      const from = `${fromTopic.key}:${oldId}`;
      const to = `${toKey}:${id}`;
      other.blockBy = other.blockBy.map((d) => (String(d) === from ? to : d));
    }
  }
  fromTopic.updatedAt = stampNow();
  target.updatedAt = stampNow();
  return { topic: target, task };
}

/** 跨队列 blockBy 解析：按 topicKey 找任务（已删/迁出走 null → fail-open） */
export function foreignResolver(store) {
  return (topicKey, taskId) => {
    const topic = store?.topics?.[topicKey];
    if (!topic) return null;
    const task = (topic.tasks || []).find((x) => Number(x.id) === Number(taskId));
    if (!task || task.deletedAt || task.migratedTo) return null;
    return task;
  };
}

export function normalizeTask(t, siblings, readyOpts = {}) {
  const blockBy = normalizeBlockBy(t.blockBy, t.id);
  const blocksFollowing = !!t.blocksFollowing;
  const base = {
    id: Number(t.id) || 0,
    text: String(t.text ?? ''),
    // 状态词汇：pending → consumed（已领取）→ archived（终态：被新任务取代）。
    // **单向**：没有回退边——完成等待验收之后只能往前（归档），不能回 pending（#59）。
    status: t.status === 'consumed' ? 'consumed' : t.status === 'archived' ? 'archived' : 'pending',
    roundSummary: String(t.roundSummary ?? ''),
    createdAt: String(t.createdAt ?? ''),
    consumedAt: String(t.consumedAt ?? ''),
    // 领取耗时：从发布到被领取过了多久（秒）。还没被领的是 null。
    pickupSec: pickupSecOf(t),
    // 领取审计：这条**从哪个池**被领走（local/global）、**被谁**领走（领取方的目录）。
    claimedFrom: String(t.claimedFrom ?? ''),
    claimedBy: String(t.claimedBy ?? ''),
    claimedByName: String(t.claimedByName ?? ''),
    // 软删除标记：删除不再不可逆（可 restore 回来）。词汇与同仓 timegoal 对齐
    // （那边叫 archivedAt + 保留期 + purge）。
    deletedAt: String(t.deletedAt ?? ''),
    // 来源标记：云端清单迁入的任务带 'cloud'（面板据此渲染「来自云端」徽标）
    from: String(t.from ?? ''),
    // 迁出标记：本机 → 云端迁移后原条目保留在此，作为 tombstone（可撤销/移除）。
    // 带 migratedTo 的任务**不再算待领取**（不会被派发给 agent，也不再进看板的
    // 待领取列）——它只是一条「去哪了」的记录。结构 {side:'cloud', topic, targetId, at}。
    migratedTo: t.migratedTo && typeof t.migratedTo === 'object' ? t.migratedTo : null,
    // 任务级 timegoal 声明（add --duration/--goal-prompt 落下来的）：
    // { duration: '2h'（人类写法原文）, prompt: '发布方附加要求' }。领取时刻起表
    // （起点 = consumedAt，goal 落 timegoals.json 的任务维度），交付文本里带 check 指令。
    timegoal: sanitizeTaskGoal(t.timegoal),
    // 完成标记（localtask done 写入）：带时间目标的任务未到点会被拒绝，写不进来。
    completedAt: String(t.completedAt ?? ''),
    // 重开轨迹：现在重开 = **新建一条任务**，旧任务归档（#59）。
    //   forkOf       这条是从哪一条派生的（'队列key:旧编号'）
    //   supersededBy 被哪一条取代（归档那条的落点：{ key, id }）
    //   archivedAt / archivedReason 归档时刻与原因
    forkOf: String(t.forkOf ?? ''),
    supersededBy: t.supersededBy && typeof t.supersededBy === 'object' ? t.supersededBy : null,
    archivedAt: String(t.archivedAt ?? ''),
    archivedReason: String(t.archivedReason ?? ''),
    reopenCount: Number(t.reopenCount) || 0,
    lastReopenedAt: String(t.lastReopenedAt ?? ''),
    // DAG / 闸门（#34）：blockBy=依赖 id；blocksFollowing=挡住数组其后所有 pending
    blockBy,
    blocksFollowing,
  };
  // ready：待领取且未被依赖/闸门挡住（面板徽标用）；给 siblings 才算得准
  // 跨队列依赖靠 readyOpts.resolveForeign（list/get 带 store 时传入）
  if (Array.isArray(siblings) && base.status === 'pending' && !base.deletedAt && !base.migratedTo) {
    base.ready = isReadyToClaim(t, siblings, readyOpts);
  } else if (base.status === 'pending' && !base.deletedAt && !base.migratedTo) {
    base.ready = blockBy.length === 0 && !blocksFollowing ? true : undefined;
  } else {
    base.ready = false;
  }
  return base;
}

// pending 的统一判据：未领取、未删除、未迁出。
// 迁出（tombstone）不算活——它不会被派发，也不该阻塞主题删除或挡住 prune。
export function isPending(t) {
  // 归档（archived）是终态：不再算待领取——否则归档的任务会被重新派发（#59）。
  return t.status !== 'consumed' && t.status !== 'archived' && !t.deletedAt && !t.migratedTo;
}

// 主题的截止时刻（epoch ms）。优先用 waitingUntilMs（毫秒精度，新数据都有），
// 老数据没有这个字段时才回退解析 waitingUntil 字符串（秒级精度）。
export function deadlineMsOf(t) {
  if (!t) return NaN;
  if (Number.isFinite(t.waitingUntilMs) && t.waitingUntilMs > 0) return t.waitingUntilMs;
  return parseStampMs(t.waitingUntil);
}

// 主题是否「真的有人在等」——**必须看截止时刻，不能只看 waiting 标志**。
//
// waiting 标志由 wait 进程写入、结束时复位；跨进程可见，但 wait 被强杀
// （SIGKILL / 任务管理器杀 / 终端关掉 / 机器崩了）时 finally 不会执行，标志
// 就**永久残留**。曾出现过：gs-ac 的 wait 被杀后，标志一直挂着，面板永远显示
// 「等待中 已等 760:35 · 剩 0:00」，用户点「关闭」也没有进程来消费。
//
// 判据：waiting 为真**且**截止时刻还没过。截止时刻已过 = 那个 wait 本来也该
// 收尾了（超时），此时的 waiting 是残留，不是"有人正等着"。
//
// 唯一会误判的窗口：wait 进程还活着、但刚好卡在超时那一瞬（<1s）——那时
// 它下一拍就会自己收尾，短暂显示"已结束"无伤大雅。
export function isLiveWaiting(t, nowMs = Date.now()) {
  if (!t || !t.waiting) return false;
  const until = deadlineMsOf(t);
  if (!Number.isFinite(until)) return false; // 没有截止时刻 = 脏数据，不算等待中
  return until > nowMs;
}

export function topicView(t, repoCtx = null, readyOpts = {}) {
  const tasks = t.tasks.map((x) => normalizeTask(x, t.tasks, readyOpts));
  const live = isLiveWaiting(t);
  return {
    key: t.key,
    cwd: t.cwd || '',
    name: t.name || '',
    summary: t.summary || '',
    // 提交方（add --summary）留下的补充说明：与 agent 的「当前现状」分开存，
    // 两个写入者不再抢同一个字段（以前谁后写谁覆盖，面板上的现状会乱跳）。
    submitSummary: t.submitSummary || '',
    // 这个队列被哪些路径用过（队列按目录名识别，同名目录共用）
    cwds: Array.isArray(t.cwds) && t.cwds.length ? t.cwds.slice() : t.cwd ? [t.cwd] : [],
    // 仓库上下文（来自 repos 模块的本地登记）：目录路径对得上已登记仓库时，
    // 把仓库信息带出来 —— agent 领任务时就知道这条任务属于哪个仓库、周围关联哪些看板。
    // 对不上就是 null（没登记过的目录很正常，不该因此报错）。
    repo: repoCtx || null,
    // waiting 是**对外的真相**：僵尸标志在这里被抹平，面板才不会一直转圈
    waiting: live,
    // 残留标志单独透出，UI 可以说明"上次等待超时、进程已退出"而不是装作从没有过
    staleWaiting: !!t.waiting && !live,
    waitingUntil: t.waitingUntil || '',
    waitingUntilMs: Number(t.waitingUntilMs) || 0,
    waitingSince: t.waitingSince || '',
    cancelRequested: !!t.cancelRequested,
    isGlobal: isGlobalKey(t.key),
    // 手动登记的目录（面板「添加目录」）：空主题也不被 prune 清掉
    manual: !!t.manual,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    pending: tasks.filter(isPending).length,
    // 开/关两个计数分开给（Kanboard 的 nb_open_tasks / nb_closed_tasks）：
    // 面板上「N 待领 · M 已领」比一个总数有用得多——一眼看出还剩多少活、已经干完多少。
    consumed: tasks.filter((x) => x.status === 'consumed' && !x.deletedAt).length,
    // 软删除的条数（还在队列里，可恢复）
    deleted: tasks.filter((x) => !!x.deletedAt).length,
    total: tasks.length,
    tasks,
  };
}
