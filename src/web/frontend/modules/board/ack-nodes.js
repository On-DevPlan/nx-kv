// 任务正文的「ack 节点」抽取 —— 反复 ack 反馈的长任务页要能快速定位到某一轮。
//
// 背景（任务 #48）：用户给了 DOM 定位器（`.doc-rail-ticks` 那个小定位轨），
// 说「这个功能可以快速定位，而对于一些反复 ack 反馈的页面，这些任务页面很长，
// 操作不便捷，想要复用这个组件，将每一次 ack 作为一个节点去快速定位」。
//
// 事实基础：每次「重做（带反馈）」都会把上一轮的 ack 与本轮反馈**追加**进任务正文
// （见 modules/board/reopen-text.js 的 buildReopenText），所以正文里会出现**多个**
// `## 上一轮完成总结` / `## 验收反馈` 段。任务 #34 就是 5 轮、正文 13903 字符。
//
// 为什么不能直接用 extractMdHeadings 的标题 id：它给同名标题生成 `上一轮完成总结` /
// `-2` / `-3`… 的 id，但**实时预览态**（mdw-lp）是**逐块渲染**的——每块各自调
// renderMarkdownHtml、各有一套 usedIds，于是同名标题在 DOM 里拿到的是**重复的同一个
// id**（实测两个 `## 上一轮完成总结` 都是 id="上一轮完成总结"）。按 id 跳转会永远落在
// 第一轮。所以这里按**块序号**定位：块切分口径直接复用 md-parse 的 liveBodyBlocks
// （与实时预览渲染用的是同一个函数），序号才对得上 DOM 里的 data-i。
//
// 纯函数、零依赖（只 import 同为纯前端的 md-parse.js）：前端取节点、单测都能用。

import { liveBodyBlocks } from '../md/md-parse.js';

/** ack 段标题（与 reopen-text.js 同口径） */
export const ACK_NODE_HEADING = '## 上一轮完成总结';
/** 反馈段标题 */
export const ACK_NODE_FEEDBACK_HEADING = '## 验收反馈';

/**
 * 从任务正文里抽出每一轮 ack 节点。
 *
 * @param {string} body 任务正文（Markdown）
 * @returns {{ round:number, blockIndex:number, feedbackBlockIndex:number,
 *            ackText:string, feedbackText:string }[]}
 *   round 从 1 起。blockIndex 是该轮 ack 段标题在**正文块序列**里的序号（0 基，
 *   对应实时预览的 data-i）；feedbackBlockIndex 同理，找不到为 -1。
 */
export function extractAckNodes(body) {
  const blocks = liveBodyBlocks(String(body ?? ''));
  if (!blocks.length) return [];

  const out = [];
  // cur = 正在填充的节点；phase = 当前内容属于它的哪一段
  let cur = null;
  let phase = '';

  blocks.forEach((raw, i) => {
    const b = String(raw || '').trim();
    if (b === ACK_NODE_HEADING) {
      cur = {
        round: out.length + 1,
        blockIndex: i,
        feedbackBlockIndex: -1,
        ackText: '',
        feedbackText: '',
      };
      out.push(cur);
      phase = 'ack';
      return;
    }
    if (b === ACK_NODE_FEEDBACK_HEADING) {
      // 反馈段归属**当前正在填的 ack 段**（没有则忽略——孤儿反馈段不算节点）
      if (cur && phase === 'ack') {
        cur.feedbackBlockIndex = i;
        phase = 'feedback';
      }
      return;
    }
    if (!b || !cur) return;
    if (phase === 'ack') cur.ackText += (cur.ackText ? '\n' : '') + b;
    else cur.feedbackText += (cur.feedbackText ? '\n' : '') + b;
  });

  return out.filter((n) => n.ackText !== '');
}

/**
 * 给节点起一个短标题（轨上显示用）：取 ack 首行（去掉 markdown 记号），
 * 空则退到「第 N 轮」。过长截断。
 * @param {{round:number, ackText:string}} node
 * @returns {string}
 */
export function ackNodeTitle(node) {
  const first = String(node?.ackText || '')
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim())
    .find((l) => l !== '');
  if (!first) return `第 ${node?.round ?? 1} 轮`;
  const short = first.length > 24 ? `${first.slice(0, 24)}…` : first;
  return `第 ${node.round} 轮 · ${short}`;
}
