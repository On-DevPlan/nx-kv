// MD 工作台两个编辑器（实时预览 / 源码）共用的小助手与静态表。
// 纯展示层逻辑：不持状态（useDropFiles 除外——它是拖放态的最小封装）。
import { useState } from 'react';
import { filesFromDataTransfer } from '../../modules/md/md-edit-ops.js';
import { liveBodyBlocks, normalizeBlockText, renderMarkdownHtml } from '../../modules/md/md-parse.js';

// 格式快捷键 → 编辑操作（预览态划选后直接套用）
export const FMT_KEYS = { b: 'bold', i: 'italic', e: 'code', k: 'link' };

/** 正文里已经自带 `# 标题` 了吗（跳过 frontmatter）——阅读态据此决定要不要再画题头 */
export function bodyHasH1(body) {
  let t = String(body || '').replace(/^\uFEFF/, '').trimStart();
  if (t.startsWith('---')) {
    const end = t.indexOf('\n---', 3);
    if (end > 0) t = t.slice(end + 4).trimStart();
  }
  return /^#[ \t]+\S/.test(t);
}

export function autoSize(el) {
  if (!el) return;
  el.style.height = '0px';
  // 高度交给内容本身（scrollHeight = 行数 × 行高）——原来写死最小 28px，
  // 比一行标题（16px × 1.35 ≈ 21.6px）还高：点进标题块就凭空多出 6px，
  // 下方内容跟着抖（2026-11-04 任务 #31）。
  el.style.height = `${el.scrollHeight}px`;
}

export function blockHtml(text, attachments) {
  const raw = normalizeBlockText(text);
  if (!raw.trim()) return '';
  // 只传**图片**（v1 草稿按名字内嵌的 imgMap 只认图片）：文件附件不能整表
  // 下发——本函数是**逐块**调用的，renderMarkdownHtml 会把文件附件拼成 chip
  // 附在每个块末尾，拖一个 md 进来就是「每一行都显示」（#118）。
  const imgs = (attachments || []).filter((a) => a?.type === 'image');
  return renderMarkdownHtml(raw, imgs).replace(
    /<p class="mdw-empty">[\s\S]*?<\/p>/g,
    ''
  );
}

/** 块类型 → 编辑态字号贴近渲染（避免「输入框感」） */
export function blockKind(text) {
  const t = String(text || '');
  // frontmatter 块：预览态渲染成属性卡（renderMarkdownHtml），编辑态等宽小字
  if (/^---\s*$/.test(t.split('\n', 1)[0] || '') && t.includes('\n')) return 'fm';
  if (/^#\s/m.test(t) && !/^##/m.test(t)) return 'h1';
  if (/^##\s/m.test(t) && !/^###/m.test(t)) return 'h2';
  if (/^###\s/m.test(t)) return 'h3';
  if (/^[-*]\s/m.test(t)) return 'li';
  if (/^>\s/m.test(t)) return 'quote';
  return 'p';
}

/** 正文块：剥掉首个一级标题行（= 文档标题，由顶部标题栏单独编辑，提交时再写入） */
export function bodyBlocksOnly(body) {
  return liveBodyBlocks(body);
}

/**
 * 拖文件进编辑区的通用交互：进入/悬停/离开维护 is-drop 高亮，落下时把文件交给
 * onDropFiles。skipPrevented：源码态外层容器要跳过已被 textarea 自己消费过的
 * drop（preventDefault 后事件才冒泡上来）——不查会把一次拖放传两遍（#118）。
 */
export function useDropFiles({ baseClass, skipPrevented = false, onDropFiles }) {
  const [dragging, setDragging] = useState(false);
  const rootProps = {
    className: `${baseClass}${dragging ? ' is-drop' : ''}`,
    onDragEnter: (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragOver: (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
    },
    onDrop: (e) => {
      setDragging(false);
      if (skipPrevented && e.defaultPrevented) return;
      const files = filesFromDataTransfer(e.dataTransfer);
      if (!files.length) return;
      e.preventDefault();
      onDropFiles(files, e);
    },
  };
  return { dragging, rootProps };
}
