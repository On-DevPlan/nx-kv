// 评论 / 反馈回写的正文拼装原语 —— 服务端与面板共用同一份（#79）。
//
// 为什么要有这一份：段名（## 反馈修改 / ## 验收反馈 / ## 上一轮完成总结）、
// 锚定引用格式（> 锚定：）、逐行加粗口径，此前只在面板 modules/board/reopen-text.js
// 有一份；服务端要把反馈**追加**到盘上正文（#79：面板会话 doc 可能过期，拿旧正文
// 拼回去就是「评论一次丢一次」），两处各写一套，段名与格式迟早分叉——收口到这里。
//
// 纯函数、零依赖：node 单测直接 import，vite 打包进前端，服务端 src/modules 共用。

/** 上轮 ack 完成总结段标题 */
export const ACK_SUMMARY_HEADING = '## 上一轮完成总结';
/** 验收反馈段标题（ack 场景：已完成任务的重做） */
export const FEEDBACK_HEADING = '## 验收反馈';
/** 普通反馈段标题（非 ack 场景：任务没完成时的「反馈修改」） */
export const PLAIN_FEEDBACK_HEADING = '## 反馈修改';

/**
 * 反馈逐行加粗（用户口径：重开的任务要携带着反馈文字在正文中，最好加粗）。
 * 空行不加粗（`**` 会渲染成一行空的粗体）。 */
export function boldFeedback(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => (line.trim() ? `**${line}**` : line))
    .join('\n');
}

/** 划选原文 → 锚定引用块（面板与服务端共用一种格式）；空选区返回空串 */
export function quoteBlock(quote) {
  const q = String(quote ?? '').trim();
  if (!q) return '';
  return `> 锚定：\n> ${q.replace(/\n/g, '\n> ')}`;
}

/**
 * 反馈段：段名 +（可选）锚定引用 + 反馈正文（bold 时逐行加粗）。
 * 反馈与选区都空 → 返回空串（调用方据此不追加）。
 */
export function feedbackSection({ heading, quote, feedback, bold = false } = {}) {
  const fb = String(feedback ?? '').trim();
  if (!fb) return '';
  const body = bold ? boldFeedback(fb) : fb;
  const anchor = quoteBlock(quote);
  return `${String(heading ?? PLAIN_FEEDBACK_HEADING)}\n\n${anchor ? `${anchor}\n\n` : ''}${body}`;
}

/**
 * 把反馈段**追加**到一份完整正文末尾（#79 服务端评论回写的拼装口径）：
 * 第一个区块永远是完整的之前的任务，接着才是引用字符和评论。
 * base 空 → 只返回反馈段；反馈段空 → base 原样返回（带收尾换行规整）。
 */
export function appendFeedback({ base, heading, quote, feedback, bold = false } = {}) {
  const b = String(base ?? '').trimEnd();
  const sec = feedbackSection({ heading, quote, feedback, bold });
  if (b && !sec) return `${b}\n`;
  if (!b && !sec) return '';
  return `${b ? `${b}\n\n` : ''}${sec}\n`;
}
