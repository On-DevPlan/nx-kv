// 清单 service —— 四把 key 上的读-改-写。
//
// ─── 必须知道的五条契约（前四条来自 Flutter 端 todo_submit_service.dart 的文件头注释）───
//
// 1. **id 分配必须扫「待办 + 冻结」**。冻结任务保留原 id，只扫待办的话，
//    待办清空后会从 1 重新分配，与冻结任务撞车。
//    实测佐证：todo:open 为空、todo:freeze 有 id 2/10/17/23/24/28，只扫 open 会分配 1。
//
// 2. **topic 不在快捷列表时，要连 `todo:topics` 一起写**，否则它不会出现在候选里。
//
// 3. **两把 key 一起写**。后端 KV **没有事务**，所以「一起写」只能做到：
//    按「先写主数据、后写辅助数据」的顺序，并如实报告部分失败。
//    顺序是刻意的 —— open 先于 topics：万一 topics 写失败，任务本身不丢，
//    只是短期内不在快捷候选里；反过来则会丢失任务。
//
// 5. **定位一律按内容（文本 ref），不按 id**。id 只是给人看的元数据——
//    它既会被复用（分配只扫 open + freeze），同一主题里也本来就有重复内容。
//    详见下方「定位」一节。
//
// ─── 时间格式（沿用既有数据的约定，不要统一）───
//   createdAt / frozenAt：Dart `toIso8601String()` 风格，本地时间无时区
//                          例 2026-08-14T19:04:56.028788
//   doneAt              ：RFC3339 带偏移
//                          例 2026-08-15T14:32:53+08:00
// 两种格式在同一份数据里并存是既成事实，改掉会破坏既有记录的可比性。
import { kvGet, kvSet, kvDelete } from '../../core/kvapi.js';
import { loadConfig, requireAuth, normalizeGroupId } from '../../core/config.js';
import { badInput, notFound, conflict } from '../../core/errors.js';

export const KEY = {
  open: 'todo:open',
  done: 'todo:done',
  topics: 'todo:topics',
  freeze: 'todo:freeze',
};
export const PROMPT_PREFIX = 'todo:prompt:';
export const COLD_PREFIX = 'todo:done:cold:';

const BUCKETS = ['open', 'done', 'freeze'];

// ─── 时间 ──────────────────────────────────────────────────────────

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Dart toIso8601String() 风格：本地时间、微秒精度、无时区后缀。
 *  JS 的 Date 只有毫秒精度，微秒位补 000 —— 形状与既有数据一致即可，
 *  下游从不解析这两位的实际值。 */
export function dartNow(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}000`
  );
}

/** RFC3339 带本地偏移，例 2026-08-15T14:32:53+08:00 */
export function rfc3339Now(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// ─── 任务模型 ──────────────────────────────────────────────────────

export function normalizeTask(t) {
  return {
    id: Number(t.id) || 0,
    topic: String(t.topic ?? ''),
    text: String(t.text ?? ''),
    createdAt: String(t.createdAt ?? ''),
    doneAt: String(t.doneAt ?? ''),
    note: String(t.note ?? ''),
    frozenAt: String(t.frozenAt ?? ''),
  };
}

function parseTasks(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(normalizeTask) : [];
  } catch {
    // 快照损坏时返回空数组而不抛 —— 读侧不该因为一条脏数据整个失效
    return [];
  }
}

function parseTopics(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String).filter((s) => s.trim()) : [];
  } catch {
    return [];
  }
}

// ─── groupId 回落 ──────────────────────────────────────────────────
//
// 显式传入（--group）优先，否则用本机配置里的**当前工作空间**。
//
// 这一步刻意放在读写边界（下面两个函数）而不是每个 action 里：
// 放边界上，读与写必然用同一个 groupId；放到 action 里，一旦有人漏了一处，
// 就会出现「从 A 组读、往 B 组写」——而这类错不会报错，只会静默写错空间。
async function resolveGroup(groupId) {
  if (groupId !== undefined && groupId !== null && groupId !== '') {
    return normalizeGroupId(groupId);
  }
  const cfg = await loadConfig();
  return normalizeGroupId(cfg.groupId);
}

// ─── 读 ────────────────────────────────────────────────────────────

async function readKey(key, groupId) {
  const item = await kvGet(key, await resolveGroup(groupId));
  return item ? item.value : '';
}

/** 读入全部四个 key。list/get 等只读操作走这里，一次拿齐。 */
export async function loadAll(groupId) {
  await requireAuth();
  const gid = normalizeGroupId(groupId);
  const [open, done, freeze, topics] = await Promise.all([
    readKey(KEY.open, gid),
    readKey(KEY.done, gid),
    readKey(KEY.freeze, gid),
    readKey(KEY.topics, gid),
  ]);
  return {
    open: parseTasks(open),
    done: parseTasks(done),
    freeze: parseTasks(freeze),
    topics: parseTopics(topics),
  };
}

/** 待办 + 冻结的 id 最大值 + 1（契约 1） */
export function nextTaskId(open, freeze) {
  let max = 0;
  for (const t of [...open, ...freeze]) if (t.id > max) max = t.id;
  return max + 1;
}

// ─── 定位：一律按**内容**，不按 id ⚠️ ──────────────────────────────
//
// **id 非常容易重复，不足以定位一条任务。** 两条独立的原因：
//
//   1. 分配只扫 open + freeze（契约 1），任务完成、open 清空后新任务会重新
//      用上已占过的 id。实测 done 有 68 条、其中 id=29 有 7 条。
//   2. 同一个主题里，写「修复登录页」这样内容的任务本来就会反复出现——
//      即使 id 不撞，光看 id 也说不清调用方指的是哪一条。
//
// 所以 `id` 在本项目里**只是给人和外部系统看的元数据**：继续分配、继续出现在
// 输出里，但**不再是任何命令的入参**。定位一律用文本内容，见下面的 ref。
//
// 由此推出两条硬约束，违反其一都会静默改错数据：
//
//   1. **命中多条时必须消歧，不能猜一条。** 用 `findIndex` 取第一条，
//      在 done 上取到的是最老的记录，而调用方往往以为自己在操作刚创建的那条。
//   2. **变更必须按 index 定位，禁止 `filter(t => t.text !== ref)`。**
//      后者会把**所有**同内容的条目一起删掉。

/** 找出所有内容匹配的条目（跨桶，含同桶内重复）。
 *  用整串精确比对——不做前缀/模糊匹配，避免「看起来像」被当成「就是它」。 */
export function locateAll(all, ref) {
  const want = String(ref ?? '');
  const hits = [];
  for (const bucket of BUCKETS) {
    all[bucket].forEach((task, index) => {
      if (task.text === want) hits.push({ bucket, index, task });
    });
  }
  return hits;
}

/**
 * 定位唯一一条。`ref` 是任务**内容**（整串）。
 *
 * 消歧手段有两个，按需组合：
 *   `--topic <名字>`  按主题收窄（同内容散落在不同主题时的快捷方式）
 *   `--pick <n>`      按编号选择（最通用；同内容且同主题时唯一可靠的手段）
 *
 * 报错时把候选项编号列出来，调用方（人或 agent）照着选即可——**绝不替调用方猜**。
 */
export function locateUnique(all, ref, { topic, pick } = {}) {
  const want = String(ref ?? '');

  // 空 ref 是**参数错误**而不是 NOT_FOUND：绝大多数时候是忘了传 --ref，
  // 而空串恰好会匹配上数据里 text 为空的坏条目——那等于随机改一条，必须挡在门外。
  if (!want) throw badInput('task 内容不能为空（用 --ref 指定要操作的任务文本）');

  const allHits = locateAll(all, want);
  const hits = topic ? allHits.filter((h) => h.task.topic === topic) : allHits;
  const shown = want.length > 40 ? want.slice(0, 40) + '…' : want;

  if (!hits.length) {
    if (allHits.length) {
      const topics = [...new Set(allHits.map((h) => h.task.topic))].join(', ');
      throw notFound(`task「${shown}」存在，但 topic 不是 ${topic}（实际 topic: ${topics}）`);
    }
    throw notFound(`task「${shown}」不存在（待办 / 已完成 / 冻结里都没有）`);
  }

  if (pick !== undefined && pick !== null) {
    const n = Number(pick);
    if (!Number.isInteger(n) || n < 0 || n >= hits.length) {
      throw badInput(`--pick 必须是 0..${hits.length - 1} 之间的整数，收到: ${pick}`);
    }
    return hits[n];
  }

  if (hits.length > 1) {
    const list = hits
      .map((h, i) => `  [${i}] ${h.bucket.padEnd(6)} ${h.task.topic.padEnd(5)} ${h.task.createdAt}`)
      .join('\n');
    throw conflict(
      `task「${shown}」命中 ${hits.length} 条，无法确定是哪一条。用 --pick <n> 选择：\n${list}` +
        (topic ? '' : `\n（也可先用 --topic <名字> 收窄）`),
      { candidates: hits.map((h, i) => ({ pick: i, bucket: h.bucket, topic: h.task.topic, createdAt: h.task.createdAt })) }
    );
  }
  return hits[0];
}

// ─── 写 ────────────────────────────────────────────────────────────
//
// 顺序纪律（契约 3）：**主数据先写，辅助数据后写**。
// 部分失败时抛出的错误里带上「哪一步失败、已经写成功了什么」——
// 调用方（人或 agent）需要知道当前处于什么状态才能决定下一步。

async function writeKey(key, value, groupId) {
  await kvSet({ key, value, ttl: 0, groupId: await resolveGroup(groupId) });
}

async function writeTasks(bucketKey, tasks, groupId) {
  await writeKey(bucketKey, JSON.stringify(tasks), groupId);
}

async function writeTopics(topics, groupId) {
  await writeKey(KEY.topics, JSON.stringify(topics), groupId);
}

// ─── 只读操作 ──────────────────────────────────────────────────────

export async function listTodos({ topic, status, groupId } = {}) {
  const all = await loadAll(groupId);
  const want = status && status !== 'all' ? status : null;

  // 形状恒定：三个桶的键永远都在，被 --status 排除的置 null。
  // 这样渲染器与调用方不必为「过滤时返回另一种形状」写分支——
  // 之前正是这个分支导致 `--status open` 什么都不打印。
  const pick = (b) => {
    if (want && want !== b) return null;
    return topic ? all[b].filter((t) => t.topic === topic) : all[b];
  };

  return {
    topic: topic || '',
    status: want || 'all',
    open: pick('open'),
    done: pick('done'),
    freeze: pick('freeze'),
    topics: all.topics,
  };
}

export async function getTodo(ref, { topic, pick, groupId } = {}) {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic, pick });
  return { ...hit.task, bucket: hit.bucket };
}

// ─── 变更操作 ──────────────────────────────────────────────────────

/** 新增任务到待办；topic 不在快捷列表时一并补上（契约 2） */
export async function addTodo({ topic, text, groupId }) {
  const t = String(topic || '').trim();
  const body = String(text || '').trim();
  if (!t) throw badInput('--topic 必填');
  if (!body) throw badInput('任务内容不能为空');

  const all = await loadAll(groupId);           // 契约 4：写前重读
  const task = {
    id: nextTaskId(all.open, all.freeze),       // 契约 1：扫 待办 + 冻结
    topic: t,
    text: body,
    createdAt: dartNow(),
    doneAt: '',
    note: '',
    frozenAt: '',
  };

  const open = [...all.open, task];
  const topicChanged = !all.topics.includes(t);

  // 主数据先写（契约 3）
  await writeTasks(KEY.open, open, groupId);
  if (topicChanged) {
    try {
      await writeTopics([...all.topics, t], groupId);
    } catch (e) {
      throw conflict(
        `任务已写入待办，但快捷 topic 未更新（${t}）: ${e.message}`,
        { task, partial: true, written: [KEY.open], failed: [KEY.topics] }
      );
    }
  }
  return { task, topicAdded: topicChanged, id: task.id };
}

/** 编辑任务：只改传入的字段（PATCH 语义），未传的保持原值。
 *  定位用 `ref`（当前内容）；`--text` 才是要改成的新内容。
 *  `--match-topic` 是用来**消歧**的定位条件，与要改的 `--topic` 是两回事——
 *  合并成一个会让「把 qus 改成 go」这种操作无从表达。 */
export async function updateTodo(ref, { topic, text, note, matchTopic, pick, groupId } = {}) {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic: matchTopic, pick });

  if (topic === undefined && text === undefined && note === undefined) {
    throw badInput('至少要给出一个要改的字段（--topic / --text / --note）');
  }

  const next = { ...hit.task };
  if (topic !== undefined) {
    const t = String(topic).trim();
    if (!t) throw badInput('--topic 不能为空');
    next.topic = t;
  }
  if (text !== undefined) {
    const s = String(text).trim();
    if (!s) throw badInput('--text 不能为空');
    next.text = s;
  }
  if (note !== undefined) next.note = String(note);

  const bucket = [...all[hit.bucket]];
  bucket[hit.index] = next;
  await writeTasks(KEY[hit.bucket], bucket, groupId);

  // 改了 topic 就顺带补快捷列表（与 add 同一条契约）
  let topicAdded = false;
  if (next.topic && !all.topics.includes(next.topic)) {
    await writeTopics([...all.topics, next.topic], groupId);
    topicAdded = true;
  }
  return { task: next, bucket: hit.bucket, topicAdded };
}

/** 删除任务。只移除**命中的那一条**（按 index），不按内容批量删。 */
export async function removeTodo(ref, { topic, pick, groupId } = {}) {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic, pick });

  const bucket = [...all[hit.bucket]];
  bucket.splice(hit.index, 1);
  await writeTasks(KEY[hit.bucket], bucket, groupId);
  return { removed: hit.task, bucket: hit.bucket };
}

/** 标记完成：待办 → 已完成，补 doneAt 与 note */
export async function doneTodo(ref, { result, topic, pick, groupId } = {}) {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic, pick });
  if (hit.bucket === 'done') throw conflict(`task「${hit.task.text}」已经是完成状态`);
  if (hit.bucket === 'freeze') throw conflict(`task「${hit.task.text}」处于冻结中，先解冻再完成`);

  const finished = {
    ...hit.task,
    doneAt: rfc3339Now(),
    note: result === undefined ? hit.task.note : String(result),
  };

  // 按 index 移除，再追加到 done —— 不能用 filter(text !== ref)，那会连带删掉同内容的其他条目
  const from = [...all[hit.bucket]];
  from.splice(hit.index, 1);
  const done = [...all.done, finished];

  // 顺序：先把任务从原桶移走，再追加到 done。
  // 反过来的话，中途失败会让同一条任务同时存在于两个桶里。
  await writeTasks(KEY[hit.bucket], from, groupId);
  await writeTasks(KEY.done, done, groupId);
  return { task: finished, from: hit.bucket, to: 'done' };
}

/** 冻结：→ 冻结（id 保留） */
export async function freezeTodo(ref, { topic, pick, groupId } = {}) {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic, pick });
  if (hit.bucket === 'freeze') throw conflict(`task「${hit.task.text}」已经处于冻结`);

  const frozen = { ...hit.task, frozenAt: dartNow() };
  const from = [...all[hit.bucket]];
  from.splice(hit.index, 1);

  await writeTasks(KEY[hit.bucket], from, groupId);
  await writeTasks(KEY.freeze, [...all.freeze, frozen], groupId);
  return { task: frozen, from: hit.bucket, to: 'freeze' };
}

/** 解冻：冻结 → 待办。id 与现有待办冲突时换新 id（契约 1 的下游） */
export async function unfreezeTodo(ref, { topic, pick, groupId } = {}) {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic, pick });
  if (hit.bucket !== 'freeze') throw conflict(`task「${hit.task.text}」不在冻结区（当前在 ${hit.bucket}）`);

  const clashes = all.open.some((t) => t.id === hit.task.id);
  const revived = {
    ...hit.task,
    id: clashes ? nextTaskId(all.open, all.freeze) : hit.task.id,
    frozenAt: '',
  };

  const from = [...all.freeze];
  from.splice(hit.index, 1);
  await writeTasks(KEY.freeze, from, groupId);
  await writeTasks(KEY.open, [...all.open, revived], groupId);
  return { task: revived, reIded: clashes, from: 'freeze', to: 'open' };
}

// ─── 快捷 topic ────────────────────────────────────────────────────
//
// 后端只把 topic 存成字符串数组，没有独立接口。它是「动作集合」而非 CRUD 资源：
// 没有单条的读/改语义，硬凑 get/update 只会得到语义别扭的命令。

export async function listTopics({ groupId } = {}) {
  const all = await loadAll(groupId);
  // 顺带统计每个 topic 的任务数，光有名字看不出用量
  const count = (arr) => arr.reduce((a, t) => ((a[t.topic] = (a[t.topic] || 0) + 1), a), {});
  const [o, d, f] = [count(all.open), count(all.done), count(all.freeze)];
  return all.topics.map((name) => ({
    name,
    open: o[name] || 0,
    done: d[name] || 0,
    freeze: f[name] || 0,
  }));
}

export async function addTopic(name, { groupId } = {}) {
  const t = String(name || '').trim();
  if (!t) throw badInput('topic 不能为空');
  const all = await loadAll(groupId);
  if (all.topics.includes(t)) return { name: t, added: false, topics: all.topics };
  const topics = [...all.topics, t];
  await writeTopics(topics, groupId);
  return { name: t, added: true, topics };
}

export async function removeTopic(name, { groupId } = {}) {
  const t = String(name || '').trim();
  const all = await loadAll(groupId);
  const topics = all.topics.filter((x) => x !== t);
  // 移出快捷列表不算错误（保持幂等）；但如果有任务还在用它，要如实告诉调用方
  const inUse =
    all.open.filter((x) => x.topic === t).length +
    all.freeze.filter((x) => x.topic === t).length;
  if (topics.length !== all.topics.length) await writeTopics(topics, groupId);
  return { name: t, removed: topics.length !== all.topics.length, inUse, topics };
}

// ─── 主题提示词（纯文本，不是 JSON）────────────────────────────────
//
// `todo:prompt:<topic>` 存该主题的上下文知识。agent 拉任务时一并读走，
// 不必把背景重复写进每条任务文本 —— 这是「让 AI 拿任务即拿上下文」的关键。

export async function getPrompt(topic, { groupId } = {}) {
  const t = String(topic || '').trim();
  if (!t) throw badInput('--topic 必填');
  const value = await readKey(PROMPT_PREFIX + t, normalizeGroupId(groupId));
  return { topic: t, prompt: value, hasPrompt: value.length > 0 };
}

export async function setPrompt(topic, text, { groupId } = {}) {
  const t = String(topic || '').trim();
  if (!t) throw badInput('--topic 必填');
  const body = String(text ?? '');
  if (!body.trim()) throw badInput('提示词内容不能为空');
  await writeKey(PROMPT_PREFIX + t, body, normalizeGroupId(groupId));
  return { topic: t, bytes: Buffer.byteLength(body, 'utf8') };
}

export async function removePrompt(topic, { groupId } = {}) {
  const t = String(topic || '').trim();
  if (!t) throw badInput('--topic 必填');
  const key = PROMPT_PREFIX + t;
  // kvDelete 直接走 kvapi，不会经过 readKey/writeKey 的 groupId 回落，
  // 所以这里必须自己解析一次——否则「删除」会打到默认组而非当前工作空间。
  const gid = await resolveGroup(groupId);
  const before = await readKey(key, gid);
  if (!before) return { topic: t, removed: false };
  await kvDelete(key, gid);
  return { topic: t, removed: true };
}

// ─── 冷归档 ────────────────────────────────────────────────────────
//
// 把已完成里较旧的条目移到 `todo:done:cold:YYYY-MM-DD`（按当天日期分片）。
// App 只写不查；这里保留读取能力，方便核对历史。

export async function archiveDone({ before, groupId } = {}) {
  const all = await loadAll(groupId);
  if (!all.done.length) return { moved: 0, coldKey: '', remaining: 0 };

  const cutoff = before ? new Date(String(before)) : new Date(Date.now() - 30 * 86400_000);
  if (Number.isNaN(cutoff.getTime())) throw badInput(`--before 不是合法日期: ${before}`);

  const isOld = (t) => {
    // doneAt 是 RFC3339（带偏移），老的 createdAt 风格也兼容
    const ts = Date.parse(t.doneAt || t.createdAt);
    return Number.isFinite(ts) && ts < cutoff.getTime();
  };
  const moved = all.done.filter(isOld);
  if (!moved.length) return { moved: 0, coldKey: '', remaining: all.done.length };

  const d = new Date();
  const coldKey = `${COLD_PREFIX}${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // 冷数据是追加语义：已有则合并，避免同日二次归档覆盖上一次
  const existingRaw = await readKey(coldKey, normalizeGroupId(groupId));
  const existing = parseTasks(existingRaw);
  await writeKey(coldKey, JSON.stringify([...existing, ...moved]), normalizeGroupId(groupId));

  const remaining = all.done.filter((t) => !isOld(t));
  await writeTasks(KEY.done, remaining, groupId);

  return { moved: moved.length, coldKey, remaining: remaining.length, total: existing.length + moved.length };
}

// 供 groupId 默认值的统一来源（service 内多处要用）
export async function currentGroupId() {
  const cfg = await loadConfig();
  return normalizeGroupId(cfg.groupId);
}
