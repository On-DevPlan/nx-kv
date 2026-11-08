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
import { openPanel } from '../../workspace.js';

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
 *   - onSubmit(payload): 提交回调（{text, attachments, inserts}）
 *   - onFiles(files): 附件通道（面板默认自带，可覆盖）
 * @returns {string|null} token（面板按它取回回调）
 */
export function openComposer(model, spec = {}) {
  if (!model) return null;
  const {
    mode = 'comment', quote = '', prevQuote = '', taskLabel = '', taskTitle = '',
    onSubmit = null, onFiles = null,
  } = spec;
  const token = 'cmp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  handlers.set(token, { onSubmit, onFiles });
  openPanel(model, {
    component: 'compose',
    name: mode === 'feedback' ? '反馈' : '评论',
    config: { token, mode, quote, prevQuote, taskLabel, taskTitle },
    location: 'center',
  });
  return token;
}

/** 面板侧取回登记的回调（token 失效/已销号时返回 null） */
export function composerOf(token) {
  return handlers.get(token) || null;
}

/** 面板关闭 / 提交后销号 */
export function closeComposer(token) {
  handlers.delete(token);
}
