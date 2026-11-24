import {
  test,
  beforeEach,
} from 'node:test';
import assert from 'node:assert/strict';
import { topicKeyFor } from '../../src/modules/localtask/paths.js';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import {
  tmpdir,
} from 'node:os';
import {
  join,
} from 'node:path';
import {
  closeDb,
} from '../../src/core/db/index.js';
import {
  ACK_SUMMARY_HEADING,
  FEEDBACK_HEADING,
  PLAIN_FEEDBACK_HEADING,
  boldFeedback,
  buildReopenText,
} from '../../src/web/frontend/modules/board/reopen-text.js';
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

// ════ localtask-reopen-compose.test.mjs（#200 合并入本文件）════
test('buildReopenText：原正文 + 第1轮完成总结 + 第1轮验收反馈（callout 形态，顺序固定）', () => {
  const text = buildReopenText({
    base: '# 标题\n\n原正文',
    ackSummary: '上轮把平滑滚动改成瞬时定位',
    feedback: '选中行还是跳\n第二行也要改',
  });

  assert.equal(
    text,
    [
      '# 标题',
      '',
      '原正文',
      '',
      '> [!NOTE] 第 1 轮 · 完成总结',
      '> 上轮把平滑滚动改成瞬时定位',
      '',
      '> [!WARNING] 第 1 轮 · 验收反馈',
      '> **选中行还是跳**',
      '> **第二行也要改**',
      '',
    ].join('\n')
  );
  assert.ok(!text.includes(ACK_SUMMARY_HEADING), '旧段名不再新写');
});

test('buildReopenText：没有完成总结时只追加反馈 callout', () => {
  const text = buildReopenText({ base: '原正文', feedback: '要改这里' });
  assert.equal(text, '原正文\n\n> [!WARNING] 第 1 轮 · 验收反馈\n> **要改这里**\n');
  assert.ok(!text.includes(ACK_SUMMARY_HEADING));
  assert.ok(!text.includes('[!NOTE]'));
});

test('buildReopenText：反馈与总结都空 → 返回空串（调用方不带 text 字段）', () => {
  assert.equal(buildReopenText({ base: '', feedback: '', ackSummary: '' }), '');
});

test('buildReopenText：同一份总结不追加两遍（连点两次重做；反馈各归各轮）', () => {
  const first = buildReopenText({
    base: '原正文',
    ackSummary: '同一份总结',
    feedback: '第一次的反馈',
  });
  const second = buildReopenText({
    base: first.trim(),
    ackSummary: '同一份总结',
    feedback: '第二次的反馈',
  });

  assert.equal(second.match(/\[!NOTE\]/g).length, 1, '完成总结 callout 只有一份');
  assert.ok(second.includes('第一次的反馈'));
  assert.ok(second.includes('第二次的反馈'));
  assert.ok(second.includes('> [!WARNING] 第 2 轮 · 验收反馈'), '第二次反馈轮次号顺延');
});

test('buildReopenText：换了新总结就再追加一轮（历史保留，轮次号递增）', () => {
  const first = buildReopenText({
    base: '原正文',
    ackSummary: '第一轮总结',
    feedback: '第一轮反馈',
  });
  const second = buildReopenText({
    base: first.trim(),
    ackSummary: '第二轮总结',
    feedback: '第二轮反馈',
  });

  assert.equal(second.match(/\[!NOTE\]/g).length, 2);
  assert.ok(second.includes('> [!NOTE] 第 1 轮 · 完成总结'));
  assert.ok(second.includes('> [!NOTE] 第 2 轮 · 完成总结'));
  assert.ok(second.includes('第一轮总结'));
  assert.ok(second.includes('第二轮总结'));
});

test('buildReopenText：旧段名正文（历史格式）继续编号——新轮次接着旧轮数排', () => {
  const legacyBase = [
    '# 任务',
    '',
    '原正文',
    '',
    ACK_SUMMARY_HEADING,
    '',
    '旧第一轮总结',
    '',
    FEEDBACK_HEADING,
    '',
    '**旧第一轮反馈**',
    '',
    ACK_SUMMARY_HEADING,
    '',
    '旧第二轮总结',
    '',
    FEEDBACK_HEADING,
    '',
    '**旧第二轮反馈**',
  ].join('\n');
  const text = buildReopenText({
    base: legacyBase,
    ackSummary: '新总结',
    feedback: '新反馈',
  });
  assert.ok(text.includes('> [!NOTE] 第 3 轮 · 完成总结'), `旧 2 轮之后新轮次 = 第 3 轮：\n${text}`);
  assert.ok(text.includes('> [!WARNING] 第 3 轮 · 验收反馈'));
});

test('buildReopenText：普通「反馈修改」不追加总结、不加粗（沿用旧段名口径）', () => {
  const text = buildReopenText({
    base: '原正文',
    feedback: '改这里',
    feedbackHeading: PLAIN_FEEDBACK_HEADING,
    bold: false,
  });
  assert.equal(text, `原正文\n\n${PLAIN_FEEDBACK_HEADING}\n\n改这里\n`);
  assert.ok(!text.includes('[!'));
});

test('buildReopenText：没有原正文时也能拼出反馈 callout', () => {
  const text = buildReopenText({ feedback: '只有反馈' });
  assert.equal(text, '> [!WARNING] 第 1 轮 · 验收反馈\n> **只有反馈**\n');
});

test('boldFeedback：空行不加粗（`**` 会渲染成空的粗体行）', () => {
  assert.equal(boldFeedback('第一行\n\n第二行'), '**第一行**\n\n**第二行**');
});

