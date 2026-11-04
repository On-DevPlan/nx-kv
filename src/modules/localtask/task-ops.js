// （#54 自 service.js 拆出）单条任务的查/增/改：getTask、addTask（waiter 唤醒链 +
// 全局池 FIFO 投递 + ignoredCwd 如实回带）、updateTask（正文/时间目标/DAG 依赖/改归属搬家）。
import { basename } from 'node:path';
import { badInput } from '../../core/errors.js';
import { parseFrontmatter, preserveFrontmatter } from '../../shared/frontmatter.js';
import { sanitizeTaskGoal } from '../tasktool/taskgoal.js';
import { normalizeBlockBy, isReadyToClaim } from './dag.js';
import {
  MAX_TEXT,
  loadStore,
  saveStore,
  stampNow,
  normalizeSummary,
  normalizeText,
  topicOf,
  nextTaskId,
} from './store-io.js';
import { GLOBAL_KEY, GLOBAL_NAME, GLOBAL_CWD, isGlobalKey, normalizeCwd, resolveTaskKey, topicKeyFor } from './paths.js';
import { normalizeTask, foreignResolver, queueRelationsOf, relocateInStore } from './task-view.js';
import { takeTopicWaiter, takeGlobalWaiter, markConsumed } from './waiters.js';
export async function getTask({ cwd: rawCwd, key: rawKey, id } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  const store = await loadStore();
  const t = store.topics[key];
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

  const store = await loadStore();
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
    t = topicOf(store, key, cwd, GLOBAL_NAME);
  } else {
    ({ key, cwd } = normalizeCwd(rawCwd));
    t = topicOf(store, key, cwd);
  }

  const id = nextTaskId(t.tasks);
  const task = normalizeTask({
    id,
    text: body,
    status: 'pending',
    createdAt: stampNow(),
    timegoal,
    blockBy: normalizeBlockBy(rawBlockBy, id),
    blocksFollowing: !!blocksFollowing,
  });
  t.tasks.push(task);
  t.updatedAt = stampNow();
  // 提交方的补充说明写**自己的字段**（submitSummary），不再覆盖 t.summary。
  // t.summary 是「agent 当前现状」（由 setWaiting 写）——两个写入者抢同一个字段时，
  // 面板上"当前现状"一会儿是 agent 的、一会儿是提交者的，看着像乱跳。
  if (summary) t.submitSummary = summary;

  // 唤醒分两步：先在 store 里标记消费，saveStore 之后才 resolve——保证 wait 返回时
  // 数据必然一致（沿用旧本地路径的顺序）。
  // DAG：被挡住的新任务**不能**直接塞给 waiter——否则闸门/依赖形同虚设。
  let delivered = false;
  let wake = null; // (task) => void
  const canDeliver = isReadyToClaim(task, t.tasks, { resolveForeign: foreignResolver(store) });

  if (canDeliver && toGlobal) {
    const direct = takeTopicWaiter(GLOBAL_KEY); // 显式等全局 key 的（罕见路径）
    if (direct) {
      markConsumed(task, t.summary, { from: 'global', byKey: GLOBAL_KEY, byName: GLOBAL_NAME });
      t.waiting = false;
      t.waitingUntil = '';
      delivered = true;
      wake = direct.resolve;
    } else {
      const gw = takeGlobalWaiter(); // FIFO：最早阻塞的先领
      if (gw) {
        markConsumed(task, gw.summary, {
          // roundSummary 记领取方 wait 的现状；claimedBy 记领取方是谁
          from: 'global',
          byKey: gw.by && gw.by.key,
          byName: gw.by && gw.by.name,
        });
        delivered = true;
        wake = gw.onTask;
      }
    }
  } else if (canDeliver) {
    const waiter = takeTopicWaiter(key);
    if (waiter) {
      markConsumed(task, t.summary, { from: 'local', byKey: key, byName: t.name });
      t.waiting = false;
      t.waitingUntil = '';
      delivered = true;
      wake = waiter.resolve;
    }
  }

  await saveStore(store); // 先落盘再唤醒：wait 返回时数据必然一致
  if (wake) wake(normalizeTask(task));

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
  if (!body && !hasGoalInput && !hasDagInput) {
    throw badInput('--text 不能为空（改时间目标 / blockBy / 闸门时才可省）');
  }
  if (body && body.length > MAX_TEXT) throw badInput(`任务内容过长（≤${MAX_TEXT} 字）`);
  if (hasGoalInput && goal.clear && goal.duration != null) {
    throw badInput('--clear-goal 与 --duration 不能同时给（清除就清除，不猜意图）');
  }

  const store = await loadStore();
  const t = store.topics[key];
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
    if (clearBlockBy) task.blockBy = [];
    else if (blockBy !== undefined) task.blockBy = normalizeBlockBy(blockBy, want);
    if (blocksFollowing !== undefined) task.blocksFollowing = !!blocksFollowing;
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
  if (moveTo) {
    const toKey = topicKeyFor(basename(String(moveTo.cwd || '')));
    if (toKey && toKey !== key) {
      const oldProject = String(parseFrontmatter(task.text).project || '').trim();
      const afterText = body ? preserveFrontmatter(task.text, body) : task.text;
      const newProject = String(parseFrontmatter(afterText).project || '').trim();
      const explicitChange = !!newProject && newProject !== oldProject;
      const rel = queueRelationsOf(t, task);
      const movable = task.status !== 'consumed' && !rel.length;
      if (explicitChange && !movable) {
        if (task.status === 'consumed') {
          throw badInput(
            `#${want} 已领取——已领取的任务不能改归属项目（落点是提交/领取时定下的，要改先 reopen）`,
          );
        }
        throw badInput(
          `#${want} 在本队列里有${rel.join('、')}——依赖/闸门是队列内语义，改归属项目会跨队列断链；` +
            '请先解除这些关系（编排面板可清），再改归属项目',
        );
      }
      if (movable && !isGlobalKey(key)) {
        const movedTo = relocateInStore(store, t, task, moveTo);
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
    hostTask.text = preserveFrontmatter(hostTask.text, body);
  }
  if (hasGoalInput) {
    if (hostTask.status === 'consumed') {
      throw badInput(`#${want} 已领取计时中，时间目标声明不可改——要调整先 reopen 重开任务`);
    }
    if (hostTask.deletedAt) throw badInput(`#${want} 已删除，时间目标声明不可改`);
    if (hostTask.migratedTo) throw badInput(`#${want} 已迁出，时间目标声明不可改`);
    if (goal.clear) {
      hostTask.timegoal = null;
      goalChanged = 'cleared';
    } else {
      // 只改时长没带 prompt → 保留原附加要求；带了（含空串）→ 以传入为准
      const prev = sanitizeTaskGoal(hostTask.timegoal);
      const prompt = goal.prompt != null ? String(goal.prompt).trim() : prev ? prev.prompt : '';
      hostTask.timegoal = sanitizeTaskGoal({ duration: goal.duration, prompt });
      goalChanged = 'set';
    }
  }
  host.updatedAt = stampNow();
  if (host !== t) t.updatedAt = stampNow();
  await saveStore(store);
  if (hasDagInput) {
    try {
      const { syncTaskDagUpdate } = await import('./writes.js');
      await syncTaskDagUpdate(host.key, Number(hostTask.id), { blockBy, clearBlockBy, blocksFollowing });
    } catch {
      /* fail-open */
    }
  }
  return {
    status: 'ok',
    key: host.key,
    cwd: host.cwd || cwd,
    name: host.name,
    goalChanged,
    task: normalizeTask(hostTask, host.tasks),
    moved,
    movedFrom,
  };
}
