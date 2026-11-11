// topics / tasks 阶段：legacy localtasks.json → topics + topic_presence + tasks（含内嵌 timegoal → goals）。
import { topicKeyOf, GLOBAL_TOPIC_KEY } from '../../topic-key.js';
import { anyTimeMs } from '../time.js';
import {
  jsonText,
  legacyDurationSec,
  mapLegacyStatus,
  numberOrNull,
  stringOrNull,
  MAX_BODY,
  SENTINEL_REPO_KEY,
} from './data.js';
import type { ImportReport } from './data.js';
import type { DbApi } from '../driver.js';

/** 新 key 对应的 topic 行（导入期内累积 seq 判重与 next_seq 上界）。 */
export interface TopicState {
  id: any;
  taken: Set<number>;
  maxSeq: number;
}

/** legacy topic key → 库里 topic 行（后续阶段解析 `"topicKey:id"` 用）。 */
export interface LegacyTopicRef {
  id: any;
  legacyKey: string;
}

/** 本阶段的结果（links / goals 阶段要用两张映射）。 */
export interface ImportTopicsResult {
  byLegacyKey: Map<string, LegacyTopicRef>;
  byNewKey: Map<string, TopicState>;
}

/** insertTask 的入参。 */
interface InsertTaskParams {
  row: TopicState;
  legacyKey: string;
  task: any;
  atMs: number;
  report: ImportReport;
}

/** insertGoal 的入参。 */
interface InsertGoalParams {
  topicId: any;
  seq: number;
  legacyKey: string;
  timegoal: any;
  claimedAt: number | null;
  createdAt: number;
  report: ImportReport;
}

export function importTopicsAndTasks(
  db: DbApi,
  localtasksData: any,
  atMs: number,
  report: ImportReport
): ImportTopicsResult {
  const topics = localtasksData && localtasksData.topics && typeof localtasksData.topics === 'object'
    ? localtasksData.topics
    : {};

  /** legacy topic key → { id, legacyKey } */
  const byLegacyKey = new Map<string, LegacyTopicRef>();
  /** 新 key → topic 行（碰撞时合并到同一行） */
  const byNewKey = new Map<string, TopicState>();

  for (const [legacyKey, t] of Object.entries(topics)) {
    const topic: any = t && typeof t === 'object' ? t : {};
    // cwd：优先 .cwd，其次 cwds[0]（schema 一条队列一个 cwd，其余丢弃 + 报告）
    let cwd = String(topic.cwd || '').trim();
    if (!cwd && Array.isArray(topic.cwds) && topic.cwds.length) cwd = String(topic.cwds[0] || '').trim();
    if (Array.isArray(topic.cwds) && topic.cwds.length > 1) {
      report.discarded.push({
        what: 'topic.cwds[1..]',
        key: legacyKey,
        count: topic.cwds.length - 1,
        note: 'schema 一条队列一个 cwd',
      });
    }
    const hasTasks = Array.isArray(topic.tasks) && topic.tasks.length > 0;
    if (!cwd && legacyKey !== GLOBAL_TOPIC_KEY && hasTasks) {
      // 异常行（v1/v2 迁移来的、没 cwd 的旧等待点）：挂哨兵 + cwd='' + 报告
      report.warnings.push({
        what: 'topic',
        why: 'cwd 为空且不是全局池（旧 slot/session 迁移残留），cwd 落空串',
        legacyKey,
      });
    }
    const key = topicKeyOf(cwd, '');
    let row = byNewKey.get(key);
    if (row) {
      // 两条 legacy 队列算出同一个 key = 同一个 (cwd, group)。按新口径它们本就是
      // 一条队列 → 合并（旧口径下同名目录共用一条队列正是被修掉的 bug）。
      report.warnings.push({ what: 'topic', why: '与另一条 legacy 队列同 (cwd, group)，已合并', legacyKey, key });
    } else {
      const ext: Record<string, any> = { ext_legacy_key: legacyKey };
      if (topic.summary) ext.ext_last_summary = String(topic.summary);
      if (topic.manual) ext.ext_manual = 1;
      if (legacyKey === GLOBAL_TOPIC_KEY) ext.ext_global = 1;

      const createdAt = anyTimeMs(topic.createdAt, atMs);
      const res = db.run(
        `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                             deleted_at, created_at, updated_at)
         VALUES (:key, :repo, :cwd, NULL, :name, 1, :ext, :state, :version, NULL, :created, :updated)`,
        {
          key,
          repo: SENTINEL_REPO_KEY,
          cwd,
          name: String(topic.name || ''),
          ext: jsonText(ext),
          state: String(topic.state || ''),
          version: Number(topic.workflowRevision) || 0,
          created: createdAt,
          updated: anyTimeMs(topic.updatedAt, createdAt),
        }
      );
      row = { id: res.lastInsertRowid, taken: new Set<number>(), maxSeq: 0 };
      byNewKey.set(key, row);
      report.imported.topics += 1;
    }
    byLegacyKey.set(legacyKey, { id: row.id, legacyKey });

    // ── 等待态 → topic_presence（瞬态数据独立成表，见 schema 的 P0-4 说明）──
    const waiting = topic.waiting === true || topic.waiting === 1;
    const untilMs = anyTimeMs(
      topic.waitingUntilMs !== undefined ? topic.waitingUntilMs : topic.waitingUntil,
      NaN
    );
    const cancelRequested = topic.cancelRequested === true || topic.cancelRequested === 1;
    if (waiting || cancelRequested || !Number.isNaN(untilMs)) {
      db.run(
        `INSERT INTO topic_presence (topic_id, waiting, since_ms, until_ms, cancel_requested, updated_at)
         VALUES (:id, :waiting, :since, :until, :cancel, :at)
         ON CONFLICT(topic_id) DO UPDATE SET waiting = excluded.waiting, since_ms = excluded.since_ms,
           until_ms = excluded.until_ms, cancel_requested = excluded.cancel_requested,
           updated_at = excluded.updated_at`,
        {
          id: row.id,
          waiting: waiting ? 1 : 0,
          since: numberOrNull(anyTimeMs(topic.waitingSince, NaN)),
          until: numberOrNull(untilMs),
          cancel: cancelRequested ? 1 : 0,
          at: anyTimeMs(topic.updatedAt, atMs),
        }
      );
      report.imported.presence += 1;
    }

    // ── tasks ──
    for (const task of Array.isArray(topic.tasks) ? topic.tasks : []) {
      insertTask(db, { row, legacyKey, task, atMs, report });
    }

    // 其余 legacy 字段：审计已裁定丢弃，如实记账
    if (Array.isArray(topic.subs) && topic.subs.length) {
      report.discarded.push({ what: 'topic.subs', key: legacyKey, count: topic.subs.length, note: '代码 0 引用' });
    }
    if (topic.submitSummary) {
      report.discarded.push({ what: 'topic.submitSummary', key: legacyKey, count: 1, note: '队列是开发侧概念，不进库' });
    }
  }

  // next_seq = max(seq)+1（只增不减；编号复用会让历史引用指向另一条任务）
  for (const [, row] of byNewKey) {
    db.run('UPDATE topics SET next_seq = :n WHERE id = :id', { n: (row.maxSeq || 0) + 1, id: row.id });
  }

  return { byLegacyKey, byNewKey };
}

function insertTask(db: DbApi, { row, legacyKey, task, atMs, report }: InsertTaskParams): void {
  const mapped = mapLegacyStatus(task);
  report.distribution[mapped.status] = (report.distribution[mapped.status] || 0) + 1;
  if (mapped.unknown) {
    report.warnings.push({
      what: 'task.status',
      why: `未知状态 ${JSON.stringify(task && task.status)} → 当 pending`,
      key: legacyKey,
      id: task && task.id,
    });
  }
  if (mapped.archived) {
    report.warnings.push({ what: 'task.status', why: 'archived（本机实测 0 条，按判据第 4 步处理）', key: legacyKey, id: task && task.id });
  }

  const seq = Math.trunc(Number(task && task.id) || 0);
  if (!seq) {
    report.warnings.push({ what: 'task', why: 'id 缺失/非法，无法保持编号', key: legacyKey, id: task && task.id });
    // 编号是身份的一部分：丢一条 / 改一个号都会让「id N 当初指的是哪条」失效。
    // 数据损坏必须整体拒绝（事务回滚、JSON 不动），不能悄悄补一条。
    throw new Error(`legacy 数据损坏：队列 ${legacyKey} 里有任务缺 id（${JSON.stringify(task && task.id)}）`);
  }
  if (row.taken.has(seq)) {
    throw new Error(
      `legacy 数据损坏：队列 ${legacyKey} 里 id ${seq} 重复（tasks.seq 必须与源 id 一一对应）`
    );
  }
  row.taken.add(seq);
  if (seq > row.maxSeq) row.maxSeq = seq;

  const rawBody = String((task && task.text) ?? '');
  let body = rawBody;
  const ext: Record<string, any> = {};
  if (body.length > MAX_BODY) {
    body = body.slice(0, MAX_BODY);
    ext.ext_body_truncated = 1;
    report.warnings.push({ what: 'task.body', why: `正文超长已截断（${rawBody.length} > ${MAX_BODY}）`, key: legacyKey, id: seq });
  }

  // 审计裁定不建列 → 存 ext 或直接丢弃（都要记账，避免"静默没了"）
  if (task.pickupSec !== undefined) ext.ext_pickup_sec = Number(task.pickupSec) || 0;
  if (task.trashIndex !== undefined) ext.ext_trash_index = Number(task.trashIndex) || 0;
  if (task.ready !== undefined) ext.ext_ready = task.ready ? 1 : 0;
  if (mapped.archived) ext.ext_archived = 1;
  if (task.archivedAt) ext.ext_archived_at = stringOrNull(task.archivedAt);
  if (task.archivedReason) ext.ext_archived_reason = String(task.archivedReason);
  if (task.supersededBy !== undefined && task.supersededBy !== '') ext.ext_superseded_by = task.supersededBy;
  // history[] 整体丢弃（旧"同一条任务内的编辑记录"这个概念随派生模型一起消失）；
  // 非空时存 ext 取证，本机实测 1 条且为 []。
  if (Array.isArray(task.history) && task.history.length) {
    ext.ext_legacy_history = task.history;
    report.discarded.push({ what: 'task.history', key: legacyKey, id: seq, count: task.history.length });
  }
  if (task.remote !== undefined) report.discarded.push({ what: 'task.remote', key: legacyKey, id: seq, count: 1 });
  if (task.claimedBy !== undefined || task.claimedFrom !== undefined || task.claimedByName !== undefined) {
    report.discarded.push({ what: 'task.claimedBy/From/ByName', key: legacyKey, id: seq, count: 1 });
  }
  if (task.migratedTo !== undefined && task.migratedTo !== null && task.migratedTo !== '') {
    // 迁出墓碑：丢了它，云端那条已搬走的任务会被当成「待领取」复活。
    // 旧形状可能是字符串（"elsewhere"），新视图只认对象 → 统一包成对象。
    const m = task.migratedTo;
    ext.ext_migrated_to =
      m && typeof m === 'object'
        ? m
        : { side: 'cloud', topic: String(m), targetId: 0, at: '' };
    if (!m || typeof m !== 'object') {
      report.warnings.push({ what: 'task.migratedTo', why: '旧字符串形状 → 已包装成对象保留', key: legacyKey, id: seq });
    }
  }

  const createdAt = anyTimeMs(task.createdAt, atMs);
  const updatedAt = anyTimeMs(task.updatedAt, createdAt);
  let claimedAt: number | null = numberOrNull(anyTimeMs(task.consumedAt, NaN));
  // 新词直通行可能缺 consumedAt（领取时刻没落 JSON）→ 用创建时刻兜底：
  // 「有 claimed 词却没有领取时刻」比「补一个近似时刻」更糟（verify 的不变量会挂）。
  if (mapped.status === 'claimed' && claimedAt === null) claimedAt = numberOrNull(createdAt);

  let doneAt: number | null = null;
  let feedback = '';
  let feedbackAt: number | null = null;
  if (mapped.status === 'done') {
    // completedAt 在本机全为空（7 条是空串键）→ 回落到 updatedAt
    doneAt = numberOrNull(anyTimeMs(task.completedAt, NaN));
    if (doneAt === null) doneAt = updatedAt;
    feedback = String(task.roundSummary ?? '');
    feedbackAt = doneAt;
  } else if (mapped.hasSummary) {
    // 非 done 行却有非空 roundSummary：不能塞进 feedback（那是 done 的语义），
    // 但也不能丢 → 存 ext 取证。
    ext.ext_legacy_round_summary = String(task.roundSummary);
    report.warnings.push({ what: 'task.roundSummary', why: `状态 ${mapped.status} 但有非空 roundSummary，已存 ext`, key: legacyKey, id: seq });
  }

  const round = (Number(task.reopenCount) || 0) + 1;
  if (task.reopenCount) report.discarded.push({ what: 'task.reopenCount', key: legacyKey, id: seq, count: 1, note: '→ round = reopenCount+1' });

  db.run(
    `INSERT INTO tasks (topic_id, seq, type, status, version, body, ext, feedback, feedback_at,
                        from_src, blocks_following, claimed_at, done_at, round, deleted_at,
                        created_at, updated_at)
     VALUES (:topic, :seq, '', :status, 0, :body, :ext, :feedback, :feedbackAt,
             :from, :blocks, :claimedAt, :doneAt, :round, :deletedAt, :createdAt, :updatedAt)`,
    {
      topic: row.id,
      seq,
      status: mapped.status,
      body,
      ext: jsonText(ext),
      feedback,
      feedbackAt,
      from: String(task.from || ''),
      blocks: task.blocksFollowing ? 1 : 0,
      claimedAt,
      doneAt,
      round,
      // 软删与状态正交：deletedAt 非空就写 deleted_at，状态照上面的判据走
      deletedAt: numberOrNull(anyTimeMs(task.deletedAt, NaN)),
      createdAt,
      updatedAt,
    }
  );
  report.imported.tasks += 1;

  // 内嵌 timegoal → goals（本机 7 条键存在但值全为 null，实际 0 条）
  if (task.timegoal && typeof task.timegoal === 'object') {
    insertGoal(db, { topicId: row.id, seq, legacyKey, timegoal: task.timegoal, claimedAt, createdAt, report });
    report.discarded.push({ what: 'task.timegoal', key: legacyKey, id: seq, count: 1, note: '已迁入 goals' });
  } else if (task.timegoal === null) {
    report.discarded.push({ what: 'task.timegoal', key: legacyKey, id: seq, count: 1, note: '值为 null，无目标可迁' });
  }
}

function insertGoal(
  db: DbApi,
  { topicId, seq, legacyKey, timegoal, claimedAt, createdAt, report }: InsertGoalParams
): void {
  const taskRow = db.get('SELECT id FROM tasks WHERE topic_id = :t AND seq = :s', { t: topicId, s: seq });
  if (!taskRow) return;
  let durationSec = legacyDurationSec(timegoal);
  const startedAt = anyTimeMs(timegoal.startedAt, NaN);
  const start = Number.isFinite(startedAt) ? startedAt : claimedAt || createdAt;
  const deadline = anyTimeMs(timegoal.deadline, NaN);
  // 只有「起止时刻」没有时长时，用差值补出时长（旧数据常见形状）
  if (durationSec <= 0 && Number.isFinite(deadline) && deadline > start) {
    durationSec = Math.trunc((deadline - start) / 1000);
  }
  const end = Number.isFinite(deadline) ? deadline : start + durationSec * 1000;
  // CHECK (duration_sec > 0) / CHECK (deadline > started_at)：不满足就不插，
  // 记报告（脏数据不能让整个迁移回滚）
  if (durationSec <= 0 || end <= start) {
    report.warnings.push({ what: 'goal', why: '时长或截止时刻非法，已跳过', key: legacyKey, id: seq });
    return;
  }
  // 同一条任务最多一个未删目标：内嵌 timegoal 与 standalone timegoals.json 可能
  // 指向同一任务，裸 INSERT 会撞 ux_goals_active → 整库回滚。冲突时保留先到的一条。
  const res = db.run(
    `INSERT INTO goals (task_id, duration_sec, started_at, deadline, prompt, state, version,
                        deleted_at, created_at, updated_at)
     VALUES (:task, :dur, :start, :deadline, :prompt, '', 0, NULL, :at, :at)
     ON CONFLICT(task_id) WHERE deleted_at IS NULL DO NOTHING`,
    {
      task: taskRow.id,
      dur: durationSec,
      start,
      deadline: end,
      prompt: String(timegoal.prompt || ''),
      at: start,
    }
  );
  const goalRow = db.get('SELECT id FROM goals WHERE task_id = :t AND deleted_at IS NULL', { t: taskRow.id });
  if (!goalRow) return;
  if (Number(res.changes) > 0) report.imported.goals += 1;

  for (const log of Array.isArray(timegoal.log) ? timegoal.log : []) {
    const at = anyTimeMs(log.at, NaN);
    if (!Number.isFinite(at)) continue;
    db.run(
      `INSERT INTO goal_checks (goal_id, at, elapsed_sec, remaining_sec, overtime_sec, reached, summary)
       VALUES (:g, :at, :elapsed, :remaining, :overtime, :reached, :summary)`,
      {
        g: goalRow.id,
        at,
        elapsed: Math.trunc(Number(log.elapsedSec) || 0),
        remaining: Math.trunc(Number(log.remainingSec) || 0),
        overtime: Math.trunc(Number(log.overtimeSec) || 0),
        reached: log.reached ? 1 : 0,
        summary: String(log.summary || ''),
      }
    );
    report.imported.goalChecks += 1;
  }
}
