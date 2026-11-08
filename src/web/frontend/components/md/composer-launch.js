// 评论 / 反馈的**编辑面板**启动器（#104）。
//
// 用户口径：评论和反馈不该是浮层里的一个输入框弹窗，而要**新开一块 md 编辑
// 页面**——顶部带引用信息（评论的那段话 / 「反馈 #xx 的任务」），下面是完整
// 的 md 编辑器。
//
// 面板要回调任务页的提交逻辑（评论 = 就地回写原任务；反馈 = 新开一条任务），
// 但那套逻辑带着会话状态（doc / topic / taskRow / 草稿判定），搬不动，也不该
// 复制一份——于是用**模块级登记表**：启动时登记 token → 回调，面板按 token
// 取回；面板提交或关闭后销号（否则登记表随开关面板无限增长）。
import { openPanel, currentMainPanel } from '../../workspace.js';

const handlers = new Map();

/**
 * 打开评论 / 反馈编辑面板。
 * @param {object} model 工作区模型
 * @param {object} spec
 *   - mode: 'comment' | 'feedback'
 *   - quote: 评论时引用的那段话（页面里的引用段）
 *   - prevQuote: 反馈时引用的「之前的引用」（上轮总结，没有就退回原任务正文）
 *   - taskLabel: 反馈时引用的任务编号（如「#123」）
 *   - taskTitle: 反馈时引用的任务标题（顶部展示）
 *   - src: 原文定位（{dirKey, task, name}）——点引用区在右侧并排打开原文（#107）
 *   - onSubmit(payload): 提交回调（{text, attachments, inserts}）
 *   - onFiles(files): 附件通道（面板默认自带，可覆盖）
 * @returns {string|null} token（面板按它取回回调）
 */
export function openComposer(model, spec = {}) {
  if (!model) return null;
  const {
    mode = 'comment', quote = '', prevQuote = '', taskLabel = '', taskTitle = '',
    src = null, onSubmit = null, onFiles = null,
  } = spec;
  const token = 'cmp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // 记住主区**来源面板**（主区是单面板位：这块评论页会把任务页顶掉，
  // 关掉它必须把任务页放回去，否则主区空掉只剩侧边栏——#106 验收反馈）
  const prev = currentMainPanel(model);
  handlers.set(token, { onSubmit, onFiles, prev });
  openPanel(model, {
    component: 'compose',
    name: mode === 'feedback' ? '反馈' : '评论',
    config: { token, mode, quote, prevQuote, taskLabel, taskTitle, src },
    location: 'center',
  });
  return token;
}

/**
 * 关闭 / 提交后的收尾：销号 + 把**来源面板**放回主区。
 *
 * 放回用 openPanel：主区分支是「先加后清」（加新的 → 清别的），所以主区
 * 不会出现空 tabset 被 FlexLayout 自动删掉的空窗（#106）。
 * 主区若已经是别的面板（例如反馈提交后自动打开了新任务页）→ 不抢。
 */
export function restoreComposerSource(model, token) {
  const h = handlers.get(token);
  handlers.delete(token);
  if (!h || !h.prev || !model) return null;
  const cur = currentMainPanel(model);
  if (cur && cur.component !== 'compose') return null;
  return openPanel(model, h.prev);
}

/** 面板侧取回登记的回调（token 失效/已销号时返回 null） */
export function composerOf(token) {
  return handlers.get(token) || null;
}
