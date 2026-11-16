// 单块：未聚焦渲染，聚焦时无描边源码；行首 `/` 出命令。
// 点击语义（复选框切换 / 划选礼让 / 进编辑）由父组件的 onViewClick 决定——
// 那部分是结构钉测试锚定的行为，留在 md-panes.jsx。
import { useLayoutEffect, useRef } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import { filesFromDataTransfer, runFormat } from '../../modules/md/md-edit-ops.js';
import { isEmptyBlock, isFrontmatterBlock, normalizeBlockText } from '../../modules/md/md-parse.js';
import { autoSize, blockHtml, blockKind } from './md-panes-helpers.js';
import type { PendingSel } from './md-panes-helpers.js';
import type { Attachment } from './attach-common.js';

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
  /** 模板骨架块：只读（点击不进编辑、不渲染把手）。由 template-locks 派生。 */
  locked?: boolean;
  /** 模板插槽块：可编辑，但加视觉标记（这里是要填内容的地方）。 */
  slot?: boolean;
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
  locked = false,
  slot = false,
}: LiveBlockProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const display = normalizeBlockText(text);
  // frontmatter 块**整体不渲染**（#149）：#113 起视图态已渲染为空，但块本身还在——
  // 点它/聚焦它仍会开出裸 YAML 编辑框（组草稿首块的 `---\nboard:…\n---` 让人莫名，
  // 用户原话「删除这个frontmatter」）。归属语义有页头「归属项目」下拉编辑，
  // 源码模式仍可见可改；这里只动渲染层——块数组里 FM 必须保留（commit 按块列表
  // 整表回写正文，滤掉会把组语义删没），data-i 坐标也不变（ack 定位轨/块选区共用）。
  // ⚠️ 早退必须放在所有 hooks 之后（Rules of Hooks）。
  const isFm = isFrontmatterBlock(display);
  const html = isFm ? '' : blockHtml(display, attachments);
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

  if (isFm) return null;

  // 拖拽落点指示（拖拽排序时由父组件的列表级 dragover 算出）
  const dropCls = dropEdge ? ` is-drop-${dropEdge}` : '';

  if (focused && !locked) {
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
      className={`mdw-lp-block is-view kind-${kind}${isEmptyBlock(text) ? ' is-empty' : ''}${hit ? ' is-hit' : ''}${dropCls}${locked ? ' is-locked' : ''}${slot ? ' is-slot' : ''}`}
      data-i={index}
      role="button"
      tabIndex={locked ? -1 : 0}
      aria-readonly={locked || undefined}
      title={locked ? '模板骨架：只读（要改这段，请去任务模板里改）' : undefined}
      onClick={(e) => {
        // 模板骨架块不可进编辑态：点击不再冒泡到「聚焦」逻辑（勾选框也不响应）
        if (locked) return;
        onViewClick(e, index);
      }}
      onKeyDown={(e) => {
        if (locked) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFocus(index);
        }
      }}
    >
      {locked ? null : rail}
      {locked && <span className="mdw-lp-lock" aria-hidden>模板</span>}
      {slot && <span className="mdw-lp-slot" aria-hidden>插槽</span>}
      {html ? (
        <div className="mdw-lp-view" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="mdw-lp-gap" />
      )}
    </div>
  );
}
