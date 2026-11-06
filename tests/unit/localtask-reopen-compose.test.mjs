// #79：评论 / 反馈不带 text 时，服务端把反馈段**追加**到盘上当前正文——
// base 永远是服务端最新正文（面板会话 doc 过期也不能丢数据）。
// 显式给 text 的整篇替换口径不变；无 text 无 feedback 只翻状态。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-reopen-compose-'));
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_TIMEGOAL_STORE = join(dir, 'timegoals.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

const CWD = join(tmpdir(), 'nx-kv-reopen-compose-proj');

async function seedTask(text) {
  const svc = await import('../../src/modules/localtask/service.js');
  mkdirSync(CWD, { recursive: true });
  const { task } = await svc.addTask({ cwd: CWD, text });
  return { svc, id: task.id };
}

test('comment 不带 text：反馈段追加到服务端正文，锚定引用在评论之前', async () => {
  const { svc, id } = await seedTask('---\nparent: "#9"\n---\n# 原任务\n\n第一段。\n\n第二段。');
  const res = await svc.reopenTask({
    cwd: CWD,
    id,
    kind: 'comment',
    quote: '第一段。',
    feedback: '这里写得不对',
  });
  assert.equal(res.status, 'ok');
  assert.equal(res.task.status, 'pending');
  // 第一个区块仍是完整之前的任务（frontmatter + 原文），接着才是锚定与评论
  assert.equal(
    res.task.text,
    [
      '---',
      'parent: "#9"',
      '---',
      '# 原任务',
      '',
      '第一段。',
      '',
      '第二段。',
      '',
      '## 反馈修改',
      '',
      '> 锚定：',
      '> 第一段。',
      '',
      '这里写得不对',
      '',
    ].join('\n')
  );
  // T04：链 = task_links（type=comment）；父 cancelled + superseded
  assert.equal(res.parentId, id);
  const parent = await svc.getTask({ cwd: CWD, id });
  assert.equal(parent.status, 'cancelled');
  assert.equal(parent.supersededBy, res.id);
});

test('comment 二次评论：顺链走尖，两轮评论段都保留在最新正文里', async () => {
  const { svc, id } = await seedTask('# 原任务\n\n正文。');
  const first = await svc.reopenTask({ cwd: CWD, id, kind: 'comment', feedback: '第一条评论' });
  const second = await svc.reopenTask({ cwd: CWD, id, kind: 'comment', feedback: '第二条评论' });
  // 二次评论作用在同一任务上 → 顺链走尖，从 R2 派生 R3；两轮评论段都在正文里
  assert.notEqual(second.id, first.id, 'R3 派生新编号');
  assert.ok(second.task.text.includes('第一条评论'));
  assert.ok(second.task.text.includes('第二条评论'));
  assert.ok(second.task.text.indexOf('第一条评论') < second.task.text.indexOf('第二条评论'), '评论按时间序');
  assert.equal(second.task.status, 'pending', 'R3 是当前尖');
  const firstTask = await svc.getTask({ cwd: CWD, id: first.id });
  assert.equal(firstTask.status, 'cancelled', 'R2 被 R3 取代');
});

test('reopen 不带 text：段名默认「## 验收反馈」且逐行加粗', async () => {
  const { svc, id } = await seedTask('# 原任务\n\n正文。');
  const res = await svc.reopenTask({ cwd: CWD, id, kind: 'reopen', feedback: '重做意见\n第二行' });
  assert.ok(res.task.text.includes('## 验收反馈'));
  assert.ok(res.task.text.includes('**重做意见**'));
  assert.ok(res.task.text.includes('**第二行**'));
});

test('feedbackHeading / feedbackBold 覆盖默认段名与加粗口径', async () => {
  const { svc, id } = await seedTask('# 原任务\n\n正文。');
  const res = await svc.reopenTask({
    cwd: CWD,
    id,
    kind: 'reopen',
    feedback: 'plain 意见',
    feedbackHeading: '## 反馈修改',
    feedbackBold: false,
  });
  assert.ok(res.task.text.includes('## 反馈修改\n\nplain 意见'));
  assert.ok(!res.task.text.includes('**plain 意见**'));
});

test('显式 text 仍整篇替换（带未保存编辑的回写口径不变）', async () => {
  const { svc, id } = await seedTask('# 原任务\n\n旧正文。');
  const res = await svc.reopenTask({
    cwd: CWD,
    id,
    kind: 'comment',
    quote: 'q',
    feedback: 'fb',
    text: '# 原任务\n\n面板拼好的整篇。',
  });
  assert.equal(res.task.text, '# 原任务\n\n面板拼好的整篇。');
  assert.ok(!res.task.text.includes('## 反馈修改'));
});

test('无 text 无 feedback：只翻状态不动正文（#74 口径不变）', async () => {
  const { svc, id } = await seedTask('# 原任务\n\n正文。');
  const res = await svc.reopenTask({ cwd: CWD, id, kind: 'reopen' });
  assert.equal(res.task.text, '# 原任务\n\n正文。');
  assert.equal(res.task.status, 'pending');
});
