// 重开任务时的正文拼装 ——「原正文 + 上一轮 ack 完成总结 + 本轮验收反馈」。
//
// 为什么要有这一份（2026-11-04 反馈「ack 反馈应如同评价一样追加在重开任务末尾」）：
// 「重做」把任务打回 pending，验收条随之消失——上一轮 agent 的完成总结（ack）就
// 只剩 store 里的一个字段：UI 不再显示、正文里也没有，agent 重新领取时更看不见。
// 把它追加到重开后的正文末尾，下一轮接手的人/agent 一眼看到「上轮做到哪 +
// 这轮要改什么」。
//
// 段名 / 锚定格式 / 加粗口径收口在 src/shared/feedback-text.js（#79：服务端把反馈
// 追加到盘上正文时要用同一套段名，两处各写一套迟早分叉）——这里只 re-export +
// 保留面板专属的 buildReopenText（整篇拼装；服务端追加用 appendFeedback）。
//
// 注意：只拼**队列正文**，不动 md 文档本身（文档是编辑器的事，正文是队列的事）。

export {
  ACK_SUMMARY_HEADING,
  FEEDBACK_HEADING,
  PLAIN_FEEDBACK_HEADING,
  boldFeedback,
  quoteBlock,
  feedbackSection,
  appendFeedback,
} from '../../../../shared/feedback-text.js';

import {
  ACK_SUMMARY_HEADING,
  FEEDBACK_HEADING,
  boldFeedback,
} from '../../../../shared/feedback-text.js';

/**
 * 拼重开后的任务正文。
 *
 * @param {string} base 原正文（可空）
 * @param {string} feedback 用户反馈（可空）
 * @param {string} ackSummary 上一轮 agent 的完成总结（可空——没完成过就没有）
 * @param {string} feedbackHeading 反馈段标题
 * @param {boolean} bold 反馈是否逐行加粗（ack 场景 true；普通「反馈修改」沿用旧口径 false）
 * @returns {string} 新正文；无任何内容时返回空串（调用方据此**不带 text 字段**，
 *   服务端就只翻状态、不动正文）
 */
export function buildReopenText({
  base,
  feedback,
  ackSummary,
  feedbackHeading = FEEDBACK_HEADING,
  bold = true,
} = {}) {
  const parts = [];
  const b = String(base ?? '').trim();
  if (b) parts.push(b);

  // 同一份总结不追加两遍：连着点两次「重做」而 agent 还没交活时 roundSummary 没变，
  // 再追加一遍只是噪音。
  const ack = String(ackSummary ?? '').trim();
  if (ack && !b.includes(`${ACK_SUMMARY_HEADING}\n\n${ack}`)) {
    parts.push(`${ACK_SUMMARY_HEADING}\n\n${ack}`);
  }

  const fb = String(feedback ?? '').trim();
  if (fb) {
    const body = bold ? boldFeedback(fb) : fb;
    parts.push(`${feedbackHeading}\n\n${body}`);
  }

  return parts.length ? `${parts.join('\n\n')}\n` : '';
}
