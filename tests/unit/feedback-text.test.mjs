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
  ackCalloutSection,
  feedbackCalloutSection,
  countAckRounds,
  nextRoundOf,
  bodyHasAck,
  appendAckFeedback,
  reorderRoundsForDelivery,
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
  // #144 轮次 callout 原语也走同一份 re-export
  assert.equal(fe.appendAckFeedback, appendAckFeedback);
  assert.equal(fe.nextRoundOf, nextRoundOf);
});

// ─── 轮次 callout（#144）────────────────────────────────────────────

test('ackCalloutSection / feedbackCalloutSection：轮次标题 + 逐行 > 前缀；空内容返回空串', () => {
  assert.equal(
    ackCalloutSection({ round: 1, ack: '做完了 A\n第二行' }),
    '> [!NOTE] 第 1 轮 · 完成总结\n> 做完了 A\n> 第二行'
  );
  assert.equal(ackCalloutSection({ round: 2, ack: '  ' }), '');
  assert.equal(
    feedbackCalloutSection({ round: 3, feedback: '两行\n反馈', bold: true }),
    '> [!WARNING] 第 3 轮 · 验收反馈\n> **两行**\n> **反馈**'
  );
  assert.equal(feedbackCalloutSection({ round: 1, feedback: '' }), '');
});

test('feedbackCalloutSection：锚定引用并进同一 callout 块', () => {
  assert.equal(
    feedbackCalloutSection({ round: 2, quote: '选区文字', feedback: '要改', bold: false }),
    '> [!WARNING] 第 2 轮 · 验收反馈\n> 锚定：\n> 选区文字\n>\n> 要改'
  );
});

test('countAckRounds / nextRoundOf：旧段名与 callout 两种形态都数，显式轮次号取最大', () => {
  assert.equal(countAckRounds('# 正文\n\n没有轮次'), 0);
  assert.equal(nextRoundOf(''), 1);
  const legacy = `${ACK_SUMMARY_HEADING}\n\na\n\n${FEEDBACK_HEADING}\n\nb`;
  assert.equal(countAckRounds(legacy), 1);
  const callout = [
    '# T',
    '',
    '> [!NOTE] 第 1 轮 · 完成总结',
    '> a',
    '',
    '> [!WARNING] 第 1 轮 · 验收反馈',
    '> b',
    '',
    '> [!NOTE] 第 2 轮 · 完成总结',
    '> c',
  ].join('\n');
  assert.equal(countAckRounds(callout), 2);
  assert.equal(nextRoundOf(callout), 3);
  // 混排：旧 2 段 + callout 显式第 5 轮 → 已有轮数取 max(2, 5) = 5
  const mixed = `${legacy}\n\n${ACK_SUMMARY_HEADING}\n\nc\n\n${FEEDBACK_HEADING}\n\nd\n\n> [!NOTE] 第 5 轮 · 完成总结\n> e`;
  assert.equal(countAckRounds(mixed), 5);
  assert.equal(nextRoundOf(mixed), 6);
  // 反馈 callout 不算轮（只有完成总结块算一轮）
  assert.equal(countAckRounds('> [!WARNING] 第 9 轮 · 验收反馈\n> x'), 0);
});

test('bodyHasAck：同一份总结（旧段名与 callout 形态）都认得出', () => {
  const legacy = `${ACK_SUMMARY_HEADING}\n\n同一份总结`;
  assert.equal(bodyHasAck(legacy, '同一份总结'), true);
  assert.equal(bodyHasAck(legacy, '别的总结'), false);
  const callout = '> [!NOTE] 第 1 轮 · 完成总结\n> 同一份总结\n> 第二行';
  assert.equal(bodyHasAck(callout, '同一份总结\n第二行'), true);
  assert.equal(bodyHasAck(callout, ''), false);
  assert.equal(bodyHasAck('', '总结'), false);
});

test('appendAckFeedback：base + 总结 callout + 反馈 callout；同一份总结不重复追加', () => {
  const first = appendAckFeedback({ base: '原正文', ack: '总结一', feedback: '反馈一' });
  assert.equal(
    first,
    ['原正文', '', '> [!NOTE] 第 1 轮 · 完成总结', '> 总结一', '', '> [!WARNING] 第 1 轮 · 验收反馈', '> **反馈一**', ''].join('\n')
  );
  const second = appendAckFeedback({
    base: first.trimEnd(),
    ack: '总结一',
    feedback: '反馈二',
  });
  assert.equal(second.match(/\[!NOTE\]/g).length, 1, '同一份总结不追加第二遍');
  assert.ok(second.includes('> [!WARNING] 第 2 轮 · 验收反馈'), '反馈轮次号顺延');
  assert.ok(second.includes('**反馈二**'));
});

test('appendAckFeedback：全空 → 空串；只有 base → 原样规整；显式 round 覆盖推导', () => {
  assert.equal(appendAckFeedback({ base: '', ack: '', feedback: '' }), '');
  assert.equal(appendAckFeedback({ base: '原正文\n', ack: '', feedback: '' }), '原正文\n');
  assert.equal(
    appendAckFeedback({ base: '', ack: 's', feedback: 'f', round: 7 }),
    '> [!NOTE] 第 7 轮 · 完成总结\n> s\n\n> [!WARNING] 第 7 轮 · 验收反馈\n> **f**\n'
  );
});


// ─── 交付侧上下文重排（#157）────────────────────────────────────────

const roundBody = (n, ack, fb) => [
  `> [!NOTE] 第 ${n} 轮 · 完成总结`,
  ...ack.split('\n').map((l) => `> ${l}`),
  '',
  `> [!WARNING] 第 ${n} 轮 · 验收反馈`,
  ...fb.split('\n').map((l) => `> ${l}`),
].join('\n');

test('reorderRoundsForDelivery：无轮次段 → 原样返回', () => {
  assert.equal(reorderRoundsForDelivery('# 任务\n\n正文'), '# 任务\n\n正文');
  assert.equal(reorderRoundsForDelivery(''), '');
});

test('reorderRoundsForDelivery：骨架置顶 + 最新轮完整 + 历史一行摘要', () => {
  const body = [
    '# 任务',
    '',
    '原始需求。',
    '',
    roundBody(1, '第一轮总结', '第一轮反馈'),
    '',
    roundBody(2, '第二轮总结', '第二轮反馈'),
  ].join('\n');
  const out = reorderRoundsForDelivery(body);
  // 骨架在最前
  assert.ok(out.startsWith('# 任务\n\n原始需求。'));
  // 最新轮（第 2 轮）完整内容紧随骨架：反馈在前、总结在后
  const fb2 = out.indexOf('> [!WARNING] 第 2 轮 · 验收反馈');
  const ack2 = out.indexOf('> [!NOTE] 第 2 轮 · 完成总结');
  assert.ok(fb2 > 0 && ack2 > fb2, '第 2 轮反馈在前、总结在后');
  assert.ok(out.includes('> 第二轮反馈'), '最新轮反馈原文保留');
  assert.ok(out.includes('> 第二轮总结'), '最新轮总结原文保留');
  // 第 1 轮压成一行摘要，全文不再出现
  assert.ok(out.includes('· 第 1 轮 反馈「第一轮反馈」；总结「第一轮总结」'));
  assert.ok(!out.includes('> [!NOTE] 第 1 轮'));
  assert.ok(out.includes('历史轮次'));
  // 最新轮在历史段之前
  assert.ok(out.indexOf('> [!NOTE] 第 2 轮') < out.indexOf('· 第 1 轮'));
});

test('reorderRoundsForDelivery：单轮无历史段；历史摘要截断到 60 字', () => {
  const long = 'x'.repeat(100);
  // 两轮：第 1 轮的长总结进历史段（截断），第 2 轮原文保留
  const body = ['# T', '', roundBody(1, long, '短反馈'), '', roundBody(2, '新总结', '新反馈')].join('\n');
  const out = reorderRoundsForDelivery(body);
  assert.ok(!out.includes(long), '历史长文不再全文出现');
  assert.ok(out.includes(`总结「${'x'.repeat(60)}…」`), '历史摘要截到 60 字');
  assert.ok(out.includes('> 新总结'), '最新轮原文保留');
});
