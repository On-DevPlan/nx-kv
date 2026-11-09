// 进程面板编号（#127）：用户口径的「楼数」= 任务编号 #xxx——#122 曾按重开轮次
// （round）渲染「N楼」，验收反馈「我说的楼数是指的#xxx这个」推翻。数据层的
// round 口径（= reopenCount + 1，任务链上第几轮）不变、多处消费照旧；变的只是
// 面板：卡片右侧显示 #id，搜索「N / #N」等值匹配编号 + 标题模糊。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTask } from '../../src/modules/localtask/task-view.js';
import { taskToProgress } from '../../src/web/frontend/modules/md/md-parse.js';

test('normalizeTask：round = reopenCount + 1（数据口径不变，#127 只改 UI 语义）', () => {
  assert.equal(normalizeTask({ id: 1, status: 'pending', text: '# 根' }).round, 1);
  assert.equal(normalizeTask({ id: 2, status: 'done', text: '# 第三轮', reopenCount: 2 }).round, 3);
  assert.equal(normalizeTask({ id: 3, status: 'pending', text: '# 旧数据', reopenCount: 0 }).round, 1);
  // 脏数据（负数）不下探：round 最少 1
  assert.equal(normalizeTask({ id: 4, status: 'pending', text: '# 脏', reopenCount: -5 }).round, 1);
});

test('taskToProgress：id 透传（五种分支都带）；不再带 round（#127 起 UI 用 #id）', () => {
  const base = { id: 9, text: '# 标题' };
  assert.equal(taskToProgress({ ...base, status: 'pending' }).id, 9);
  assert.equal(taskToProgress({ ...base, status: 'claimed', consumedAt: '2026-11-09 10:00:00' }).id, 9);
  assert.equal(taskToProgress({ ...base, status: 'done', completedAt: '2026-11-09 11:00:00' }).id, 9);
  assert.equal(taskToProgress({ ...base, status: 'pending', deletedAt: '2026-11-09 11:00:00' }).id, 9);
  assert.equal(taskToProgress({ ...base, status: 'pending', migratedTo: { side: 'cloud' } }).id, 9);
  // 卡片数据里不再有 round——面板显示与搜索都走编号（结构上防止回退到 #122 语义）
  assert.equal(taskToProgress({ ...base, status: 'pending', round: 4 }).round, undefined);
});
