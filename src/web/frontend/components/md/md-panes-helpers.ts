// MD 工作台两个编辑器（实时预览 / 源码）共用的小助手与静态表。
// 纯展示层逻辑：不持状态（useDropFiles 除外——它是拖放态的最小封装）。
import { useState } from 'react';
import type { DragEvent } from 'react';
import { filesFromDataTransfer } from '../../modules/md/md-edit-ops.js';
import { liveBodyBlocks, normalizeBlockText, renderMarkdownHtml } from '../../modules/md/md-parse.js';
import type { Attachment } from './attach-common.js';

// 格式快捷键 → 编辑操作（预览态划选后直接套用）
export const FMT_KEYS: Record<string, string> = { b: 'bold', i: 'italic', e: 'code', k: 'link' };

/** 待恢复的选区：切到编辑态后落到哪一块、块内哪一段。 */
export interface PendingSel {
  index: number;
  start: number;
  end: number;
}

/** 格式/结构操作的返回值（md-edit-ops 的纯函数出站形状）。 */
export interface EditOpResult {
  value: string;
  start: number;
  end: number;
}

/**
 * 编辑器对外命令面（页面通过 editorApiRef 调用）。
 *
 * 全部可选：实时预览与源码两个实现各自只提供自己支持的子集，调用方一律
 * `?.` 调用（任务页 / 模式快捷键都按能力探测）。
 */
export interface EditorApi {
  format?: (op: string) => void;
  turn?: (turnId: string) => void;
  focus?: () => void;
  openFind?: () => void;
  formatSelection?: (op: string) => boolean;
  caretFromDiff?: (prev: string, next: string) => void;
  insertAtCursor?: (text: string) => void;
  getCursor?: () => number | null;
  toggleWrap?: () => void;
  getWrap?: () => boolean;
  deleteBlockRange?: (lo: number, hi: number) => boolean;
}

/**
 * 粘贴 / 拖图片进正文时随文件带出的落点上下文（两个编辑器口径不同）：
 * live 是「第几块 + 块内偏移」，源码是「全文偏移」。
 */
export interface FileDropCtx {
  mode?: string;
  focusIndex?: number | null;
  caretInBlock?: number | null;
  insertAt?: number | null;
}

/**
 * md-render 仍是 JS 模块：默认值 `attachments = []` 让参数类型退化成 never[]，
 * 真实契约是「附件条目数组」。这里按实际形状重新标注一次（唯一断言点）。
 */
const renderWithAttachments = renderMarkdownHtml as unknown as (
  src: string,
  attachments?: Attachment[],
  knownNames?: Record<string, string> | null,
) => string;

/** 正文里已经自带 `# 标题` 了吗（跳过 frontmatter）——阅读态据此决定要不要再画题头 */
export function bodyHasH1(body: string) {
  let t = String(body || '').replace(/^\uFEFF/, '').trimStart();
  if (t.startsWith('---')) {
    const end = t.indexOf('\n---', 3);
    if (end > 0) t = t.slice(end + 4).trimStart();
  }
  return /^#[ \t]+\S/.test(t);
}

export function autoSize(el: HTMLTextAreaElement | null | undefined) {
  if (!el) return;
  el.style.height = '0px';
  // 高度交给内容本身（scrollHeight = 行数 × 行高）——原来写死最小 28px，
  // 比一行标题（16px × 1.35 ≈ 21.6px）还高：点进标题块就凭空多出 6px，
  // 下方内容跟着抖（2026-11-04 任务 #31）。
  el.style.height = `${el.scrollHeight}px`;
}

export function blockHtml(text: string, attachments?: Attachment[] | null) {
  const raw = normalizeBlockText(text);
  if (!raw.trim()) return '';
  // 只传**图片**（v1 草稿按名字内嵌的 imgMap 只认图片）：文件附件不能整表
  // 下发——本函数是**逐块**调用的，renderMarkdownHtml 会把文件附件拼成 chip
  // 附在每个块末尾，拖一个 md 进来就是「每一行都显示」（#118）。
  const imgs = (attachments || []).filter((a) => a?.type === 'image');
  // #168：ref 条目也传下去——只用来把 `nxkv://ref/<id>` 的显示名换成**文档标题**
  // （渲染层只查标题表，不产生任何 chip，逐块下发是安全的）。
  const refs = (attachments || []).filter((a) => a?.kind === 'ref');
  return renderWithAttachments(raw, [...imgs, ...refs]).replace(
    /<p class="mdw-empty">[\s\S]*?<\/p>/g,
    ''
  );
}

/** 块类型 → 编辑态字号贴近渲染（避免「输入框感」） */
export function blockKind(text: string) {
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
export function bodyBlocksOnly(body: string): string[] {
  return liveBodyBlocks(body);
}

/** useDropFiles 的返回面：直接展开到容器上的拖放属性。 */
export interface DropRootProps {
  className: string;
  onDragEnter: (e: DragEvent<HTMLElement>) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

/**
 * 拖文件进编辑区的通用交互：进入/悬停/离开维护 is-drop 高亮，落下时把文件交给
 * onDropFiles。skipPrevented：源码态外层容器要跳过已被 textarea 自己消费过的
 * drop（preventDefault 后事件才冒泡上来）——不查会把一次拖放传两遍（#118）。
 */
export function useDropFiles({ baseClass, skipPrevented = false, onDropFiles }: {
  baseClass: string;
  skipPrevented?: boolean;
  onDropFiles: (files: File[], e: DragEvent<HTMLElement>) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const rootProps: DropRootProps = {
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
      // DOM 事件边界：relatedTarget 声明为 EventTarget，contains 需要 Node
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
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
