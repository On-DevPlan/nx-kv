// #79：评论 / 反馈不带 text 时，服务端把反馈段**追加**到盘上当前正文——
// base 永远是服务端最新正文（面板会话 doc 过期也不能丢数据）。
// 显式给 text 的整篇替换口径不变；无 text 无 feedback 只翻状态。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb } from '../../src/core/db/index.js';  // T05：库化后测试清理要先关连接（Windows rmSync 否则 EBUSY）
import { topicKeyFor } from '../../src/modules/localtask/paths.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-reopen-compose-'));
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
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
  // T04：链 = task_links（type=comment）；#172 原则——评论是旁支批注，父任务保持活着
  assert.equal(res.parentId, id);
  const parent = await svc.getTask({ cwd: CWD, id });
  assert.equal(parent.status, 'pending', '评论不取消原任务（#172）');
  assert.ok(!parent.supersededBy, '原任务没有被取代');
});

test('comment 二次评论：两条**并行**旁支（都挂原任务下，各自独立且都活着，#177）', async () => {
  const { svc, id } = await seedTask('# 原任务\n\n正文。');
  const first = await svc.reopenTask({ cwd: CWD, id, kind: 'comment', feedback: '第一条评论' });
  const second = await svc.reopenTask({ cwd: CWD, id, kind: 'comment', feedback: '第二条评论' });
  assert.notEqual(second.id, first.id, '两个不同节点');
  // 并行 = 各自只含本条评论（不串成链）
  assert.ok(first.task.text.includes('第一条评论'));
  assert.ok(!first.task.text.includes('第二条评论'), '第一条不含第二条');
  assert.ok(second.task.text.includes('第二条评论'));
  // 都活着；原任务也活着
  const firstTask = await svc.getTask({ cwd: CWD, id: first.id });
  assert.equal(firstTask.status, 'pending', '第一条评论任务不被取消（并行旁支）');
  assert.equal(second.task.status, 'pending');
  const parent = await svc.getTask({ cwd: CWD, id });
  assert.equal(parent.status, 'pending', '原任务保持');
  // 链结构：两个讨论任务的父都是原任务（并行，不是 #2 → #3 的链）
  const chain = await svc.taskChain({ cwd: CWD, id });
  const selfNode = chain.tree;
  const kidIds = (selfNode.children || []).map((c) => Number(c.id));
  assert.ok(kidIds.includes(Number(first.id)) && kidIds.includes(Number(second.id)), '两评论是同级子节点');
});

test('reopen 不带 text：#144 起写轮次 callout（反馈逐行加粗；无总结时只有反馈块）', async () => {
  const { svc, id } = await seedTask('# 原任务\n\n正文。');
  const res = await svc.reopenTask({ cwd: CWD, id, kind: 'reopen', feedback: '重做意见\n第二行' });
  assert.ok(res.task.text.includes('> [!WARNING] 第 1 轮 · 验收反馈'));
  assert.ok(res.task.text.includes('> **重做意见**'));
  assert.ok(res.task.text.includes('> **第二行**'));
  assert.ok(!res.task.text.includes('[!NOTE]'), '没有总结就不追加空总结块');
});

test('reopen done 任务不带 text：顺带补本轮完成总结 callout（与面板同一份口径）', async () => {
  const { svc, id } = await seedTask('# 原任务\n\n正文。');
  await svc.claimFirstPending(topicKeyFor(CWD), '测试领取'); // done 门禁要求先领取
  await svc.completeTask({ cwd: CWD, id, summary: '已把平滑滚动改成瞬时定位' });
  const res = await svc.reopenTask({ cwd: CWD, id, kind: 'reopen', feedback: '还是卡顿' });
  assert.ok(res.task.text.includes('> [!NOTE] 第 1 轮 · 完成总结'), 'done 的总结落进 callout');
  assert.ok(res.task.text.includes('> 已把平滑滚动改成瞬时定位'));
  assert.ok(res.task.text.includes('> [!WARNING] 第 1 轮 · 验收反馈'));
  assert.ok(res.task.text.includes('> **还是卡顿**'));
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
