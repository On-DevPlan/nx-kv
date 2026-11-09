// tasktool/delivery-text.js —— 交付载荷的人读正文（**唯一出处**）。
//
// 谁会用到：
//   - CLI `localtask get/wait` 的人读输出（localtask/index.js 的 renderWait）
//   - CLI `localtask preview` 与面板「预览提示词」（tasktool/preview.js）
//
// 为什么单独抽出来：预览的全部价值在于「所见即所得」——如果面板自己拼一遍排版，
// 迟早与 CLI 漂移，用户看到的就不是 agent 收到的那一份。同一份代码 = 同一份文本。
//
// 排版口径：instruction 自包含正文（模板含 {{task.text}}，服务端给出 coversBody）
// 时直接替掉正文块（否则正文会出现两遍）；否则「正文 + ── 收尾指令 ──」两段。
// 正文交给阅读方前统一做「倒序聚焦 + 历史精简」重排（#157，shared/feedback-text.js）。
import { reorderRoundsForDelivery } from '../../shared/feedback-text.js';

export function deliveryBodyText(r) {
  const indent = (s) => String(s).replace(/\n/g, '\n  ');
  const taskText = (r && r.task && r.task.text) || '';
  if (r && r.instruction && r.coversBody) return `  ${indent(r.instruction)}`;
  // 正文交给阅读方前做「倒序聚焦 + 历史精简」重排（#157）：最新轮反馈/总结置顶，
  // 历史轮次一行摘要——无轮次段的正文原样返回，零影响。
  const body = `  ${indent(reorderRoundsForDelivery(taskText))}`;
  return r && r.instruction ? `${body}\n  ── 收尾指令 ──\n  ${indent(r.instruction)}` : body;
}

/** 去缩进版本（面板 <pre> 用；CLI 保留两格缩进贴合既有输出）。 */
export function deliveryPlainText(r) {
  return deliveryBodyText(r).replace(/^ {2}/gm, '');
}
