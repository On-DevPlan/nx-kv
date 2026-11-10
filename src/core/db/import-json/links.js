// 边与独立目标阶段：forkOf/blockBy → task_links / task_deps；timegoals.json → goals。
// `blockBy` / `forkOf` 的 `"topicKey:id"` 两段都要重映射；解析失败的边记报告丢弃
// （一条脏边不能让整个迁移回滚）。
import { anyTimeMs } from '../time.js';
import { legacyDurationSec, parseTaskRef } from './data.js';

export function importLinksAndDeps(db, localtasksData, byLegacyKey, atMs, report) {
  const topics = (localtasksData && localtasksData.topics) || {};
  const resolve = (ref) => {
    const parsed = parseTaskRef(ref);
    if (!parsed) return null;
    const topic = byLegacyKey.get(parsed.legacyKey);
    if (!topic) return null;
    const row = db.get('SELECT id FROM tasks WHERE topic_id = :t AND seq = :s', { t: topic.id, s: parsed.seq });
    return row ? row.id : null;
  };

  for (const [legacyKey, t] of Object.entries(topics)) {
    const tasks = Array.isArray(t && t.tasks) ? t.tasks : [];
    for (const task of tasks) {
      const srcId = resolve(`${legacyKey}:${task.id}`);
      if (!srcId) continue;

      // 派生链：forkOf → task_links（方向恒为 新 → 旧，一个任务只有一个来源）
      if (task.forkOf) {
        const dstId = resolve(task.forkOf);
        if (!dstId) {
          report.warnings.push({ what: 'link', why: 'forkOf 解析失败，已丢弃', key: legacyKey, id: task.id, ref: task.forkOf });
        } else if (dstId !== srcId) {
          const type = ['comment', 'reopen', 'feedback'].includes(task.forkKind) ? task.forkKind : 'reopen';
          try {
            db.run(
              `INSERT INTO task_links (src_id, dst_id, type, note, created_at)
               VALUES (:src, :dst, :type, '', :at)`,
              { src: srcId, dst: dstId, type, at: anyTimeMs(task.createdAt, atMs) }
            );
            report.imported.links += 1;
          } catch (err) {
            report.warnings.push({ what: 'link', why: String(err && err.message), key: legacyKey, id: task.id });
          }
        }
      }

      // 编排依赖：blockBy[] → task_deps（一条脏边不能整体回滚）
      for (const ref of Array.isArray(task.blockBy) ? task.blockBy : []) {
        const depId = resolve(ref);
        if (!depId) {
          report.warnings.push({ what: 'dep', why: 'blockBy 解析失败，已丢弃', key: legacyKey, id: task.id, ref });
          continue;
        }
        if (depId === srcId) {
          report.warnings.push({ what: 'dep', why: 'blockBy 指向自己，已丢弃', key: legacyKey, id: task.id });
          continue;
        }
        db.run(
          `INSERT INTO task_deps (task_id, dep_id, created_at) VALUES (:t, :d, :at)
           ON CONFLICT(task_id, dep_id) DO NOTHING`,
          { t: srcId, d: depId, at: atMs }
        );
        report.imported.deps += 1;
      }
    }
  }
}

// timegoals.json：只保留任务级目标；队列级目标丢弃 + 报告（队列是容器，没有"交付"这件事）。
export function importStandaloneGoals(db, timegoalsData, byLegacyKey, report) {
  const goals = timegoalsData && timegoalsData.goals && typeof timegoalsData.goals === 'object'
    ? timegoalsData.goals
    : {};
  for (const [scope, g] of Object.entries(goals)) {
    if (!scope.startsWith('task:')) {
      report.discarded.push({ what: 'timegoal(queue-scope)', scope, count: 1, note: '只保留任务级目标' });
      continue;
    }
    const parsed = parseTaskRef(scope.slice('task:'.length));
    const topic = parsed ? byLegacyKey.get(parsed.legacyKey) : null;
    if (!topic) {
      report.warnings.push({ what: 'goal', why: '作用域里的队列对不上，已丢弃', scope });
      continue;
    }
    const taskRow = db.get('SELECT id, claimed_at, created_at FROM tasks WHERE topic_id = :t AND seq = :s', {
      t: topic.id,
      s: parsed.seq,
    });
    if (!taskRow) {
      report.warnings.push({ what: 'goal', why: '作用域里的任务对不上，已丢弃', scope });
      continue;
    }
    let durationSec = legacyDurationSec(g);
    const start = anyTimeMs(g.startedAt, NaN);
    const startMs = Number.isFinite(start) ? start : taskRow.claimed_at || taskRow.created_at;
    const deadlineRaw = anyTimeMs(g.deadline, NaN);
    if (durationSec <= 0 && Number.isFinite(deadlineRaw) && deadlineRaw > startMs) {
      durationSec = Math.trunc((deadlineRaw - startMs) / 1000);
    }
    const deadline = Number.isFinite(deadlineRaw) ? deadlineRaw : startMs + durationSec * 1000;
    if (durationSec <= 0 || deadline <= startMs) {
      report.warnings.push({ what: 'goal', why: '时长或截止时刻非法，已跳过', scope });
      continue;
    }
    // 与内嵌 timegoal 撞同一条任务时保留先到的一条，不能整库回滚
    const res = db.run(
      `INSERT INTO goals (task_id, duration_sec, started_at, deadline, prompt, state, version,
                          deleted_at, created_at, updated_at)
       VALUES (:task, :dur, :start, :deadline, :prompt, :state, 0, :deleted, :at, :updated)
       ON CONFLICT(task_id) WHERE deleted_at IS NULL DO NOTHING`,
      {
        task: taskRow.id,
        dur: durationSec,
        start: startMs,
        deadline,
        prompt: String(g.prompt || ''),
        state: String(g.state || ''),
        deleted: g.archivedAt ? anyTimeMs(g.archivedAt, null) : null,
        at: startMs,
        updated: anyTimeMs(g.updatedAt, startMs),
      }
    );
    let goalId = Number(res.lastInsertRowid) || 0;
    if (Number(res.changes) > 0) {
      report.imported.goals += 1;
    } else {
      const existing = db.get('SELECT id FROM goals WHERE task_id = :t AND deleted_at IS NULL', { t: taskRow.id });
      if (!existing) continue;
      goalId = Number(existing.id);
    }
    for (const log of Array.isArray(g.log) ? g.log : []) {
      const at = anyTimeMs(log.at, NaN);
      if (!Number.isFinite(at)) continue;
      db.run(
        `INSERT INTO goal_checks (goal_id, at, elapsed_sec, remaining_sec, overtime_sec, reached, summary)
         VALUES (:g, :at, :elapsed, :remaining, :overtime, :reached, :summary)`,
        {
          g: goalId,
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
}
