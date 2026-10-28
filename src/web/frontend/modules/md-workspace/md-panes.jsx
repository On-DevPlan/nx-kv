import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { joinMdBlocks, renderMarkdownHtml, splitMdBlocks } from './md-parse.js';

function autoSize(el) {
  if (!el) return;
  el.style.height = '0px';
  el.style.height = `${Math.max(el.scrollHeight, 28)}px`;
}

function blockHtml(text, attachments) {
  if (!String(text || '').trim()) return '';
  return renderMarkdownHtml(text, attachments).replace(
    /<p class="mdw-empty">[\s\S]*?<\/p>/g,
    ''
  );
}

/** 块类型 → 编辑态字号贴近渲染（避免「输入框感」） */
function blockKind(text) {
  const t = String(text || '');
  if (/^#\s/m.test(t) && !/^##/m.test(t)) return 'h1';
  if (/^##\s/m.test(t) && !/^###/m.test(t)) return 'h2';
  if (/^###\s/m.test(t)) return 'h3';
  if (/^[-*]\s/m.test(t)) return 'li';
  if (/^>\s/m.test(t)) return 'quote';
  return 'p';
}

/** 单块：未聚焦渲染，聚焦时无描边源码（Obsidian / Notion） */
function LiveBlock({
  index,
  text,
  focused,
  onFocus,
  onChange,
  onBlur,
  onKeyDown,
  attachments,
}) {
  const taRef = useRef(null);
  const html = blockHtml(text, attachments);
  const kind = blockKind(text);

  useLayoutEffect(() => {
    if (!focused || !taRef.current) return;
    const el = taRef.current;
    autoSize(el);
    if (document.activeElement !== el) {
      el.focus();
      const n = el.value.length;
      try { el.setSelectionRange(n, n); } catch { /* ignore */ }
    }
  }, [focused]);

  if (focused) {
    return (
      <div className={`mdw-lp-block is-edit kind-${kind}`} data-i={index}>
        <textarea
          ref={taRef}
          className="mdw-lp-src"
          value={text}
          rows={1}
          spellCheck={false}
          placeholder="输入…"
          onChange={(e) => {
            onChange(e.target.value);
            autoSize(e.target);
          }}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
      </div>
    );
  }

  return (
    <div
      className={`mdw-lp-block is-view kind-${kind}${text.trim() ? '' : ' is-empty'}`}
      data-i={index}
      onMouseUp={() => {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim()) return;
        onFocus(index);
      }}
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

/**
 * 单栏实时预览：阅读态渲染 + 点击块就地改源码。
 * 无双栏、无高亮描边块。
 */
/** 正文块：剥掉一级标题行（由顶部标题栏单独编辑，提交时再写入） */
function bodyBlocksOnly(body) {
  return splitMdBlocks(body).filter(
    (b) => !/^# (?!#)/.test(String(b).trim()) || String(b).includes('\n')
  );
}

function LivePreview({ title, body, onTitle, onBody, articleRef, attachments, docKey }) {
  const [focus, setFocus] = useState(null);
  const blocks = bodyBlocksOnly(body);
  useEffect(() => { setFocus(null); }, [docKey]);

  // 实时预览不把标题写回正文；composeBody 提交时再拼 `# title`
  const commit = (nextBlocks) => onBody(joinMdBlocks(nextBlocks));

  const updateAt = (i, v) => {
    const next = blocks.slice();
    next[i] = v;
    commit(next);
  };

  const splitAfter = (i, cur) => {
    const next = blocks.slice();
    next[i] = cur;
    next.splice(i + 1, 0, '');
    commit(next);
    setFocus(i + 1);
  };

  const onKeyDown = (i, e) => {
    const val = blocks[i] ?? '';
    if (e.key === 'Escape') {
      e.preventDefault();
      e.target.blur();
      setFocus(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const ta = e.target;
      const atEnd = ta.selectionStart === val.length;
      const singleLine = !val.includes('\n');
      const endsBlank = /\n$/.test(val) || val === '';
      // 单行块（标题等）末尾 Enter → 新段；多行末空行 / ⌘Enter 同
      if (e.metaKey || e.ctrlKey || (atEnd && (endsBlank || singleLine))) {
        e.preventDefault();
        splitAfter(i, val.replace(/\n+$/, ''));
        return;
      }
    }
    if (e.key === 'Backspace' && val === '' && blocks.length > 1) {
      e.preventDefault();
      const next = blocks.slice();
      next.splice(i, 1);
      commit(next);
      setFocus(Math.max(0, i - 1));
    }
    if (e.key === 'ArrowUp' && e.target.selectionStart === 0 && i > 0) {
      e.preventDefault();
      setFocus(i - 1);
    }
    if (
      e.key === 'ArrowDown'
      && e.target.selectionStart === val.length
      && i < blocks.length - 1
    ) {
      e.preventDefault();
      setFocus(i + 1);
    }
  };

  return (
    <div className="mdw-lp">
      <div className="mdw-lp-sheet" ref={articleRef}>
        <input
          className="mdw-lp-title"
          value={title}
          placeholder="无标题"
          onChange={(e) => onTitle(e.target.value)}
          onFocus={() => setFocus(null)}
        />
        <div className="mdw-lp-blocks">
          {blocks.map((b, i) => (
            <LiveBlock
              key={`${docKey}-${i}`}
              index={i}
              text={b}
              focused={focus === i}
              attachments={attachments}
              onFocus={setFocus}
              onChange={(v) => updateAt(i, v)}
              onBlur={() => {
                requestAnimationFrame(() => {
                  if (document.activeElement?.closest?.('.mdw-lp-block.is-edit')) return;
                  setFocus(null);
                });
              }}
              onKeyDown={(e) => onKeyDown(i, e)}
            />
          ))}
        </div>
        <button
          type="button"
          className="mdw-lp-add"
          aria-label="继续输入"
          onClick={() => {
            commit([...blocks, '']);
            setFocus(blocks.length);
          }}
        />
      </div>
    </div>
  );
}

/** 实时预览 / 源码 / 阅读 */
export const MdPanes = forwardRef(function MdPanes(
  {
    mode,
    title,
    body,
    previewHtml,
    onTitle,
    onBody,
    attachments = [],
    docKey = 'draft',
  },
  articleRef
) {
  if (mode === 'split') {
    return (
      <div className="mdw-split mode-split live">
        <LivePreview
          title={title}
          body={body}
          onTitle={onTitle}
          onBody={onBody}
          articleRef={articleRef}
          attachments={attachments}
          docKey={docKey}
        />
      </div>
    );
  }

  return (
    <div className={`mdw-split mode-${mode}`}>
      {mode === 'edit' && (
        <div className="mdw-pane mdw-pane-edit">
          <input
            className="mdw-title-input"
            value={title}
            placeholder="任务标题"
            onChange={(e) => onTitle(e.target.value)}
          />
          <textarea
            className="mdw-editor"
            value={body}
            spellCheck={false}
            placeholder="用 Markdown 写任务——背景、验收、约束。"
            onChange={(e) => onBody(e.target.value)}
          />
        </div>
      )}
      {mode === 'preview' && (
        <div className="mdw-pane mdw-preview">
          <article ref={articleRef} dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      )}
    </div>
  );
});

const MODES = [
  { id: 'split', label: '实时预览' },
  { id: 'edit', label: '源码' },
  { id: 'preview', label: '阅读' },
];

export function ModeSeg({ mode, onChange }) {
  return (
    <div className="seg" role="tablist" aria-label="编辑模式">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          className={mode === m.id ? 'on' : ''}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
