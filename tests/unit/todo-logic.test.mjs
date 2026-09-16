// 清单核心逻辑的纯函数测试。
//
// 这里的两组断言都对应**在真实数据上真实发生过的错误**，不是假想的边界：
//
//  1. id 分配必须扫「待办 + 冻结」。只扫待办会在待办清空后从 1 重发，
//     与冻结任务撞车。
//  2. id 在 done 里**不唯一**。变更操作若按 `filter(t => t.id !== id)` 定位，
//     会一次删掉所有同 id 的条目——曾因此在真实数据上误删 7 条。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextTaskId,
  locateAll,
  locateUnique,
  dartNow,
  rfc3339Now,
  normalizeTask,
} from '../../src/modules/todo/service.js';

const T = (id, topic = 'x', createdAt = '2026-08-01T00:00:00.000000') => ({
  id,
  topic,
  text: `task-${id}-${topic}`,
  createdAt,
  doneAt: '',
  note: '',
  frozenAt: '',
});

// ─── 契约 1：id 分配扫 待办 + 冻结 ─────────────────────────────────

test('id 分配要扫冻结区，不能只看待办', () => {
  // 实测场景：todo:open 为空、todo:freeze 有 id 2/10/17/23/24/28
  const open = [];
  const freeze = [T(2), T(10), T(17), T(23), T(24), T(28)];
  assert.equal(nextTaskId(open, freeze), 29, '只看待办会算出 1，与冻结任务撞车');
});

test('id 分配取两侧最大值的 +1', () => {
  assert.equal(nextTaskId([T(5)], [T(3)]), 6);
  assert.equal(nextTaskId([T(3)], [T(9)]), 10);
  assert.equal(nextTaskId([], []), 1, '两侧都空才从 1 开始');
});

// ─── 契约：id 在 done 里不唯一 ────────────────────────────────────

const allWithDupes = {
  open: [],
  done: [T(29, 'qus', '2026-08-15T15:09:00.097123'), T(29, 'qus', '2026-08-22T10:40:12.469526'), T(29, 'fr', '2026-08-30T10:36:25.731238')],
  freeze: [],
};

test('locateAll 返回全部同 id 条目（含同桶重复）', () => {
  const hits = locateAll(allWithDupes, 29);
  assert.equal(hits.length, 3);
  assert.ok(hits.every((h) => h.bucket === 'done'));
  assert.deepEqual(
    hits.map((h) => h.index),
    [0, 1, 2]
  );
});

test('locateUnique 命中多条时拒绝猜，而不是取第一条', () => {
  assert.throws(() => locateUnique(allWithDupes, 29), (e) => {
    assert.equal(e.code, 'CONFLICT');
    assert.match(e.message, /命中 3 条/);
    assert.match(e.message, /--pick/);
    // 候选项要列出来，调用方才选得下去
    assert.match(e.message, /\[0\]/);
    assert.match(e.message, /\[2\]/);
    assert.equal(e.details.candidates.length, 3);
    return true;
  });
});

test('locateUnique --pick 按编号精确选中（同 topic 重复时唯一可靠的手段）', () => {
  // 前两条 topic 都是 qus，光靠 --topic 收敛不到一条
  assert.equal(locateUnique(allWithDupes, 29, { topic: 'qus', pick: 1 }).task.createdAt, '2026-08-22T10:40:12.469526');
  assert.equal(locateUnique(allWithDupes, 29, { pick: 0 }).task.createdAt, '2026-08-15T15:09:00.097123');
  assert.equal(locateUnique(allWithDupes, 29, { pick: 2 }).task.topic, 'fr');
});

test('locateUnique --topic 能收窄到唯一时不需要 --pick', () => {
  const hit = locateUnique(allWithDupes, 29, { topic: 'fr' });
  assert.equal(hit.index, 2);
});

test('locateUnique --pick 越界报错并给出合法范围', () => {
  assert.throws(() => locateUnique(allWithDupes, 29, { pick: 99 }), /--pick 必须是 0\.\.2/);
  assert.throws(() => locateUnique(allWithDupes, 29, { pick: -1 }), /--pick 必须是/);
});

test('locateUnique 不存在与 topic 不匹配是两种不同的错', () => {
  assert.throws(() => locateUnique(allWithDupes, 999), (e) => {
    assert.equal(e.code, 'NOT_FOUND');
    assert.match(e.message, /不存在/);
    return true;
  });
  assert.throws(() => locateUnique(allWithDupes, 29, { topic: 'nope' }), (e) => {
    assert.equal(e.code, 'NOT_FOUND');
    assert.match(e.message, /topic 不是 nope/);
    assert.match(e.message, /实际 topic: qus, fr/);
    return true;
  });
});

test('唯一命中时直接返回', () => {
  const all = { open: [T(1)], done: [], freeze: [] };
  assert.equal(locateUnique(all, 1).bucket, 'open');
});

// ─── 时间格式：沿用既有数据的两种约定 ─────────────────────────────

test('dartNow 是 Dart toIso8601String 风格（本地、无时区、微秒位）', () => {
  const s = dartNow(new Date(2026, 7, 14, 19, 4, 56, 28));
  assert.match(s, /^2026-08-14T19:04:56\.028000$/, '既有 createdAt 形如 2026-08-14T19:04:56.028788');
});

test('rfc3339Now 带本地偏移（既有 doneAt 就是这个形状）', () => {
  const s = rfc3339Now(new Date(2026, 7, 15, 14, 32, 53));
  assert.match(s, /^2026-08-15T14:32:53[+-]\d{2}:\d{2}$/, '既有 doneAt 形如 2026-08-15T14:32:53+08:00');
});

// ─── 脏数据容错 ───────────────────────────────────────────────────

test('normalizeTask 把缺字段补成空串而不是 undefined', () => {
  const t = normalizeTask({ id: '7', topic: 'go' });
  assert.deepEqual(t, {
    id: 7,
    topic: 'go',
    text: '',
    createdAt: '',
    doneAt: '',
    note: '',
    frozenAt: '',
  });
});
