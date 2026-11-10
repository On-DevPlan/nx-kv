// 单块：未聚焦渲染，聚焦时无描边源码；行首 `/` 出命令。
// 点击语义（复选框切换 / 划选礼让 / 进编辑）由父组件的 onViewClick 决定——
// 那部分是结构钉测试锚定的行为，留在 md-panes.jsx。
import { useLayoutEffect, useRef } from 'react';
import { filesFromDataTransfer, runFormat } from '../../modules/md/md-edit-ops.js';
import { isEmptyBlock, isFrontmatterBlock, normalizeBlockText } from '../../modules/md/md-parse.js';
import { autoSize, blockHtml, blockKind } from './md-panes-helpers.js';

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
}) {
  const taRef = useRef(null);
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

  if (focused) {
    return (
      <div className={`mdw-lp-block is-edit kind-${kind}`} data-i={index}>
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
      className={`mdw-lp-block is-view kind-${kind}${isEmptyBlock(text) ? ' is-empty' : ''}${hit ? ' is-hit' : ''}`}
      data-i={index}
      role="button"
      tabIndex={0}
      onClick={(e) => onViewClick(e, index)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFocus(index);
        }
      }}
    >
      {html ? (
        <div className="mdw-lp-view" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="mdw-lp-gap" />
      )}
    </div>
  );
}
