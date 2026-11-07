// （#54 自 service.js 拆出）单条任务的查/增/改：getTask、addTask（waiter 唤醒链 +
// 全局池 FIFO 投递 + ignoredCwd 如实回带）、updateTask（正文/时间目标/DAG 依赖/改归属搬家）。
import { badInput, notFound } from '../../core/errors.js';
import { parseFrontmatter, preserveFrontmatter } from '../../shared/frontmatter.js';
import { sanitizeTaskGoal } from '../tasktool/taskgoal.js';
import { normalizeBlockBy, isReadyToClaim } from './dag.js';
import { MAX_TEXT, normalizeSummary, normalizeText } from './store-io.js';
import { openLocaltaskStore as openStore, topics as topicsRepo, tasks as tasksRepo, links as linksRepo, txw as tx, db } from './repo/index.js';
import { GLOBAL_KEY, GLOBAL_NAME, GLOBAL_CWD, isGlobalKey, normalizeCwd, resolveTaskKey, topicKeyFor } from './paths.js';
import { normalizeTask, foreignResolver, queueRelationsOf, relocateTask, resolveForkRef } from './task-view.js';
import { takeTopicWaiter, takeGlobalWaiter } from './waiters.js';
import { presence as presenceRepo } from './repo/index.js';
export async function getTask({ cwd: rawCwd, key: rawKey, id } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  openStore();
  const t = topicsRepo.getTopic(key);
  const task = t && t.tasks.find((x) => Number(x.id) === want);
  if (!task) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : cwd}」里没有 #${want} 任务`);
  }
  return normalizeTask(task);
}

/**
 * 向某主题（工作目录）的队列回填任务；global=true 时投递到全局主题（共享池）。
 * 若本进程正有 wait 在等该主题/全局池 → 直接投递并唤醒；否则入队堆积。
 * 全局投递的唤醒链：显式 wait 全局 key 者（罕见）→ globalWaiters FIFO → 入队。
 */
export async function addTask({
  cwd: rawCwd,
  summary: rawSummary,
  text,
  global: toGlobal = false,
  timegoal: rawGoal,
  blockBy: rawBlockBy,
  blocksFollowing = false,
  forkOf: rawForkOf,
  forkKind: rawForkKind,
} = {}) {
  const body = normalizeText(text);
  const summary = normalizeSummary(rawSummary, { optional: true });
  // 任务级 timegoal 声明（--duration/--goal-prompt 落下来的）：校验在 sanitizeTaskGoal
  // （时长写法错误在**发布时报**，不在领取时报）；只带了 --goal-prompt 没带 --duration → 报错。
  // 时长只在发布时显式给——没有全局默认（曾有的 defaultDuration 已删，旧 store 里残留值忽略）。
  let timegoal = null;
  if (rawGoal !== undefined && rawGoal !== null) {
    timegoal = sanitizeTaskGoal(rawGoal);
  }

  openStore();
  let key;
  let cwd;
  let t;
  if (toGlobal) {
    // 全局主题：cwd 恒空、名字固定；--cwd 显式给出也忽略（--global 优先）。
    // 但**不静默**：被忽略的 cwd 会在返回值里带出来（ignoredCwd），
    // 由 CLI/面板如实告诉用户"你给的目录没生效，任务进了全局池"。
    // （gh/kubectl 遇到矛盾参数会直接报错；这里为了不打断既有脚本，
    //   选择"照做 + 明说"，而不是改语义。）
    key = GLOBAL_KEY;
    cwd = GLOBAL_CWD;
    t = topicsRepo.ensureTopic(key, { cwd, name: GLOBAL_NAME });
  } else {
    ({ key, cwd } = normalizeCwd(rawCwd));
    t = topicsRepo.ensureTopic(key, { cwd });
  }
  const tView = topicsRepo.getTopic(key);

  // 编号只在插入的同一个事务里取（insertTask 用 UPDATE ... RETURNING）。
  // 这里读 next_seq 只作为「探针」：让 blockBy 去掉自引用、让 DAG 就绪判断有个 id。
  const provisionalId = tasksRepo.nextSeq(t.id);
  // 链路（#69）：forkOf = 「这条从哪派生」。裸数字 = 同主题父任务编号；
  // 'key:id' = 跨主题。规范化成 'key:id' 存储，父任务必须真实存在（发布时报错）。
  // forkKind 缺省按 comment（评论/随手派生）——reopen 有自己的写入口（task-lifecycle）。
  let forkOf = null; // 解析结果 { key, seq } —— 插入后写链
  let forkKind = '';
  if (rawForkOf !== undefined && rawForkOf !== null && String(rawForkOf).trim() !== '') {
    const ref = resolveForkRef(rawForkOf, key);
    forkOf = { ref };
    forkKind = rawForkKind === 'reopen' ? 'reopen' : 'comment';
  }
  const taskDraft = {
    // 不写 id：真实编号由 insertTask 在事务内分配，避免事务外读号撞车
    text: body,
    status: 'pending',
    timegoal,
    blockBy: normalizeBlockBy(rawBlockBy, provisionalId),
    blocksFollowing: !!blocksFollowing,
    forkOf,
    forkKind,
    createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };

  // 唤醒分两步：先在事务里完成「插入 + 领取标记 + 等待态清理」，提交后才 resolve
  // ——保证 wait 返回时数据必然一致（沿用旧本地路径的顺序）。
  // DAG：被挡住的新任务**不能**直接塞给 waiter——否则闸门/依赖形同虚设。
  let delivered = false;
  let task = null;
  let wakeMeta = null;
  const readyOpts = { resolveForeign: foreignResolver() };
  const probe = normalizeTask({ ...taskDraft, id: provisionalId }, tView.tasks, readyOpts);
  const canDeliver = isReadyToClaim(probe, tView.tasks, readyOpts);

  if (canDeliver && toGlobal) {
    const direct = takeTopicWaiter(GLOBAL_KEY); // 显式等全局 key 的（罕见路径）
    if (direct) {
      wakeMeta = { summary: tView.summary, from: 'global', byKey: GLOBAL_KEY, byName: GLOBAL_NAME, wake: direct.resolve };
      delivered = true;
    } else {
      const gw = takeGlobalWaiter(); // FIFO：最早阻塞的先领
      if (gw) {
        wakeMeta = {
          // roundSummary 记领取方 wait 的现状；claimedBy 记领取方是谁
          summary: gw.summary,
          from: 'global',
          byKey: gw.by && gw.by.key,
          byName: gw.by && gw.by.name,
          wake: gw.onTask,
        };
        delivered = true;
      }
    }
  } else if (canDeliver) {
    const waiter = takeTopicWaiter(key);
    if (waiter) {
      wakeMeta = { summary: tView.summary, from: 'local', byKey: key, byName: tView.name, wake: waiter.resolve };
      delivered = true;
    }
  }

  tx(() => {
    const inserted = tasksRepo.insertTask(t.id, taskDraft);
    task = inserted.task;
    // 派生链：forkOf → addLink(src=新, dst=父)（T04：链 = task_links，不再存 ext_fork_of）
    // forkOf.ref = '父主题key:父seq'——父可能在别的主题，按 key 定位
    if (forkOf) {
      const at = forkOf.ref.lastIndexOf(':');
      const parentTopicKey = forkOf.ref.slice(0, at);
      const parentSeq = Number(forkOf.ref.slice(at + 1));
      const parentTopic = topicsRepo.getTopic(parentTopicKey);
      const parentRow = tasksRepo.getTaskRow(parentTopic.id, parentSeq);
      linksRepo.addLink({
        srcId: Number(
          (db().get('SELECT id FROM tasks WHERE topic_id = :t AND seq = :s', {
            t: t.id,
            s: inserted.id,
          }) || {}).id
        ),
        dstId: parentRow.row.id,
        type: forkKind,
        atMs: Date.now(),
      });
    }
    // 队列顺序：追加到尾（JSON 数组 push 的等价物）
    topicsRepo.mutateOrder(key, (order) => {
      const list = [...order];
      const at = list.indexOf(inserted.id);
      if (at >= 0) list.splice(at, 1);
      list.push(inserted.id);
      return list;
    });
    // 提交方的补充说明写**自己的字段**（submitSummary），不再覆盖 summary。
    // summary 是「agent 当前现状」（由 setWaiting 写）——两个写入者抢同一个字段时，
    // 面板上"当前现状"一会儿是 agent 的、一会儿是提交者的，看着像乱跳。
    if (summary) topicsRepo.updateTopic(key, { submitSummary: summary });
    if (delivered && wakeMeta) {
      // 领取标记（带守卫的 UPDATE：pending ∧ 未删除 才会命中）
      const claimed = tasksRepo.claimTask(t.id, inserted.id, {
        summary: wakeMeta.summary,
        from: wakeMeta.from,
        byKey: wakeMeta.byKey,
        byName: wakeMeta.byName,
      });
      task = claimed || task;
      // 直接投递路径顺带清等待态（旧代码 t.waiting=false / waitingUntil=''）
      presenceRepo.setPresence(key, { waiting: false, untilMs: 0, sinceMs: 0, cancelRequested: false });
    }
    topicsRepo.updateTopic(key, { bumpRevision: true });
    return true;
  });
  if (wakeMeta && wakeMeta.wake) wakeMeta.wake(normalizeTask(task));

  // DAG 单一写路径：闸门/依赖经 Mutator 投影（fail-open，不挡入队）
  if (!toGlobal && (task.blocksFollowing || (task.blockBy && task.blockBy.length))) {
    try {
      const { syncNewTaskDag } = await import('./writes.js');
      await syncNewTaskDag(key, task);
    } catch {
      /* ignore */
    }
  }

  return {
    status: 'ok',
    key,
    cwd,
    name: t.name,
    summary: t.summary,
    isGlobal: toGlobal,
    // --global 与 --cwd 同时给时，cwd 被忽略（--global 优先）。不静默：
    // 把被忽略的那个带出来，让调用方能如实告诉用户"任务进了全局池，不是你给的目录"。
    ignoredCwd: toGlobal && rawCwd && String(rawCwd).trim() ? String(rawCwd).trim() : '',
    task: normalizeTask(task),
    delivered,
    queued: !delivered,
  };
}

// 编辑任务内容 + 时间目标声明。
//
// goal 参数（面板编辑页 / CLI --duration/--goal-prompt/--clear-goal 落下来的）：
//   { duration?: string, prompt?: string, clear?: boolean }
// 语义与发布端对齐——时长只在**未领取**时可改（领取即计时，起表后声明就是既成事实，
// 要调先 reopen 重开任务再改）；pending 任务还没起表（ensureTaskGoal 在领取时刻才调），
// 改声明不碰 timegoals.json，落库即生效。clear 与 duration 互斥，宁报错不猜。
export async function updateTask({
  cwd: rawCwd,
  key: rawKey,
  id,
  text,
  goal,
  blockBy,
  clearBlockBy = false,
  blocksFollowing,
  moveTo,
} = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  const body = String(text ?? '').trim();
  const hasGoalInput = goal && (goal.clear || goal.duration != null || goal.prompt != null);
  const hasDagInput = clearBlockBy || blockBy !== undefined || blocksFollowing !== undefined;
  if (!body && !hasGoalInput && !hasDagInput && !moveTo) {
    throw badInput('--text 不能为空（改时间目标 / blockBy / 闸门 / 搬队列时才可省）');
  }
  if (body && body.length > MAX_TEXT) throw badInput(`任务内容过长（≤${MAX_TEXT} 字）`);
  if (hasGoalInput && goal.clear && goal.duration != null) {
    throw badInput('--clear-goal 与 --duration 不能同时给（清除就清除，不猜意图）');
  }

  openStore();
  const t = topicsRepo.getTopic(key);
  const task = t && t.tasks.find((x) => Number(x.id) === want);
  if (!task) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : cwd}」里没有 #${want} 任务`);
  }
  let goalChanged = null; // 'set' | 'cleared' | null（render 与前端提示用）
  // DAG 边可在 pending 时改；已领取后改依赖不改变「已被领走」的事实，但闸门标记仍影响后面。
  // 先落依赖再搬家：--clear-block-by 可以把依赖先解除，随后搬家守卫就按解除后的口径放行。
  if (hasDagInput) {
    if (task.deletedAt) throw badInput(`#${want} 已删除，依赖/闸门不可改`);
    tx(() => {
      const patch = {};
      if (clearBlockBy) patch.blockBy = [];
      else if (blockBy !== undefined) patch.blockBy = normalizeBlockBy(blockBy, want);
      if (blocksFollowing !== undefined) patch.blocksFollowing = !!blocksFollowing;
      tasksRepo.updateTask(t.id, want, patch);
      return true;
    });
  }
  // 归属变更 → 换队列（归属决定落点，与派任务同一口径）。moveTo 由编排层解析给出。
  // 同一次落盘：搬完再改正文/时间目标，中间任何一步抛错都不落盘。
  // 两种触发、两套口径：
  //   ① 正文里 project 字段变了（明确改归属）→ 搬不动（已领取 / 队列内依赖闸门）就
  //      报错说明，绝不静默吞——吞了就是「改了没生效」这个 bug 本身；
  //   ② 归属没变但队列对不上（历史脏数据自愈）→ 能搬就搬（自愈），搬不动原地保留，
  //      绝不拦普通文案编辑；全局池的任务不搞自愈（别在普通编辑时把共享池搬空）。
  let host = t;
  let hostTask = task;
  let moved = false;
  let movedFrom = null;
  // 正文 / 时间目标与搬家**同一个事务**：中间任何一步抛错都不落盘（旧行为注释保留）。
  tx(() => {
    if (moveTo) {
      const toKey = topicKeyFor(String(moveTo.cwd || ''));
      if (toKey && toKey !== key) {
        const oldProject = String(parseFrontmatter(task.text).project || '').trim();
        const afterText = body ? preserveFrontmatter(task.text, body) : task.text;
        const newProject = String(parseFrontmatter(afterText).project || '').trim();
        const explicitChange = !!newProject && newProject !== oldProject;
        const rel = queueRelationsOf(t, task);
        // 正判定：只有「待领取」能改归属项目（已领取/已交付的落点在领取时定下，要改先 reopen）
        const movable = task.status === 'pending' && !rel.length;
        if (explicitChange && !movable) {
          if (task.status !== 'pending') {
            throw badInput(
              `#${want} 已领取或已交付——这种任务不能改归属项目（落点是提交/领取时定下的，要改先 reopen）`,
            );
          }
          throw badInput(
            `#${want} 在本队列里有${rel.join('、')}——依赖/闸门是队列内语义，改归属项目会跨队列断链；` +
              '请先解除这些关系（编排面板可清），再改归属项目',
          );
        }
        // 搬家必须与后面的正文/目标写入同事务：搬到一半再抛错，就是「任务凭空消失」。
        if (movable && !isGlobalKey(key)) {
          const movedTo = relocateTask(t, want, moveTo);
          if (movedTo) {
            host = movedTo.topic;
            hostTask = movedTo.task;
            moved = true;
            movedFrom = { key, name: t.name, id: want };
          }
        }
      }
    }
    if (body) {
      tasksRepo.updateTask(host.id, hostTask.id, {
        text: preserveFrontmatter(hostTask.text, body),
      });
    }
    if (hasGoalInput) {
      const live = topicsRepo.getTopic(host.key).tasks.find((x) => Number(x.id) === Number(hostTask.id));
      if (live.status !== 'pending') {
        throw badInput(`#${want} 已领取或已交付，时间目标声明不可改——要调整先 reopen 重开任务`);
      }
      if (live.deletedAt) throw badInput(`#${want} 已删除，时间目标声明不可改`);
      if (live.migratedTo) throw badInput(`#${want} 已迁出，时间目标声明不可改`);
      if (goal.clear) {
        tasksRepo.updateTask(host.id, live.id, { timegoal: null });
        goalChanged = 'cleared';
      } else {
        // 只改时长没带 prompt → 保留原附加要求；带了（含空串）→ 以传入为准
        const prev = sanitizeTaskGoal(live.timegoal);
        const prompt = goal.prompt != null ? String(goal.prompt).trim() : prev ? prev.prompt : '';
        tasksRepo.updateTask(host.id, live.id, {
          timegoal: sanitizeTaskGoal({ duration: goal.duration, prompt }),
        });
        goalChanged = 'set';
      }
    }
    // 搬家动了两个队列，源/目标都要顶 revision（引擎在途快照对两个都可能过期）
    topicsRepo.updateTopic(host.key, { bumpRevision: true });
    if (host.key !== key) topicsRepo.updateTopic(key, { bumpRevision: true });
    return true;
  });
  if (hasDagInput) {
    try {
      const { syncTaskDagUpdate } = await import('./writes.js');
      await syncTaskDagUpdate(host.key, Number(hostTask.id), { blockBy, clearBlockBy, blocksFollowing });
    } catch {
      /* fail-open */
    }
  }
  // 搬家/编辑后的最新视图（host.tasks 需要重读 —— 上面写的是行，不是视图对象）
  const hostView = topicsRepo.getTopic(host.key);
  const liveTask = hostView.tasks.find((x) => Number(x.id) === Number(hostTask.id)) || hostTask;
  return {
    status: 'ok',
    key: host.key,
    cwd: hostView.cwd || cwd,
    name: hostView.name,
    goalChanged,
    task: normalizeTask(liveTask, hostView.tasks),
    moved,
    movedFrom,
  };
}

/**
 * 克隆任务（#70）：以现任务为模板快速复制一条新任务——**只复制正文内容**。
 *
 * 与派生（reopen 反馈 / 评论 forkOf）刻意划清界限：
 *   - 不写 forkOf / forkKind——克隆没有「从哪来」的语义，就是拿内容当模板开新活；
 *   - 不继承 timegoal / blockBy / blocksFollowing——约束跟着活走，克隆是新的一件；
 *   - 源任务一个字不动（不归档、不改状态）——clone 之后两条并存。
 * 落点：同主题（全局任务仍进全局池）。正文带 frontmatter 时走 addTask 既有口径
 * （归属 fail-open、落点跟项目队列）。
 */
export async function cloneTask({ cwd: rawCwd, key: rawKey, id } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  openStore();
  const t = topicsRepo.getTopic(key);
  if (!t) throw notFound('主题不存在: ' + key);
  const src = (t.tasks || []).find((x) => Number(x.id) === want && !x.deletedAt && !x.migratedTo);
  if (!src) throw notFound('任务不存在或已删除: #' + want);
  const toGlobal = isGlobalKey(key);
  const res = await addTask({
    text: src.text,
    global: toGlobal,
    cwd: toGlobal ? undefined : t.cwd || rawCwd,
  });
  return { ...res, cloned: true, from: { key, id: want } };
}
