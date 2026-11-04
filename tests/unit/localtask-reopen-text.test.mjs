import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACK_SUMMARY_HEADING,
  FEEDBACK_HEADING,
  PLAIN_FEEDBACK_HEADING,
  boldFeedback,
  buildReopenText,
} from '../../src/web/frontend/modules/board/reopen-text.js';

test('buildReopenText：原正文 + 上轮 ack 完成总结 + 加粗验收反馈，顺序固定', () => {
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
      ACK_SUMMARY_HEADING,
      '',
      '上轮把平滑滚动改成瞬时定位',
      '',
      FEEDBACK_HEADING,
      '',
      '**选中行还是跳**',
      '**第二行也要改**',
      '',
    ].join('\n')
  );
});

test('buildReopenText：没有完成总结时只追加反馈段（段名仍是验收反馈）', () => {
  const text = buildReopenText({ base: '原正文', feedback: '要改这里' });
  assert.equal(text, `原正文\n\n${FEEDBACK_HEADING}\n\n**要改这里**\n`);
  assert.ok(!text.includes(ACK_SUMMARY_HEADING));
});

test('buildReopenText：反馈与总结都空 → 返回空串（调用方不带 text 字段）', () => {
  assert.equal(buildReopenText({ base: '', feedback: '', ackSummary: '' }), '');
});

test('buildReopenText：同一份总结不追加两遍（连点两次重做）', () => {
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

  assert.equal(second.match(new RegExp(ACK_SUMMARY_HEADING, 'g')).length, 1);
  assert.ok(second.includes('第一次的反馈'));
  assert.ok(second.includes('第二次的反馈'));
});

test('buildReopenText：换了新总结就再追加一段（历史保留）', () => {
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

  assert.equal(second.match(new RegExp(ACK_SUMMARY_HEADING, 'g')).length, 2);
  assert.ok(second.includes('第一轮总结'));
  assert.ok(second.includes('第二轮总结'));
});

test('buildReopenText：普通「反馈修改」不追加总结、不加粗（沿用旧口径）', () => {
  const text = buildReopenText({
    base: '原正文',
    feedback: '改这里',
    feedbackHeading: PLAIN_FEEDBACK_HEADING,
    bold: false,
  });
  assert.equal(text, `原正文\n\n${PLAIN_FEEDBACK_HEADING}\n\n改这里\n`);
});

test('buildReopenText：没有原正文时也能拼出反馈段', () => {
  const text = buildReopenText({ feedback: '只有反馈' });
  assert.equal(text, `${FEEDBACK_HEADING}\n\n**只有反馈**\n`);
});

test('boldFeedback：空行不加粗（`**` 会渲染成空的粗体行）', () => {
  assert.equal(boldFeedback('第一行\n\n第二行'), '**第一行**\n\n**第二行**');
});
