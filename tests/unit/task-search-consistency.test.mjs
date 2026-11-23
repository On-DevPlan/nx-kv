// #183：附件弹窗的「关联任务（本主题）」搜索与 topic 任务页搜索必须同一份引擎、
// 同一批任务上逐条一致（含顺序），且 frontmatter 不参与命中。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTasks } from '../../src/web/frontend/modules/board/task-search.js';

// 同一批任务：带 frontmatter（board/project 是元数据，不该被搜到）
const TASKS = [
  { id: 1, text: '---\nboard: b_demo\nproject: github.com/a/x\n---\n# 侧边栏分页\n\n把分页做成分段式。' },
  { id: 2, text: '---\nboard: b_demo\n---\n# 搜索框改造\n\n加通配 a*b 与编号前缀。' },
  { id: 12, text: '#12 编号点名的那条\n\n正文里写 侧边栏 与 翻页。' },
  { id: 3, text: '# 无 frontmatter 的任务\n\n侧边栏折叠态。' },
];

/** 弹窗侧实际路径（attach-modal 的 taskList）：排除宿主任务 → 统一引擎 → 截前 12。 */
function modalPath(tasks, q, hostId) {
  const pool = tasks.filter((t) => String(t.id) !== String(hostId));
  return filterTasks(pool, q).slice(0, 12);
}
/** topic 侧路径：整批任务走统一引擎（保持调用方显示序）。 */
function topicPath(tasks, q) {
  return filterTasks(tasks, q);
}

test('同一 query 在弹窗与 topic 两处结果逐条一致（含顺序）', () => {
  for (const q of ['侧边栏', '分页', 'a*b', '#12', '侧边栏 翻页', '', '不存在的词']) {
    const a = modalPath(TASKS, q, 999).map((t) => t.id);
    const b = topicPath(TASKS, q).map((t) => t.id);
    assert.deepEqual(a, b, `query=${JSON.stringify(q)}`);
  }
});

test('frontmatter 里的 board / project 不被命中（弹窗与 topic 一致）', () => {
  for (const q of ['board', 'project', 'b_demo']) {
    assert.equal(modalPath(TASKS, q, 999).length, 0, `弹窗 ${q}`);
    assert.equal(topicPath(TASKS, q).length, 0, `topic ${q}`);
  }
});

test('空串：两处都给全量且保持传入顺序', () => {
  const all = topicPath(TASKS, '').map((t) => t.id);
  assert.deepEqual(all, TASKS.map((t) => t.id));
  assert.deepEqual(modalPath(TASKS, '', 999).map((t) => t.id), all);
});

test('空串 + 宿主任务：只在弹窗侧被排除，不影响其它条目与顺序', () => {
  const ids = modalPath(TASKS, '', 1).map((t) => t.id);
  assert.deepEqual(ids, [2, 12, 3]);
});

test('编号点名：弹窗与 topic 都把 #12 与 12 排在前面（等价命中）', () => {
  const a = modalPath(TASKS, '#12', 999).map((t) => t.id);
  const b = topicPath(TASKS, '12').map((t) => t.id);
  assert.ok(a.includes(12) && b.includes(12));
  assert.deepEqual(a, b);
});

test('多词 AND：两处一致（都只留同时命中的任务）', () => {
  const a = modalPath(TASKS, '侧边栏 翻页', 999).map((t) => t.id);
  const b = topicPath(TASKS, '侧边栏 翻页').map((t) => t.id);
  assert.deepEqual(a, b);
  assert.deepEqual(a, [12]);
});
