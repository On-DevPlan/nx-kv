// ack 定位轨的抽取口径钉子（任务 #48）：
// 反复「重做（带反馈）」会把每一轮的 ack 与反馈**追加**进任务正文，
// 正文里因此出现多个「## 上一轮完成总结」段。轨按轮次列节点，位置必须与
// 实时预览的块序号（data-i）对得上——否则点击会跳错块。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAckNodes,
  ackNodeTitle,
  ACK_NODE_HEADING,
} from '../../src/web/frontend/modules/board/ack-nodes.js';
import { liveBodyBlocks } from '../../src/web/frontend/modules/md/md-parse.js';

const round = (ack, feedback) =>
  [ACK_NODE_HEADING, '', ack, '', '## 验收反馈', '', feedback].join('\n');

test('没有 ack 段 → 空数组', () => {
  assert.deepEqual(extractAckNodes('# 标题\n\n正文'), []);
  assert.deepEqual(extractAckNodes(''), []);
  assert.deepEqual(extractAckNodes('   \n\n  '), []);
});

test('单轮：抽出 1 个节点，块序号指向 ack 标题块', () => {
  const body = `# 任务\n\n## 背景\n\n要做的事\n\n${round('我做完了 A', '再补 B')}`;
  const nodes = extractAckNodes(body);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].round, 1);
  assert.equal(nodes[0].ackText, '我做完了 A');
  assert.equal(nodes[0].feedbackText, '再补 B');

  const blocks = liveBodyBlocks(body);
  assert.equal(String(blocks[nodes[0].blockIndex]).trim(), ACK_NODE_HEADING);
  assert.equal(String(blocks[nodes[0].feedbackBlockIndex]).trim(), '## 验收反馈');
});

test('多轮：轮次按正文出现顺序编号，每轮各自的块序号互不相同', () => {
  const body = [
    '# 任务',
    '',
    '## 背景',
    '',
    '要做的事',
    '',
    round('第一轮总结', '第一轮反馈'),
    '',
    round('第二轮总结', '第二轮反馈'),
    '',
    round('第三轮总结', '第三轮反馈'),
  ].join('\n');
  const nodes = extractAckNodes(body);
  assert.equal(nodes.length, 3);
  assert.deepEqual(nodes.map((n) => n.round), [1, 2, 3]);
  assert.deepEqual(nodes.map((n) => n.ackText), ['第一轮总结', '第二轮总结', '第三轮总结']);
  assert.deepEqual(nodes.map((n) => n.feedbackText), ['第一轮反馈', '第二轮反馈', '第三轮反馈']);

  // 块序号互不相同，且都真的指向 ack 标题块
  const blocks = liveBodyBlocks(body);
  const idxs = nodes.map((n) => n.blockIndex);
  assert.equal(new Set(idxs).size, 3, '轮次块序号必须互不相同');
  for (const n of nodes) {
    assert.equal(String(blocks[n.blockIndex]).trim(), ACK_NODE_HEADING);
  }
  // 轮次递增 = 块序号递增（正文里后面追加的轮次在更后面）
  assert.ok(idxs[0] < idxs[1] && idxs[1] < idxs[2]);
});

test('块序号与实时预览的 DOM 块序号一致（data-i 口径）', () => {
  const body = [`# T`, '', '## 背景', '', 'x', '', round('ack 一', 'fb 一'), '', round('ack 二', 'fb 二')].join('\n');
  const blocks = liveBodyBlocks(body);
  const nodes = extractAckNodes(body);
  // 每个轮次的块序号在块数组里就是那个「## 上一轮完成总结」块
  for (const n of nodes) {
    assert.equal(String(blocks[n.blockIndex]).trim(), ACK_NODE_HEADING);
  }
});

test('ack 段没有正文 → 该轮不算节点（避免空节点占位）', () => {
  const body = `# T\n\n${ACK_NODE_HEADING}\n\n## 验收反馈\n\n只有反馈`;
  assert.equal(extractAckNodes(body).length, 0);
});

test('反馈段缺失 → feedbackBlockIndex 为 -1，不影响 ack 抽取', () => {
  const body = `# T\n\n${ACK_NODE_HEADING}\n\n只有总结没有反馈段`;
  const nodes = extractAckNodes(body);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].feedbackBlockIndex, -1);
  assert.equal(nodes[0].feedbackText, '');
});

test('ack 正文是多段 md 时整体收进 ackText', () => {
  const body = `# T\n\n${ACK_NODE_HEADING}\n\n第一段\n\n第二段\n\n## 验收反馈\n\nfb`;
  const nodes = extractAckNodes(body);
  assert.equal(nodes.length, 1);
  assert.ok(nodes[0].ackText.includes('第一段'));
  assert.ok(nodes[0].ackText.includes('第二段'));
  assert.equal(nodes[0].feedbackText, 'fb');
});

test('ackNodeTitle：取首行、剥 markdown 记号、过长截断', () => {
  assert.equal(ackNodeTitle({ round: 2, ackText: '**加粗标题**' }), '第 2 轮 · 加粗标题');
  assert.equal(ackNodeTitle({ round: 1, ackText: '' }), '第 1 轮');
  const long = 'x'.repeat(50);
  const t = ackNodeTitle({ round: 3, ackText: long });
  assert.ok(t.startsWith('第 3 轮 · '));
  assert.ok(t.length < 40, '过长要截断');
});

// ─── 轮次 callout 形态（#144）：新正文写「> [!NOTE] 第 N 轮 · 完成总结」等 ───

const calloutRound = (n, ack, feedback) =>
  [
    `> [!NOTE] 第 ${n} 轮 · 完成总结`,
    ...ack.split('\n').map((l) => `> ${l}`),
    '',
    `> [!WARNING] 第 ${n} 轮 · 验收反馈`,
    ...feedback.split('\n').map((l) => `> ${l}`),
  ].join('\n');

test('callout 单轮：抽出 1 个节点，块序号指向 callout 块，轮次号取标题数字', () => {
  const body = ['# 任务', '', '## 背景', '', '要做的事', '', calloutRound(1, 'callout 总结', 'callout 反馈')].join('\n');
  const nodes = extractAckNodes(body);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].round, 1);
  assert.equal(nodes[0].ackText, 'callout 总结');
  assert.equal(nodes[0].feedbackText, 'callout 反馈');

  const blocks = liveBodyBlocks(body);
  assert.ok(String(blocks[nodes[0].blockIndex]).startsWith('> [!NOTE] 第 1 轮 · 完成总结'));
  assert.ok(String(blocks[nodes[0].feedbackBlockIndex]).startsWith('> [!WARNING] 第 1 轮 · 验收反馈'));
});

test('callout 多轮：轮次号取标题数字，块序号互不相同且递增', () => {
  const body = ['# T', '', calloutRound(1, '总结一', '反馈一'), '', calloutRound(2, '总结二', '反馈二'), '', calloutRound(3, '总结三', '反馈三')].join('\n');
  const nodes = extractAckNodes(body);
  assert.equal(nodes.length, 3);
  assert.deepEqual(nodes.map((n) => n.round), [1, 2, 3]);
  assert.deepEqual(nodes.map((n) => n.ackText), ['总结一', '总结二', '总结三']);
  assert.deepEqual(nodes.map((n) => n.feedbackText), ['反馈一', '反馈二', '反馈三']);
  const idxs = nodes.map((n) => n.blockIndex);
  assert.equal(new Set(idxs).size, 3);
  assert.ok(idxs[0] < idxs[1] && idxs[1] < idxs[2]);
});

test('新旧形态混排：历史正文（段名）+ 新追加轮次（callout）都能抽出来', () => {
  const body = [
    '# T',
    '',
    round('旧轮总结', '旧轮反馈'),
    '',
    calloutRound(2, '新轮总结', '新轮反馈'),
  ].join('\n');
  const nodes = extractAckNodes(body);
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes.map((n) => n.round), [1, 2]);
  assert.deepEqual(nodes.map((n) => n.ackText), ['旧轮总结', '新轮总结']);
});

test('callout 孤儿反馈块（前面没有完成总结块）不算节点', () => {
  const body = '# T\n\n> [!WARNING] 第 1 轮 · 验收反馈\n> 孤儿反馈';
  assert.deepEqual(extractAckNodes(body), []);
});

test('callout 反馈块里的加粗行原样收进 feedbackText（剥 > 前缀）', () => {
  const body = ['> [!NOTE] 第 1 轮 · 完成总结', '> 总结', '', '> [!WARNING] 第 1 轮 · 验收反馈', '> **反馈甲**', '> **反馈乙**'].join('\n');
  const nodes = extractAckNodes(body);
  assert.equal(nodes[0].feedbackText, '**反馈甲**\n**反馈乙**');
});
