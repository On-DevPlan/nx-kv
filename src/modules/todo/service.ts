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
//    详见 ./locate.js。
//
// 分层：key/时间/模型/读写原语在 ./store.js，按内容定位在 ./locate.js，
// 附件标注与追加在 ./attachments.js；本文件保留全部对外 API（re-export + 变更操作），
// import 路径不变。
import { kvDelete } from '../../core/kvapi.js';
import { normalizeGroupId } from '../../core/config.js';
import { badInput, notFound, conflict } from '../../core/errors.js';
import {
  KEY,
  PROMPT_PREFIX,
  COLD_PREFIX,
  pad,
  dartNow,
  rfc3339Now,
  loadAll,
  nextTaskId,
  parseTasks,
  readKey,
  resolveGroup,
  writeKey,
  writeTasks,
  writeTopics,
  type TodoTask,
} from './store.js';
import { locateUnique, type LocateOptions } from './locate.js';
import { annotateAttachments, attachOf, type SyncInfo } from './attachments.js';

export {
  KEY,
  PROMPT_PREFIX,
  COLD_PREFIX,
  dartNow,
  rfc3339Now,
  normalizeTask,
  loadAll,
  nextTaskId,
  currentGroupId,
} from './store.js';
export { locateAll, locateUnique } from './locate.js';
export { listTaskAttachments, attachToTask } from './attachments.js';

/** 各操作共用的 groupId / 消歧定位参数 */
export interface TodoOpOptions extends LocateOptions {
  groupId?: unknown;
}

// ─── 只读操作 ──────────────────────────────────────────────────────

export interface ListTodosOptions extends TodoOpOptions {
  status?: unknown;
}

export async function listTodos({ topic, status, groupId }: ListTodosOptions = {}): Promise<{
  topic: string;
  status: string;
  open: any[] | null | undefined;
  done: any[] | null | undefined;
  freeze: any[] | null | undefined;
  topics: string[];
  attachmentsSync?: SyncInfo;
}> {
  const all = await loadAll(groupId);
  const want: string | null = (status && status !== 'all' ? status : null) as string | null;

  // 形状恒定：三个桶的键永远都在，被 --status 排除的置 null。
  // 这样渲染器与调用方不必为「过滤时返回另一种形状」写分支——
  // 之前正是这个分支导致 `--status open` 什么都不打印。
  const pick = (b: 'open' | 'done' | 'freeze'): TodoTask[] | null => {
    if (want && want !== b) return null;
    return topic ? all[b].filter((t) => t.topic === topic) : all[b];
  };

  const open = pick('open');
  const done = pick('done');
  const freeze = pick('freeze');
  const { byTask, sync } = await annotateAttachments(
    [...(open || []), ...(done || []), ...(freeze || [])],
    await resolveGroup(groupId)
  );

  return {
    topic: topic || '',
    status: want || 'all',
    open: attachOf(byTask, open),
    done: attachOf(byTask, done),
    freeze: attachOf(byTask, freeze),
    topics: all.topics,
    // 只在真的同步过时才出现：默认（未开启自动下载）载荷与改造前逐字节一致
    ...(sync ? { attachmentsSync: sync } : {}),
  };
}

export async function getTodo(ref: unknown, { topic, pick, groupId }: TodoOpOptions = {}): Promise<Record<string, any>> {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic, pick });
  const { byTask, sync } = await annotateAttachments([hit.task], await resolveGroup(groupId));
  const attachments = byTask.get(hit.task) || [];
  return {
    ...hit.task,
    bucket: hit.bucket,
    ...(attachments.length ? { attachments } : {}),
    ...(sync ? { attachmentsSync: sync } : {}),
  };
}

// ─── 变更操作 ──────────────────────────────────────────────────────
//
// 顺序纪律（契约 3）：**主数据先写，辅助数据后写**。
// 部分失败时抛出的错误里带上「哪一步失败、已经写成功了什么」——
// 调用方（人或 agent）需要知道当前处于什么状态才能决定下一步。

export interface AddTodoOptions {
  topic?: unknown;
  text?: unknown;
  groupId?: unknown;
  from?: unknown;
}

/** 新增任务到待办；topic 不在快捷列表时一并补上（契约 2） */
export async function addTodo({ topic, text, groupId, from = '' }: AddTodoOptions = {}): Promise<{
  task: any;
  topicAdded: boolean;
  id: number;
}> {
  const t = String(topic || '').trim();
  const body = String(text || '').trim();
  if (!t) throw badInput('--topic 必填');
  if (!body) throw badInput('任务内容不能为空');

  const all = await loadAll(groupId);           // 契约 4：写前重读
  const task: any = {
    id: nextTaskId(all.open, all.freeze),       // 契约 1：扫 待办 + 冻结
    topic: t,
    text: body,
    createdAt: dartNow(),
    doneAt: '',
    note: '',
    frozenAt: '',
    ...(from ? { from: String(from) } : {}),
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
        `任务已写入待办，但快捷 topic 未更新（${t}）: ${(e as Error).message}`,
        { task, partial: true, written: [KEY.open], failed: [KEY.topics] }
      );
    }
  }
  return { task, topicAdded: topicChanged, id: task.id };
}

export interface UpdateTodoOptions extends TodoOpOptions {
  text?: unknown;
  note?: unknown;
  matchTopic?: unknown;
}

/** 编辑任务：只改传入的字段（PATCH 语义），未传的保持原值。
 *  定位用 `ref`（当前内容）；`--text` 才是要改成的新内容。
 *  `--match-topic` 是用来**消歧**的定位条件，与要改的 `--topic` 是两回事——
 *  合并成一个会让「把 qus 改成 go」这种操作无从表达。 */
export async function updateTodo(ref: unknown, { topic, text, note, matchTopic, pick, groupId }: UpdateTodoOptions = {}): Promise<{
  task: TodoTask;
  bucket: string;
  topicAdded: boolean;
}> {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic: matchTopic as string | undefined, pick });

  if (topic === undefined && text === undefined && note === undefined) {
    throw badInput('至少要给出一个要改的字段（--topic / --text / --note）');
  }

  const next: TodoTask = { ...hit.task };
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
export async function removeTodo(ref: unknown, { topic, pick, groupId }: TodoOpOptions = {}): Promise<{
  removed: TodoTask;
  bucket: string;
}> {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic, pick });

  const bucket = [...all[hit.bucket]];
  bucket.splice(hit.index, 1);
  await writeTasks(KEY[hit.bucket], bucket, groupId);
  return { removed: hit.task, bucket: hit.bucket };
}

export interface RemoveOpenByIdOptions {
  groupId?: unknown;
}

/** 按 id 精确删除**待办**里的一条（撤销迁移专用：同内容 ×N 时按文本删会误伤）。
 *  与 removeTodo 的差别就在定位方式：这个按 id，只允许命中待办桶。 */
export async function removeOpenById(id: unknown, { groupId }: RemoveOpenByIdOptions = {}): Promise<{ removed: TodoTask }> {
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少任务编号 id');
  const all = await loadAll(groupId);
  const index = all.open.findIndex((x) => Number(x.id) === want);
  if (index < 0) {
    throw notFound(`待办里没有 #${want}（可能已被删除或完成）`);
  }
  const removed = all.open[index] as TodoTask;
  const open = [...all.open];
  open.splice(index, 1);
  await writeTasks(KEY.open, open, groupId);
  return { removed };
}

export interface DoneTodoOptions extends TodoOpOptions {
  result?: unknown;
}

/** 标记完成：待办 → 已完成，补 doneAt 与 note */
export async function doneTodo(ref: unknown, { result, topic, pick, groupId }: DoneTodoOptions = {}): Promise<{
  task: TodoTask;
  from: string;
  to: 'done';
}> {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic, pick });
  if (hit.bucket === 'done') throw conflict(`task「${hit.task.text}」已经是完成状态`);
  if (hit.bucket === 'freeze') throw conflict(`task「${hit.task.text}」处于冻结中，先解冻再完成`);

  const finished: TodoTask = {
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
export async function freezeTodo(ref: unknown, { topic, pick, groupId }: TodoOpOptions = {}): Promise<{
  task: TodoTask;
  from: string;
  to: 'freeze';
}> {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic, pick });
  if (hit.bucket === 'freeze') throw conflict(`task「${hit.task.text}」已经处于冻结`);

  const frozen: TodoTask = { ...hit.task, frozenAt: dartNow() };
  const from = [...all[hit.bucket]];
  from.splice(hit.index, 1);

  await writeTasks(KEY[hit.bucket], from, groupId);
  await writeTasks(KEY.freeze, [...all.freeze, frozen], groupId);
  return { task: frozen, from: hit.bucket, to: 'freeze' };
}

/** 解冻：冻结 → 待办。id 与现有待办冲突时换新 id（契约 1 的下游） */
export async function unfreezeTodo(ref: unknown, { topic, pick, groupId }: TodoOpOptions = {}): Promise<{
  task: TodoTask;
  reIded: boolean;
  from: 'freeze';
  to: 'open';
}> {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic, pick });
  if (hit.bucket !== 'freeze') throw conflict(`task「${hit.task.text}」不在冻结区（当前在 ${hit.bucket}）`);

  const clashes = all.open.some((t) => t.id === hit.task.id);
  const revived: TodoTask = {
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

export async function listTopics({ groupId }: { groupId?: unknown } = {}): Promise<
  { name: string; open: number; done: number; freeze: number }[]
> {
  const all = await loadAll(groupId);
  // 顺带统计每个 topic 的任务数，光有名字看不出用量
  const count = (arr: TodoTask[]): Record<string, number> =>
    arr.reduce((a: Record<string, number>, t) => ((a[t.topic] = (a[t.topic] || 0) + 1), a), {});
  const [o, d, f] = [count(all.open), count(all.done), count(all.freeze)];
  return all.topics.map((name) => ({
    name,
    open: o[name] || 0,
    done: d[name] || 0,
    freeze: f[name] || 0,
  }));
}

export async function addTopic(name: unknown, { groupId }: { groupId?: unknown } = {}): Promise<{
  name: string;
  added: boolean;
  topics: string[];
}> {
  const t = String(name || '').trim();
  if (!t) throw badInput('topic 不能为空');
  const all = await loadAll(groupId);
  if (all.topics.includes(t)) return { name: t, added: false, topics: all.topics };
  const topics = [...all.topics, t];
  await writeTopics(topics, groupId);
  return { name: t, added: true, topics };
}

export async function removeTopic(name: unknown, { groupId }: { groupId?: unknown } = {}): Promise<{
  name: string;
  removed: boolean;
  inUse: number;
  topics: string[];
}> {
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

export async function getPrompt(topic: unknown, { groupId }: { groupId?: unknown } = {}): Promise<{
  topic: string;
  prompt: string;
  hasPrompt: boolean;
}> {
  const t = String(topic || '').trim();
  if (!t) throw badInput('--topic 必填');
  const value = await readKey(PROMPT_PREFIX + t, normalizeGroupId(groupId));
  return { topic: t, prompt: value, hasPrompt: value.length > 0 };
}

export async function setPrompt(topic: unknown, text: unknown, { groupId }: { groupId?: unknown } = {}): Promise<{
  topic: string;
  bytes: number;
}> {
  const t = String(topic || '').trim();
  if (!t) throw badInput('--topic 必填');
  const body = String(text ?? '');
  if (!body.trim()) throw badInput('提示词内容不能为空');
  await writeKey(PROMPT_PREFIX + t, body, normalizeGroupId(groupId));
  return { topic: t, bytes: Buffer.byteLength(body, 'utf8') };
}

export async function removePrompt(topic: unknown, { groupId }: { groupId?: unknown } = {}): Promise<{
  topic: string;
  removed: boolean;
}> {
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

export interface ArchiveDoneOptions {
  before?: unknown;
  groupId?: unknown;
}

// ─── 冷归档 ────────────────────────────────────────────────────────
//
// 把已完成里较旧的条目移到 `todo:done:cold:YYYY-MM-DD`（按当天日期分片）。
// App 只写不查；这里保留读取能力，方便核对历史。

export async function archiveDone({ before, groupId }: ArchiveDoneOptions = {}): Promise<{
  moved: number;
  coldKey: string;
  remaining: number;
  total?: number;
}> {
  const all = await loadAll(groupId);
  if (!all.done.length) return { moved: 0, coldKey: '', remaining: 0 };

  const cutoff = before ? new Date(String(before)) : new Date(Date.now() - 30 * 86400_000);
  if (Number.isNaN(cutoff.getTime())) throw badInput(`--before 不是合法日期: ${before}`);

  const isOld = (t: TodoTask): boolean => {
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
