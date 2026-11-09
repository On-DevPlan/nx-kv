import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACK_SUMMARY_HEADING,
  FEEDBACK_HEADING,
  PLAIN_FEEDBACK_HEADING,
  boldFeedback,
  buildReopenText,
} from '../../src/web/frontend/modules/board/reopen-text.js';

// #144：验收反馈段从「## 上一轮完成总结 / ## 验收反馈」段名改为**轮次 callout**——
// 「> [!NOTE] 第 N 轮 · 完成总结」+「> [!WARNING] 第 N 轮 · 验收反馈」，
// 轮次号按正文已有轮数 + 1（面板 md 渲染器把 [!TYPE] 渲染成醒目色块）。

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
