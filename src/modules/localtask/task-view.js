// （#54 自 service.js 拆出）任务行/主题的只读视图与队列内关系原语：
// normalizeTask（含 ready 徽标）、topicView、跨队列依赖解析器（foreignResolver）、
// 队列内关系清单（queueRelationsOf）与搬家（relocateTask）。
import { badInput, notFound } from '../../core/errors.js';
import { sanitizeTaskGoal } from '../tasktool/taskgoal.js';
import { normalizeBlockBy, isReadyToClaim } from './dag.js';
import { isGlobalKey, topicKeyFor, resolveTaskKey } from './paths.js';
import { parseStampMs, stampNow } from './store-io.js';
import { topics as topicsRepo, tasks as tasksRepo, links as linksRepo, db } from './repo/index.js';
import { parseFrontmatter } from '../../shared/frontmatter.js';
import { isPending } from '../../shared/task-status.js';
// 领取耗时（秒）：**发布 → 被领取**的时间差。
// 数据本来就在（createdAt / consumedAt），这里算成派生字段，省得每个使用方自己算，
// 也省得存一份会漂移的冗余副本。
// 只有真的被领走的才有值；还没被领的返回 null（那是"还在等"，由使用方按当前时间算）。
function pickupSecOf(t) {
  // 不再按 status 判：没被领过的行 consumedAt 本来就是空串，parseStampMs 会返回 NaN。
  // （以前这里靠「status 是 consumed 或 archived」当闸门 —— 词表一改就成了第二个真值源。）
  if (!t) return null;
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
 * 同一主题 → 原样返回 null（不搬）。**必须在调用方的事务里**（updateTask 的搬家
 * 与正文/时间目标写入是同一次落盘 —— repo 方法嵌套进外层 tx 自动降级 SAVEPOINT）。
 *
 * 引用修复：源队列里指向它的本地 id 依赖已被上游拒绝；跨队列引用（含源队列其他
 * 任务对它的 "fromKey:oldSeq"）在搬完统改写到新地址，编排连线不断。
 * 撞号时目标队列按其 next_seq 重新编号（与 JSON 时代 nextTaskId 重编号一致）。
 */
/**
 * 搬队列（T04 派生模型）：旧任务软删 + cancelled；目标队列派生新任务
 * （目标队列新 seq、进目标 order 数组尾），链 type='reopen' + ext_move_from
 * 标记"这是搬队列不是真 reopen"。返回值同时带旧号与新号。
 *
 * 必须在调用方的事务里（updateTask 的搬家与正文/时间目标写入是同一次落盘）。
 * 引用修复：本地 id 依赖在搬前已被守卫拒绝；跨队列引用（含指向旧地址的
 * "fromKey:oldSeq"）在搬完统改写到新地址。
 */
export function relocateTask(fromTopic, seq, moveTo) {
  const toCwd = String(moveTo?.cwd || '').trim();
  if (!toCwd) return null;
  const toKey = topicKeyFor(toCwd);
  if (toKey === fromTopic.key) return null;
  const target = topicsRepo.ensureTopic(toKey, { cwd: toCwd, name: moveTo.name || '' });
  const oldSeq = Number(seq);
  const src = tasksRepo.getTaskRow(fromTopic.id, oldSeq);
  if (!src) return null;

  // 1. 派生新任务到目标队列（新 seq 由事务内 takeSeq 分配；round/正文/timegoal 跟着走）
  const inserted = tasksRepo.insertTask(target.id, {
    text: src.task.text,
    status: src.task.status,
    round: Number(src.task.reopenCount) + 1, // round 不变（搬队列不是新一轮）
    fromSrc: src.task.from || '',
    timegoal: src.task.timegoal || null,
    createdAt: src.task.createdAt,
    consumedAt: src.task.consumedAt || '',
    completedAt: src.task.completedAt || '',
    roundSummary: src.task.roundSummary || '',
    moveFrom: { key: fromTopic.key, seq: oldSeq, at: stampNow() },
    blocksFollowing: !!src.task.blocksFollowing,
    blockBy: (src.task.blockBy || []).filter((d) => String(d).includes(':')).map(String),
  });
  const newId = inserted.id;

  // 2. 源任务软删 + cancelled（tombstone：留一行"搬去哪了"的记录）
  tasksRepo.updateTask(fromTopic.id, oldSeq, {
    deletedAt: stampNow(),
    status: 'cancelled',
    moveFrom: { key: toKey, seq: newId, at: stampNow() },
  });

  // 3. 链：新 → 旧，type='reopen'（搬队列是派生的特例）
  linksRepo.addLink({
    srcId: Number(
      (db().get('SELECT id FROM tasks WHERE topic_id = :t AND seq = :s', {
        t: target.id,
        s: newId,
      }) || {}).id
    ),
    dstId: src.row.id,
    type: 'reopen',
    note: 'moved to ' + toKey,
    atMs: Date.now(),
  });

  // 4. 跨队列引用改写：指向旧地址的 "fromKey:oldSeq" → 新地址
  for (const row of db().all('SELECT topic_id FROM tasks WHERE ext LIKE :pat', {
    pat: '%' + fromTopic.key + ':' + oldSeq + '%',
  })) {
    for (const other of tasksRepo.listTaskRowsByTopic(Number(row.topic_id))) {
      if (!Array.isArray(other.task.blockBy) || !other.task.blockBy.some((d) => String(d).includes(':'))) continue;
      const from = fromTopic.key + ':' + oldSeq;
      const to = toKey + ':' + newId;
      if (!other.task.blockBy.some((d) => String(d) === from)) continue;
      tasksRepo.updateTask(Number(row.topic_id), other.task.id, {
        blockBy: other.task.blockBy.map((d) => (String(d) === from ? to : d)),
      });
    }
  }

  // 5. 队列顺序：源摘除、目标追加
  topicsRepo.mutateOrder(fromTopic.key, (order) => order.filter((x) => x !== oldSeq));
  topicsRepo.mutateOrder(toKey, (order) => {
    const list = [...order];
    const at = list.indexOf(newId);
    if (at >= 0) list.splice(at, 1);
    list.push(newId);
    return list;
  });

  topicsRepo.updateTopic(fromTopic.key, { bumpRevision: true });
  topicsRepo.updateTopic(toKey, { bumpRevision: true });
  return {
    topic: topicsRepo.getTopic(toKey),
    task: tasksRepo.getTaskRow(target.id, newId).task,
    oldId: oldSeq,
    newId,
  };
}

/** 跨队列 blockBy 解析：按 topicKey 找任务（已删/迁出走 null → fail-open）。
 *  T03：直接查库（不喂 store 快照）—— 依赖判定永远看最新一行。 */
export function foreignResolver() {
  return (topicKey, taskId) => {
    const topic = topicsRepo.getTopic(String(topicKey));
    if (!topic) return null;
    const task = (topic.tasks || []).find((x) => Number(x.id) === Number(taskId));
    if (!task || task.deletedAt || task.migratedTo) return null;
    return task;
  };
}

// 组任务标注（#85 两种走向）：正文 frontmatter 的 board 值——项目组「＋ 新增任务」
// 预写、CLI add --board 落下来的都算。**物理队列不变**（agent 按项目目录领取照旧）；
// 面板据此把组任务从**项目走向**的列表与计数里分流出去，组页仍按 board 归属认领。
// parseFrontmatter 不抛错（无块/坏块都回空对象），没有 board → ''（= 纯项目任务）。
function boardMarkOf(t) {
  const fm = parseFrontmatter(String(t.text ?? ''));
  return fm.board ? String(fm.board).trim() : '';
}

export function normalizeTask(t, siblings, readyOpts = {}) {
  const blockBy = normalizeBlockBy(t.blockBy, t.id);
  const blocksFollowing = !!t.blocksFollowing;
  const base = {
    id: Number(t.id) || 0,
    text: String(t.text ?? ''),
    // 状态词表：pending / claimed / done / cancelled（权威见 src/shared/task-status.js）。
    // **不认识的词原样透出**，不做「归一成 pending」的兜底 —— 兜底等于把没见过的状态
    // 变成可领取任务（agent 会把已交付的活儿再干一遍）。旧词（consumed/archived）在
    // 过渡期会原样出现，跑一次 scripts/rewrite-json-status.mjs 即可消除。
    status: String(t.status ?? '') || 'pending',
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
    // 组任务标注（#85）：frontmatter.board 原样（面板创建写 board id，也可能有
    // 手写 key/name）；'' = 纯项目任务。分流判据只在标注，不重复解析正文。
    boardMark: boardMarkOf(t),
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
    // ─── 过渡别名（T03 之后删除）───────────────────────────────────────
    // 词表统一后「交付完成」的规范叫法是 doneAt + feedback（库里是 done_at / feedback）。
    // JSON 过渡期这两个字段还是 completedAt / roundSummary，这里给同一事实补上规范名，
    // 让 API 使用方不必再记两套名字；**写路径只有旧名**，别名只读。
    doneAt: String(t.completedAt ?? ''),
    feedback: String(t.roundSummary ?? ''),
    // 重开轨迹（#74）：就地重开，历史进 history[]；forkOf 仅兼容旧 #59/#69 派生数据。
    //   history      同任务内的链节点（origin / reopen / comment），点开可旁路查看
    //   forkOf       旧派生链（'队列key:旧编号'）——新 reopen 不再写
    //   forkKind     最近一次事件种类（reopen / comment），或旧派生种类
    //   supersededBy / archived*  旧归档残留字段
    // 被取代标记：派生模型里 = 取代本任务的新任务编号（数字）；迁移来的旧数据可能是对象
    supersededBy:
      typeof t.supersededBy === 'object' && t.supersededBy !== null
        ? t.supersededBy
        : t.supersededBy != null && t.supersededBy !== ''
          ? Number(t.supersededBy) || t.supersededBy
          : null,
    archivedAt: String(t.archivedAt ?? ''),
    archivedReason: String(t.archivedReason ?? ''),
    reopenCount: Number(t.reopenCount) || 0,
    // 派生子任务数（#144）：>0 = 已有后续轮次/评论派生——反馈入口只在链尖显示
    childCount: Number(t.childCount) || 0,
    // 派生的「下一轮」数（#172）：reopen 边数——>0 = 本条已被下一轮取代（不是链尖）。
    // 进程面板据此只留链尖，旧轮次去任务链里看；comment / feedback 边（旁支新活）不计入。
    childRoundCount: Number(t.childRoundCount) || 0,
    // 链上第几轮（#122 进程面板「楼数」）：根任务 = 1，派生 = 来源 + 1（schema 语义
    // 见 v1.sql tasks.round）。库里存的是 round 列，JSON 形态只带 reopenCount = round-1
    // （repo/rows.js），这里换算回来 —— 前端显示「第 N 楼」/按楼搜索不必再回溯链。
    round: Math.max(1, (Number(t.reopenCount) || 0) + 1),
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

// pending 的统一判据（**正判定**）：`status === 'pending'` 且未删除、未迁出。
// 迁出（tombstone）不算活——它不会被派发，也不该阻塞主题删除或挡住 prune。
//
// 权威实现在 src/shared/task-status.js（前端与后端共用同一份），这里只做转发，
// 让 `import { isPending } from './task-view.js'` 的老调用点（deletion / move-prims /
// task-lifecycle）一行不用改。**别再在这里写第二份判断**。
export { isPending };

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
    // 词表统一后「已领」与「已交付」是两个词，计数也分开（旧口径把两者算在一起）。
    claimed: tasks.filter((x) => x.status === 'claimed' && !x.deletedAt).length,
    done: tasks.filter((x) => x.status === 'done' && !x.deletedAt).length,
    // 软删除的条数（还在队列里，可恢复）
    deleted: tasks.filter((x) => !!x.deletedAt).length,
    total: tasks.length,
    tasks,
  };
}


// 任务链两套来源（#74 / 兼容 #69）：
//   history[]     —— 同任务内就地重开/评论节点（主路径）
//   forkOf 派生   —— 旧「新建任务」链（祖先 + 子任务）
// 三个原语：
//   resolveForkRef —— 发布侧：裸数字（同主题）/'key:id'（跨主题）规范化 + 验证父任务存在
//   forkRow        —— 按引用取行（内部；软删/迁出不算存在）
//   taskChain      —— 查询侧：history 节点 + 祖先链 + 子任务

function forkRow(ref) {
  const m = /^(.+):(\d+)$/.exec(String(ref || ''));
  if (!m) return null;
  const topic = topicsRepo.getTopic(m[1]);
  if (!topic) return null;
  const task = (topic.tasks || []).find(
    (x) => Number(x.id) === Number(m[2]) && !x.deletedAt && !x.migratedTo,
  );
  return task ? { topic, task } : null;
}

/** 发布侧把 forkOf 引用规范化成 'key:id'。父任务不存在直接报错（链就是拿来查的，虚链没意义）。 */
export function resolveForkRef(raw, defaultKey) {
  const s = String(raw ?? '').trim();
  if (!s) throw badInput('forkOf 不能为空');
  const m = /^(.+):(\d+)$/.exec(s);
  const key = m ? m[1] : String(defaultKey || '');
  const id = Number(m ? m[2] : s);
  if (!key) throw badInput(`forkOf 跨主题引用必须带主题: ${s}（'key:id'）`);
  if (!Number.isFinite(id) || id <= 0) {
    throw badInput(`forkOf 无法解析: ${s}（裸数字=同主题父任务编号，或 'key:id'=跨主题）`);
  }
  if (!forkRow(`${key}:${id}`)) {
    throw badInput(`forkOf 指向的任务不存在: ${key}:${id}`);
  }
  return `${key}:${id}`;
}

// 链条节点的人读视图：不吐正文全文（链上可能一长串），给首行节选。
function chainLite(topic, t) {
  const firstLine =
    String(t.text ?? '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) || '';
  return {
    key: topic.key,
    name: topic.name,
    id: Number(t.id) || 0,
    status: t.status,
    forkKind: t.forkKind === 'reopen' || t.forkKind === 'comment' ? t.forkKind : '',
    forkOf: String(t.forkOf ?? ''),
    createdAt: String(t.createdAt ?? ''),
    excerpt: firstLine.replace(/^#+\s*/, '').slice(0, 100),
  };
}

/** 任务链查询（T04 派生模型）：链 = task_links（唯一来源），不再读 history[] / forkOf。 */
export async function taskChain({ id, cwd, key } = {}) {
  const k = resolveTaskKey({ key, cwd });
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  const t = topicsRepo.getTopic(k);
  if (!t) throw notFound('主题不存在: ' + k);
  const self = (t.tasks || []).find((x) => Number(x.id) === want && !x.deletedAt && !x.migratedTo);
  if (!self) throw notFound('任务不存在或已删除: #' + want);

  const selfRow = tasksRepo.getTaskRow(t.id, want);
  const { ancestors: ancestorLinks, descendants: descendantLinks } = linksRepo.chainOf(selfRow.row.id);

  // 节点 = 链上每一代任务（每轮一条，seq 做面板 key），从根排到叶；自己是"当前尖"
  // wrapper = getTaskRowById 的返回（{ row, task }）；row.topicId 是主题内部 id
  // 链边的类型（reopen=反馈轮次 / comment=评论旁支）从**边**上取：task_links 是链的
  // 唯一来源，任务自身那个旧 forkKind 字段多半是空的——空着的话面板的链上每一格
  // 都显示成「起点」，看不出哪一轮是反馈、哪一条是评论旁支（#172）。
  const nodeOf = (wrapper, linkType) => {
    const owner = topicsRepo.getTopicById(wrapper.row.topicId);
    const lite = chainLite(owner || { key: k, name: t.name }, wrapper.task);
    return {
      ...lite,
      forkKind: linkType || lite.forkKind || '',
      at: String(wrapper.task.createdAt || ''),
      current: Number(wrapper.task.id) === Number(selfRow.task.id),
    };
  };
  const upNodes = ancestorLinks.map((l) => nodeOf(tasksRepo.getTaskRowById(l.id), l.type));
  const downNodes = descendantLinks.map((l) => nodeOf(tasksRepo.getTaskRowById(l.id), l.type));
  const selfNode = nodeOf(selfRow);
  // 根 → … → 自己 → … → 叶（自己是"当前尖"；查询哪条，哪条就是尖）
  const nodes = [...upNodes, selfNode, ...downNodes].map(
    (n) => ({ ...n, current: n.id === Number(selfRow.task.id) || n.current })
  );

  // 祖先/子任务清单（旧字段形状保留：面板兼容）
  const ancestors = upNodes.map((n) => ({ key: n.key, name: n.name, id: n.id, status: n.status, forkKind: n.forkKind || '', forkOf: '', createdAt: n.createdAt, excerpt: n.excerpt }));
  const children = downNodes.map((n) => ({ key: n.key, name: n.name, id: n.id, status: n.status, forkKind: n.forkKind || '', forkOf: '', createdAt: n.createdAt, excerpt: n.excerpt }));

  return {
    status: 'ok',
    key: k,
    name: t.name,
    id: want,
    task: normalizeTask(self, t.tasks),
    nodes,
    ancestors,
    children,
    // T04：轮次与派生来源（CLI localtask chain 输出用）
    round: (Number(self.reopenCount) || 0) + 1,
    derivedFrom: upNodes.length
      ? `${upNodes.at(-1).id} @ ${upNodes.at(-1).name}（${ancestorLinks.at(-1)?.type || 'reopen'}）`
      : null,
    childCount: children.length,
  };
}
