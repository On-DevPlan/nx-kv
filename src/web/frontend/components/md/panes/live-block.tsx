// 单块：未聚焦渲染，聚焦时无描边源码；行首 `/` 出命令。
// 点击语义（复选框切换 / 划选礼让 / 进编辑）由父组件的 onViewClick 决定——
// 那部分是结构钉测试锚定的行为，留在 md-panes.jsx。
import { useLayoutEffect, useRef } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import { filesFromDataTransfer, runFormat } from '../../../modules/md/md-edit-ops.js';
import { isEmptyBlock, normalizeBlockText } from '../../../modules/md/md-parse.js';
import { autoSize, blockHtml, blockKind } from './md-panes-helpers.js';
import type { PendingSel } from './md-panes-helpers.js';
import type { Attachment } from '../attachments/attach-common.js';

interface LiveBlockProps {
  index: number;
  text: string;
  focused: boolean;
  hit: boolean;
  onFocus: (index: number) => void;
  onViewClick: (e: ReactMouseEvent<HTMLDivElement>, index: number) => void;
  onChange: (v: string) => void;
  onBlur: () => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onPasteFiles?: ((files: File[], ta: HTMLTextAreaElement | null) => void) | null;
  onTaReady?: ((el: HTMLTextAreaElement) => void) | null;
  onTextSel?: ((sel: { text: string; x: number; y: number } | null) => void) | null;
  attachments?: Attachment[] | null;
  pendingSelRef?: { current: PendingSel | null } | null;
  pendingFormatRef?: { current: string | null } | null;
  /** 块侧栏（把手/插入钮），由父组件建好传进来——本组件只管挂到块容器里 */
  rail?: ReactNode;
  /** 拖拽落点指示：插到本块之前还是之后（null = 不是落点） */
  dropEdge?: 'before' | 'after' | null;
}

export default function LiveBlock({
  index,
  text,
  focused,
  hit,
  onFocus,
  onViewClick,
  onChange,
  onBlur,
  onKeyDown,
  onPasteFiles,
  onTaReady,
  onTextSel,
  attachments,
  pendingSelRef,
  pendingFormatRef,
  rail = null,
  dropEdge = null,
}: LiveBlockProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const display = normalizeBlockText(text);
  // #197：正文不再有 frontmatter 头（归属在库内关联）——FM 块渲染分支已删。
  const html = blockHtml(display, attachments);
  const kind = blockKind(display);

  useLayoutEffect(() => {
    if (!focused || !taRef.current) return;
    const el = taRef.current;
    onTaReady?.(el);
    autoSize(el);
    const pending = pendingSelRef?.current;
    if (pending && pending.index === index) {
      pendingSelRef.current = null;
      el.focus();
      try { el.setSelectionRange(pending.start, pending.end); } catch { /* ignore */ }
      // 预览态划选后按格式键：选区已就位，直接套用格式（Notion/Typora 行为）
      const op = pendingFormatRef?.current;
      if (op) {
        pendingFormatRef.current = null;
        const res = runFormat(el, op);
        if (res) onChange(res.value);
      }
      return;
    }
    if (document.activeElement !== el) {
      // @ 附件面板开着时焦点归它（#108）：别把焦点抢回 textarea——
      // 否则面板刚聚焦的搜索框立刻失焦，键盘输入落回正文。
      if (document.activeElement?.closest?.('.mdw-atpick')) return;
      el.focus();
      const n = el.value.length;
      try { el.setSelectionRange(n, n); } catch { /* ignore */ }
    }
  }, [focused, text, index, pendingSelRef, pendingFormatRef, onTaReady, onChange]);

  // 拖拽落点指示（拖拽排序时由父组件的列表级 dragover 算出）
  const dropCls = dropEdge ? ` is-drop-${dropEdge}` : '';

  if (focused) {
    return (
      <div className={`mdw-lp-block is-edit kind-${kind}${dropCls}`} data-i={index}>
        {rail}
        <textarea
          ref={taRef}
          className="mdw-lp-src"
          value={display}
          rows={1}
          spellCheck={false}
          aria-label="正文"
          placeholder="输入… Enter 新块 · 行首 / 命令"
          onChange={(e) => {
            onChange(e.target.value);
            autoSize(e.target);
          }}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = filesFromDataTransfer(e.clipboardData);
            if (!files.length) return;
            e.preventDefault();
            onPasteFiles?.(files, taRef.current);
          }}
          onMouseUp={(e) => {
            const ta = taRef.current;
            if (!ta || ta.selectionStart === ta.selectionEnd) return;
            const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
            if (!sel) return;
            onTextSel?.({
              text: sel,
              x: e.clientX - 80,
              y: e.clientY - 44,
            });
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`mdw-lp-block is-view kind-${kind}${isEmptyBlock(text) ? ' is-empty' : ''}${hit ? ' is-hit' : ''}${dropCls}`}
      data-i={index}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        onViewClick(e, index);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFocus(index);
        }
      }}
    >
      {rail}
      {html ? (
        <div className="mdw-lp-view" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="mdw-lp-gap" />
      )}
    </div>
  );
}
