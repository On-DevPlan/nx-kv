// @ 附件引用的纯逻辑（#108）——触发点判定 + 引用语法生成。
//
// 放 .js 而不是 .jsx：node 单测能直接 import（.jsx 加载不了）。
// 面板组件（components/md/attach-picker.jsx）只做交互。
import { embedMarkdown } from '../../../../shared/attach.js';

/**
 * @ 触发点：光标前一个字符是 '@'，且前一位不是 ASCII 词字符（避免邮箱/句中误触）。
 * 中文不受限——中文里 @ 常直接跟在文字后。
 * @param {{value:string, selectionStart:number, selectionEnd:number}} ta
 * @returns {{at:number, caret:number}|null} at = '@' 的位置，caret = 光标位置
 */
export function atTriggerAt(ta) {
  if (!ta) return null;
  const s = ta.selectionStart;
  if (s !== ta.selectionEnd || s <= 0) return null;
  const v = ta.value || '';
  if (v[s - 1] !== '@') return null;
  const prev = s >= 2 ? v[s - 2] : '';
  if (/[A-Za-z0-9_]/.test(prev)) return null;
  return { at: s - 1, caret: s };
}

/**
 * 附件 → 正文引用语法（与 shared/attach.js 的 embedMarkdown 同一口径）：
 * 图片 ![名](fileId)、文件 [名](fileId)、URL [名](url)、
 * 任务/文档引用 [名](nxkv://task/<id> | nxkv://ref/<id>)。
 * @param {object} a 归一化后的附件（attach-common.normAttachment）
 */
export function embedForAttachment(a) {
  if (!a) return '';
  const name = String(a.name || a.title || a.locator || '附件').replace(/[[\]]/g, '');
  if (a.kind === 'image' || a.isImage) return embedMarkdown({ name, id: a.id, kind: 'image' });
  if (a.kind === 'file') return embedMarkdown({ name, id: a.id, kind: 'file' });
  if (a.kind === 'url') {
    const u = a.url || a.href || '';
    return u ? `[${name}](${u})` : '';
  }
  if (a.kind === 'task') {
    const tid = a.taskId || '';
    return tid ? `[${name}](nxkv://task/${tid})` : (a.href ? `[${name}](${a.href})` : '');
  }
  if (a.kind === 'ref') {
    const rid = a.refId || '';
    return rid ? `[${name}](nxkv://ref/${rid})` : (a.href ? `[${name}](${a.href})` : '');
  }
  return '';
}

/**
 * 引用与正文之间补空格（#111：「@ 的语法前后隔一空」）——
 * 贴着中文或相邻字符会黏连，markdown 行内元素需要边界。
 * @returns {{text:string, caretAt:number}} text = 带补位的插入串；caretAt = 插入后光标相对起点
 */
export function padEmbed(embed, beforeCh, afterCh) {
  const pre = beforeCh && !/\s/.test(beforeCh) ? ' ' : '';
  const post = afterCh && !/\s/.test(afterCh) ? ' ' : '';
  return { text: pre + embed + post, caretAt: pre.length + embed.length + post.length };
}
