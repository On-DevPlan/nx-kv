// #79：评论/反馈回写拼装原语（src/shared/feedback-text.js）——
// 面板与服务端共用一份：段名、锚定格式、加粗口径、追加规则逐条锁死。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACK_SUMMARY_HEADING,
  FEEDBACK_HEADING,
  PLAIN_FEEDBACK_HEADING,
  boldFeedback,
  quoteBlock,
  feedbackSection,
  appendFeedback,
} from '../../src/shared/feedback-text.js';

test('quoteBlock：划选原文 → 锚定引用块，多行逐行加 >', () => {
  assert.equal(quoteBlock('选中这一段'), '> 锚定：\n> 选中这一段');
  assert.equal(quoteBlock('第一行\n第二行'), '> 锚定：\n> 第一行\n> 第二行');
  assert.equal(quoteBlock(''), '');
  assert.equal(quoteBlock(null), '');
  assert.equal(quoteBlock('   \n  '), '');
});

test('feedbackSection：段名 + 锚定 + 反馈；bold 逐行加粗；空反馈返回空串', () => {
  assert.equal(
    feedbackSection({ heading: PLAIN_FEEDBACK_HEADING, quote: '选区', feedback: '这里要改' }),
    '## 反馈修改\n\n> 锚定：\n> 选区\n\n这里要改'
  );
  assert.equal(
    feedbackSection({ heading: FEEDBACK_HEADING, feedback: '两行\n反馈', bold: true }),
    '## 验收反馈\n\n**两行**\n**反馈**'
  );
  assert.equal(feedbackSection({ heading: FEEDBACK_HEADING, feedback: '  ' }), '');
});

test('appendFeedback：第一个区块永远是完整之前的任务，接着才是引用和评论', () => {
  const out = appendFeedback({
    base: '# 任务\n\n原正文',
    heading: PLAIN_FEEDBACK_HEADING,
    quote: '原正文里的片段',
    feedback: '评论内容',
  });
  assert.equal(
    out,
    ['# 任务', '', '原正文', '', PLAIN_FEEDBACK_HEADING, '', '> 锚定：', '> 原正文里的片段', '', '评论内容', ''].join('\n')
  );
});

test('appendFeedback：base 空 → 只返回反馈段；反馈空 → base 原样（规整尾换行）', () => {
  assert.equal(
    appendFeedback({ base: '', heading: FEEDBACK_HEADING, feedback: '只有反馈' }),
    `${FEEDBACK_HEADING}\n\n只有反馈\n`
  );
  assert.equal(appendFeedback({ base: '原正文', feedback: '' }), '原正文\n');
  assert.equal(appendFeedback({ base: '原正文\n', feedback: '' }), '原正文\n');
  assert.equal(appendFeedback({ base: '', feedback: '' }), '');
});

test('段名常量与前端 reopen-text.js 的 re-export 一致（两处不许分叉）', async () => {
  const fe = await import('../../src/web/frontend/modules/board/reopen-text.js');
  assert.equal(fe.ACK_SUMMARY_HEADING, ACK_SUMMARY_HEADING);
  assert.equal(fe.FEEDBACK_HEADING, FEEDBACK_HEADING);
  assert.equal(fe.PLAIN_FEEDBACK_HEADING, PLAIN_FEEDBACK_HEADING);
  assert.equal(fe.appendFeedback, appendFeedback);
  assert.equal(fe.boldFeedback, boldFeedback);
});
