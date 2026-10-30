import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  isEmptyBlock,
  joinMdBlocks,
  normalizeBlockText,
  renderMarkdownHtml,
  splitMdBlocks,
} from './md-parse.js';
import {
  applySlashCommand,
  caretLineCol,
  continueListOnEnter,
  countStats,
  diffIndex,
  filterSlashCmds,
  findMatches,
  imageFilesFromDataTransfer,
  indentLines,
  insertTextAtCursor,
  runFormat,
  scrollTextareaToIndex,
  slashQueryAt,
  turnBlock,
  turnLine,
} from './md-edit-ops.js';

function autoSize(el) {
  if (!el) return;
  el.style.height = '0px';
  el.style.height = `${Math.max(el.scrollHeight, 28)}px`;
}

function blockHtml(text, attachments) {
  const raw = normalizeBlockText(text);
  if (!raw.trim()) return '';
  return renderMarkdownHtml(raw, attachments).replace(
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

/** 单块：未聚焦渲染，聚焦时无描边源码；行首 `/` 出命令 */
function LiveBlock({
  index,
  text,
  focused,
  hit,
  onFocus,
  onChange,
  onBlur,
  onKeyDown,
  onPasteFiles,
  onTaReady,
  onTextSel,
  onInsertSlash,
  attachments,
  pendingSelRef,
}) {
  const taRef = useRef(null);
  const display = normalizeBlockText(text);
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
      return;
    }
    if (document.activeElement !== el) {
      el.focus();
      const n = el.value.length;
      try { el.setSelectionRange(n, n); } catch { /* ignore */ }
    }
  }, [focused, text, index, pendingSelRef, onTaReady]);

  if (focused) {
    return (
      <div className={`mdw-lp-block is-edit kind-${kind}`} data-i={index}>
        <button
          type="button"
          className="mdw-lp-grip"
          title="插入 / 命令"
          aria-label="插入斜杠命令"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onInsertSlash?.(index, taRef.current);
          }}
        >
          ⋮⋮
        </button>
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
            const files = imageFilesFromDataTransfer(e.clipboardData);
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
      onClick={() => onFocus(index)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFocus(index);
        }
      }}
    >
      <button
        type="button"
        className="mdw-lp-grip"
        title="编辑并插入 /"
        aria-label="编辑并插入斜杠命令"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          onInsertSlash?.(index, null);
        }}
      >
        ⋮⋮
      </button>
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

function isSlashArrow(e) {
  return e.key === 'ArrowDown' || e.key === 'ArrowUp'
    || e.code === 'ArrowDown' || e.code === 'ArrowUp';
}

function slashActiveIndex(s) {
  if (!s?.items?.length) return 0;
  const a = s.active;
  if (typeof a !== 'number' || Number.isNaN(a)) return 0;
  return Math.min(Math.max(0, a), s.items.length - 1);
}

/** 斜杠菜单键盘：返回 true 表示已处理 */
function handleSlashKey(e, slashRef, { move, pick, close }) {
  const cur = slashRef.current;
  if (!cur?.items?.length) return false;
  if (isSlashArrow(e)) {
    e.preventDefault();
    e.stopPropagation();
    move(e.key === 'ArrowUp' || e.code === 'ArrowUp' ? -1 : 1);
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    e.stopPropagation();
    pick(cur.items[slashActiveIndex(cur)]);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    close();
    return true;
  }
  return false;
}

function SlashMenu({ items, active, onPick, onHover, style }) {
  const listRef = useRef(null);
  const sel = slashActiveIndex({ items, active });
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector('.mdw-slash-item.on');
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [sel, items]);
  if (!items.length) return null;
  return (
    <div
      ref={listRef}
      className="mdw-slash"
      role="listbox"
      aria-activedescendant={`mdw-slash-opt-${sel}`}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="mdw-slash-cap">插入 · ↑↓ 选择 · Enter 确认</div>
      {items.map((c, i) => (
        <button
          key={c.id}
          id={`mdw-slash-opt-${i}`}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={i === sel}
          className={`mdw-slash-item${i === sel ? ' on' : ''}`}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(c);
          }}
        >
          <span className="lab">{c.label}</span>
          <span className="hint">{c.hint}</span>
        </button>
      ))}
    </div>
  );
}

// 标题输入：自动增高 textarea —— input 不能软换行，长标题会横向溢出（UIUX E1）。
// 标题在语义上仍是单条逻辑行：Enter 不产生换行，把焦点交给正文。
function TitleArea({ value, onTitle, placeholder, className, onFocus, onEnter }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [value]);
  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      placeholder={placeholder}
      rows={1}
      spellCheck={false}
      aria-label="标题"
      onChange={(e) => onTitle(e.target.value, 'typing')}
      onFocus={onFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter?.();
        }
      }}
    />
  );
}

function LivePreview({
  title, body, onTitle, onBody, articleRef, attachments, docKey, onFiles, editorApiRef, onTextSel,
}) {
  const [focus, setFocus] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [slash, setSlash] = useState(null); // { index, query, items, active, x, y }
  const pendingSelRef = useRef(null);
  const liveTaRef = useRef(null); // 当前聚焦块的 textarea
  const slashRef = useRef(null);
  const slashRafRef = useRef(0);
  const blocks = bodyBlocksOnly(body);
  // 实时预览查找：块级匹配 + 命中块高亮 + 滚动定位（阅读态此前无查找能力）
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIdx, setFindIdx] = useState(0);
  const findInputRef = useRef(null);
  const liveMatches = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    blocks.forEach((b, i) => {
      const t = String(b ?? '').toLowerCase();
      let pos = t.indexOf(q);
      while (pos !== -1) {
        out.push({ block: i, start: pos });
        pos = t.indexOf(q, pos + q.length);
      }
    });
    return out;
  }, [blocks, findQuery]);
  const jumpLive = (i) => {
    const total = liveMatches.length;
    if (!total) return;
    const n = ((i % total) + total) % total;
    setFindIdx(n);
    const m = liveMatches[n];
    const el = articleRef.current?.querySelector(`.mdw-lp-block[data-i="${m.block}"]`);
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };
  const hitBlock = liveMatches[findIdx]?.block ?? -1;
  // 空文档：splitMdBlocks('') 会给 ['']，视觉上是一片没有把手的空白——
  // 用幽灵引导条接住第一次点击（聚焦首块），聚焦后让位给 textarea 占位符
  const emptyDoc = blocks.length === 0 || blocks.every((b) => !String(b).trim());
  const setSlashBoth = (next) => {
    const v = typeof next === 'function' ? next(slashRef.current) : next;
    slashRef.current = v;
    setSlash(v);
  };

  useEffect(() => { setFocus(null); setSlashBoth(null); }, [docKey]);
  useEffect(() => { slashRef.current = slash; }, [slash]);

  // 实时预览不把标题写回正文；composeBody 提交时再拼 `# title`
  // kind：'typing' 连续输入（历史合并成一条）· 'op' 格式/结构操作（各自成条）
  const commit = (nextBlocks, kind = 'op') => onBody(joinMdBlocks(nextBlocks), kind);

  const updateAt = (i, v, kind = 'op') => {
    const next = blocks.slice();
    next[i] = v;
    commit(next, kind);
  };

  const applyBlockOp = (i, opResult) => {
    if (!opResult) return;
    pendingSelRef.current = { index: i, start: opResult.start, end: opResult.end };
    updateAt(i, opResult.value);
  };

  const refreshSlash = (i, ta) => {
    const hit = slashQueryAt(ta);
    if (!hit) {
      setSlashBoth(null);
      return;
    }
    const items = filterSlashCmds(hit.query);
    if (!items.length) {
      setSlashBoth(null);
      return;
    }
    const rect = ta.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 220, rect.left);
    const y = Math.min(window.innerHeight - 220, rect.bottom + 4);
    setSlashBoth((prev) => {
      const keep = prev && prev.index === i && prev.query === hit.query;
      const active = keep ? slashActiveIndex({ ...prev, items }) : 0;
      return { index: i, query: hit.query, items, active, x, y };
    });
  };

  const moveSlash = (delta) => {
    setSlashBoth((s) => {
      if (!s?.items?.length) return s;
      const n = s.items.length;
      const cur = slashActiveIndex(s);
      return { ...s, active: (cur + delta + n) % n };
    });
  };

  const pickSlash = (cmd) => {
    const ta = liveTaRef.current;
    const cur = slashRef.current;
    const idx = cur?.index ?? focus;
    if (!ta || idx == null || !cmd) return;
    const next = applySlashCommand(ta, cmd);
    setSlashBoth(null);
    if (next) applyBlockOp(idx, next);
  };

  /** ⋮⋮：聚焦块并在行首插入 `/` 打开命令菜单 */
  const insertSlash = (index, ta) => {
    setFocus(index);
    const raw = normalizeBlockText(blocks[index] ?? '');
    const apply = (el) => {
      if (!el) return;
      liveTaRef.current = el;
      const s = el.selectionStart;
      const lineStart = el.value.lastIndexOf('\n', s - 1) + 1;
      const next = `${el.value.slice(0, lineStart)}/${el.value.slice(lineStart)}`;
      const caret = lineStart + 1;
      applyBlockOp(index, { value: next, start: caret, end: caret });
      requestAnimationFrame(() => {
        const t = liveTaRef.current;
        if (t) refreshSlash(index, t);
      });
    };
    if (ta) {
      apply(ta);
      return;
    }
    pendingSelRef.current = { index, start: 0, end: 0 };
    requestAnimationFrame(() => {
      const el = liveTaRef.current;
      if (!el) {
        applyBlockOp(index, { value: `/${raw}`, start: 1, end: 1 });
        requestAnimationFrame(() => {
          if (liveTaRef.current) refreshSlash(index, liveTaRef.current);
        });
        return;
      }
      apply(el);
    });
  };

  const applyTurn = (index, turnId) => {
    const ta = liveTaRef.current;
    const fake = ta && focus === index
      ? ta
      : { value: normalizeBlockText(blocks[index] ?? ''), selectionStart: 0, selectionEnd: 0 };
    const next = turnBlock(fake, turnId);
    if (next) {
      applyBlockOp(index, next);
      setFocus(index);
    }
  };

  useImperativeHandle(editorApiRef, () => ({
    format(op) {
      const ta = liveTaRef.current;
      if (!ta || focus == null) return;
      ta.focus();
      applyBlockOp(focus, runFormat(ta, op));
    },
    turn(turnId) {
      const i = focus ?? 0;
      applyTurn(i, turnId);
    },
    focus() {
      liveTaRef.current?.focus();
    },
    openFind() {
      setFindOpen(true);
      requestAnimationFrame(() => findInputRef.current?.focus());
    },
    /** 撤销/重做后把光标放回改动处：把正文偏移换算到具体块与块内偏移 */
    caretFromDiff(prev, next) {
      const prevJ = joinMdBlocks(bodyBlocksOnly(prev));
      const nextJ = joinMdBlocks(bodyBlocksOnly(next));
      const idx = diffIndex(prevJ, nextJ);
      let start = 0;
      for (let i = 0; i < blocks.length; i += 1) {
        // 用真实 joiner 累加，块边界与正文偏移严格对齐（连接符 '\n\n'）
        const end = joinMdBlocks(blocks.slice(0, i + 1)).length;
        if (idx <= end) {
          const off = Math.max(0, Math.min(idx - start, normalizeBlockText(blocks[i] ?? '').length));
          if (focus === i) {
            const ta = liveTaRef.current;
            if (ta) {
              ta.focus();
              ta.setSelectionRange(off, off);
            }
          } else {
            pendingSelRef.current = { index: i, start: off, end: off };
            setFocus(i);
          }
          return;
        }
        start = end + 2;
      }
    },
  }), [focus, onBody, blocks]);

  // document 捕获：即使焦点异常也能 ↑↓
  useEffect(() => {
    if (!slash) return undefined;
    const onKey = (e) => {
      handleSlashKey(e, slashRef, {
        move: moveSlash,
        pick: pickSlash,
        close: () => setSlashBoth(null),
      });
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [slash]);

  const onKeyDown = (i, e) => {
    const val = normalizeBlockText(blocks[i] ?? '');
    const ta = e.target;
    liveTaRef.current = ta;

    // 优先处理斜杠菜单（用 ref，避免闭包里 slash 过期）
    if (handleSlashKey(e, slashRef, {
      move: moveSlash,
      pick: pickSlash,
      close: () => setSlashBoth(null),
    })) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      setSlashBoth(null);
      ta.blur();
      setFocus(null);
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      const map = { b: 'bold', i: 'italic', e: 'code', k: 'link' };
      if (map[k]) {
        e.preventDefault();
        applyBlockOp(i, runFormat(ta, map[k]));
        return;
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      applyBlockOp(i, indentLines(ta, e.shiftKey));
      return;
    }

    // Notion：Enter = 在光标处拆成新块；Shift+Enter = 块内软换行（放行默认）
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      const list = continueListOnEnter(ta);
      if (list) {
        e.preventDefault();
        applyBlockOp(i, list);
        return;
      }
      e.preventDefault();
      setSlashBoth(null);
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      const before = val.slice(0, s).replace(/\n+$/, '');
      const after = val.slice(en);
      const next = blocks.slice();
      next[i] = before;
      next.splice(i + 1, 0, after);
      pendingSelRef.current = { index: i + 1, start: 0, end: 0 };
      commit(next);
      setFocus(i + 1);
      return;
    }

    if (e.key === 'Backspace' && isEmptyBlock(val) && blocks.length > 1) {
      e.preventDefault();
      setSlashBoth(null);
      const next = blocks.slice();
      next.splice(i, 1);
      commit(next);
      setFocus(Math.max(0, i - 1));
      return;
    }
    // 斜杠菜单打开时禁止块间跳转（必须用 ref，避免闭包过期）
    if (slashRef.current) return;
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

  const ingestFiles = (files, ta) => {
    if (!files?.length || !onFiles) return;
    const at = ta ? ta.selectionStart : null;
    onFiles(files, { insertAt: at, mode: 'live', focusIndex: focus });
  };

  return (
    <div
      className={`mdw-lp${dragging ? ' is-drop' : ''}`}
      onDragEnter={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        const files = imageFilesFromDataTransfer(e.dataTransfer);
        if (!files.length) return;
        e.preventDefault();
        ingestFiles(files, null);
      }}
    >
      <div className="mdw-lp-sheet" ref={articleRef}>
        {findOpen && (
          <EditorFindBar
            query={findQuery}
            setQuery={(q) => {
              setFindQuery(q);
              setFindIdx(0);
            }}
            index={findIdx}
            total={liveMatches.length}
            onNext={() => jumpLive(findIdx + 1)}
            onPrev={() => jumpLive(findIdx - 1)}
            onClose={() => setFindOpen(false)}
            inputRef={findInputRef}
          />
        )}
        <TitleArea
          className="mdw-lp-title"
          value={title}
          placeholder="无标题"
          onTitle={onTitle}
          onFocus={() => { setFocus(null); setSlashBoth(null); }}
          onEnter={() => { if (blocks.length) setFocus(0); }}
        />
        <div className={`mdw-lp-blocks${emptyDoc ? ' is-empty-doc' : ''}`}>
          {blocks.map((b, i) => (
            <LiveBlock
              key={`${docKey}-${i}`}
              index={i}
              text={b}
              focused={focus === i}
              hit={hitBlock === i}
              attachments={attachments}
              pendingSelRef={pendingSelRef}
              onFocus={(idx) => {
                setFocus(idx);
                setSlashBoth(null);
              }}
              onTaReady={(el) => { liveTaRef.current = el; }}
              onChange={(v) => {
                updateAt(i, v, 'typing');
                cancelAnimationFrame(slashRafRef.current);
                slashRafRef.current = requestAnimationFrame(() => {
                  const ta = liveTaRef.current;
                  if (ta) refreshSlash(i, ta);
                });
              }}
              onBlur={() => {
                requestAnimationFrame(() => {
                  if (document.activeElement?.closest?.('.mdw-lp-block.is-edit')) return;
                  if (document.activeElement?.closest?.('.mdw-slash')) return;
                  setFocus(null);
                  setSlashBoth(null);
                });
              }}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPasteFiles={(files, ta) => ingestFiles(files, ta)}
              onTextSel={onTextSel}
              onInsertSlash={insertSlash}
            />
          ))}
        </div>
        {emptyDoc && focus === null ? (
          <button
            type="button"
            className="mdw-lp-add is-empty-hint"
            aria-label="开始输入"
            onClick={() => setFocus(0)}
          >
            <span className="mdw-lp-add-hint">输入正文，或键入 / 唤起命令…</span>
          </button>
        ) : (
          <button
            type="button"
            className="mdw-lp-add"
            aria-label="继续输入"
            onClick={() => {
              commit([...blocks, '']);
              setFocus(blocks.length);
            }}
          />
        )}
      </div>
      {slash && createPortal(
        <SlashMenu
          items={slash.items}
          active={slash.active}
          onHover={(n) => setSlashBoth((s) => s && ({ ...s, active: n }))}
          onPick={pickSlash}
          style={{ left: slash.x, top: slash.y }}
        />,
        document.body
      )}
    </div>
  );
}

function EditorFindBar({ query, setQuery, index, total, onNext, onPrev, onClose, inputRef }) {
  return (
    <div className="mdw-find" role="search">
      <input
        ref={inputRef}
        className="mdw-find-input"
        value={query}
        placeholder="查找…"
        aria-label="查找"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
          if (e.key === 'F3') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
        }}
      />
      <span className="mdw-find-count">
        {total ? `${index + 1}/${total}` : '无结果'}
      </span>
      <button type="button" className="mdw-find-nav" title="上一个" aria-label="上一个匹配" onClick={onPrev}>↑</button>
      <button type="button" className="mdw-find-nav" title="下一个" aria-label="下一个匹配" onClick={onNext}>↓</button>
      <button type="button" className="mdw-find-nav" title="关闭" aria-label="关闭查找" onClick={onClose}>×</button>
    </div>
  );
}

/** 源码编辑器：soft-wrap、行号、查找、格式 API、粘贴/拖图、行首 / */
function SourceEditor({ title, body, onTitle, onBody, editorApiRef, onFiles, onTextSel }) {
  const taRef = useRef(null);
  const gutterRef = useRef(null);
  const findInputRef = useRef(null);
  const pendingSel = useRef(null);
  const [wrap, setWrap] = useState(true);
  const [showLines, setShowLines] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIdx, setFindIdx] = useState(0);
  const [caret, setCaret] = useState({ line: 1, col: 1 });
  const [showRuler, setShowRuler] = useState(true);
  const [slash, setSlash] = useState(null);
  const slashRef = useRef(null);
  const slashRafRef = useRef(0);
  const stats = countStats(body);
  const matches = findMatches(body, findQuery);
  const setSlashBoth = (next) => {
    const v = typeof next === 'function' ? next(slashRef.current) : next;
    slashRef.current = v;
    setSlash(v);
  };
  useEffect(() => { slashRef.current = slash; }, [slash]);

  const syncCaret = () => {
    const ta = taRef.current;
    if (!ta) return;
    setCaret(caretLineCol(ta.value, ta.selectionStart));
  };

  const refreshSlash = (ta) => {
    const hit = slashQueryAt(ta);
    if (!hit) {
      setSlashBoth(null);
      return;
    }
    const items = filterSlashCmds(hit.query);
    if (!items.length) {
      setSlashBoth(null);
      return;
    }
    const rect = ta.getBoundingClientRect();
    const lineH = 20;
    const line = caretLineCol(ta.value, ta.selectionStart).line;
    const x = Math.min(window.innerWidth - 220, rect.left + 12);
    const y = Math.min(window.innerHeight - 220, rect.top + line * lineH - ta.scrollTop + 8);
    setSlashBoth((prev) => {
      const keep = prev && prev.query === hit.query;
      const active = keep ? slashActiveIndex({ ...prev, items }) : 0;
      return { query: hit.query, items, active, x, y };
    });
  };

  const moveSlash = (delta) => {
    setSlashBoth((s) => {
      if (!s?.items?.length) return s;
      const n = s.items.length;
      const cur = slashActiveIndex(s);
      return { ...s, active: (cur + delta + n) % n };
    });
  };

  const applyOp = (opResult) => {
    if (!opResult) return;
    pendingSel.current = { start: opResult.start, end: opResult.end };
    onBody(opResult.value);
  };

  const pickSlash = (cmd) => {
    const ta = taRef.current;
    if (!ta || !cmd) return;
    const next = applySlashCommand(ta, cmd);
    setSlashBoth(null);
    if (next) applyOp(next);
  };

  useEffect(() => {
    if (!slash) return undefined;
    const onKey = (e) => {
      handleSlashKey(e, slashRef, {
        move: moveSlash,
        pick: pickSlash,
        close: () => setSlashBoth(null),
      });
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [slash]);

  useLayoutEffect(() => {
    const sel = pendingSel.current;
    const ta = taRef.current;
    if (!sel || !ta) return;
    pendingSel.current = null;
    try { ta.setSelectionRange(sel.start, sel.end); } catch { /* ignore */ }
  }, [body]);

  useEffect(() => {
    if (!findOpen) return;
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [findOpen]);

  useEffect(() => {
    setFindIdx(0);
  }, [findQuery, body]);

  const jumpToMatch = (i) => {
    const ta = taRef.current;
    if (!ta || !matches.length) return;
    const idx = ((i % matches.length) + matches.length) % matches.length;
    setFindIdx(idx);
    const m = matches[idx];
    ta.focus();
    try { ta.setSelectionRange(m.start, m.end); } catch { /* ignore */ }
    scrollTextareaToIndex(ta, m.start);
    // 把焦点还给查找框，便于连续 Enter
    requestAnimationFrame(() => findInputRef.current?.focus());
  };

  const openFind = () => {
    setFindOpen(true);
    const ta = taRef.current;
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && !sel.includes('\n') && sel.length < 80) setFindQuery(sel);
    }
  };

  useImperativeHandle(editorApiRef, () => ({
    format(op) {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      applyOp(runFormat(ta, op));
    },
    turn(turnId) {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      applyOp(turnLine(ta, turnId));
    },
    insertAtCursor(text) {
      const ta = taRef.current;
      if (!ta) return;
      applyOp(insertTextAtCursor(ta, text));
    },
    getCursor() {
      const ta = taRef.current;
      return ta ? ta.selectionStart : null;
    },
    /** 撤销/重做后把光标放回改动处（公共前缀即改动起点） */
    caretFromDiff(prev, next) {
      const ta = taRef.current;
      if (!ta) return;
      const p = Math.min(diffIndex(prev, next), ta.value.length);
      ta.focus();
      ta.setSelectionRange(p, p);
    },
    toggleWrap() {
      setWrap((v) => !v);
    },
    getWrap: () => wrap,
    openFind,
    focus() {
      taRef.current?.focus();
    },
  }), [onBody, wrap]);

  const onKeyDown = (e) => {
    const ta = taRef.current;
    if (!ta) return;
    if (handleSlashKey(e, slashRef, {
      move: moveSlash,
      pick: pickSlash,
      close: () => setSlashBoth(null),
    })) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFind();
      return;
    }
    if (e.key === 'F3') {
      e.preventDefault();
      if (!findOpen) openFind();
      else if (e.shiftKey) jumpToMatch(findIdx - 1);
      else jumpToMatch(findIdx + 1);
      return;
    }
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      const map = { b: 'bold', i: 'italic', e: 'code', k: 'link' };
      if (map[k]) {
        e.preventDefault();
        applyOp(runFormat(ta, map[k]));
        return;
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      applyOp(indentLines(ta, e.shiftKey));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      const next = continueListOnEnter(ta);
      if (next) {
        e.preventDefault();
        applyOp(next);
      }
      setSlashBoth(null);
    }
  };

  const ingestImages = (files) => {
    if (!files?.length || !onFiles) return;
    const ta = taRef.current;
    onFiles(files, { insertAt: ta ? ta.selectionStart : null, mode: 'edit' });
  };

  const syncGutter = () => {
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  const lineNums = showLines
    ? Array.from({ length: Math.max(1, stats.lines) }, (_, i) => i + 1)
    : null;

  return (
    <div
      className={`mdw-pane mdw-pane-edit${dragging ? ' is-drop' : ''}`}
      onDragEnter={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        const files = imageFilesFromDataTransfer(e.dataTransfer);
        if (!files.length) return;
        e.preventDefault();
        ingestImages(files);
      }}
    >
      <TitleArea
        className="mdw-title-input"
        value={title}
        placeholder="任务标题"
        onTitle={onTitle}
          onEnter={() => {
          const ta = taRef.current;
          if (!ta) return;
          ta.focus();
          ta.setSelectionRange(0, 0);
        }}
      />
      {findOpen && (
        <EditorFindBar
          query={findQuery}
          setQuery={setFindQuery}
          index={findIdx}
          total={matches.length}
          inputRef={findInputRef}
          onNext={() => jumpToMatch(findIdx + 1)}
          onPrev={() => jumpToMatch(findIdx - 1)}
          onClose={() => {
            setFindOpen(false);
            taRef.current?.focus();
          }}
        />
      )}
      <div className={`mdw-editor-row${showLines ? ' has-gutter' : ''}${showRuler ? ' has-ruler' : ''}`}>
        {showLines && (
          <div className="mdw-gutter" ref={gutterRef} aria-hidden>
            {lineNums.map((n) => (
              <div key={n} className="mdw-gutter-ln">{n}</div>
            ))}
          </div>
        )}
        <div className="mdw-editor-stage">
          {showRuler && <div className="mdw-ruler" aria-hidden title="约 80 字符参考" />}
          <textarea
            ref={taRef}
            className={`mdw-editor${wrap ? ' is-wrap' : ' is-nowrap'}`}
            value={body}
            spellCheck={false}
            wrap={wrap ? 'soft' : 'off'}
            aria-label="正文源码"
            placeholder="用 Markdown 写任务——行首 / 出命令 · Ctrl/⌘F 查找 · Ctrl/⌘B 粗体"
            onChange={(e) => {
              onBody(e.target.value, 'typing');
              syncCaret();
              cancelAnimationFrame(slashRafRef.current);
              slashRafRef.current = requestAnimationFrame(() => {
                if (taRef.current) refreshSlash(taRef.current);
              });
            }}
            onKeyDown={onKeyDown}
            onKeyUp={syncCaret}
            onClick={() => { syncCaret(); if (!slashQueryAt(taRef.current)) setSlashBoth(null); }}
            onSelect={syncCaret}
            onScroll={syncGutter}
            onPaste={(e) => {
              const files = imageFilesFromDataTransfer(e.clipboardData);
              if (!files.length) return;
              e.preventDefault();
              ingestImages(files);
            }}
            onMouseUp={(e) => {
              syncCaret();
              const ta = taRef.current;
              if (!ta || ta.selectionStart === ta.selectionEnd) {
                onTextSel?.(null);
                return;
              }
              const text = ta.value.slice(ta.selectionStart, ta.selectionEnd);
              if (!text) return;
              onTextSel?.({
                text,
                x: e.clientX - 80,
                y: e.clientY - 44,
              });
            }}
          />
        </div>
      </div>
      <div className="mdw-editor-status" role="status">
        <span>Ln {caret.line}, Col {caret.col}</span>
        <span>{stats.lines} 行</span>
        <span>{stats.words} 词</span>
        <span>{stats.chars} 字</span>
        <button
          type="button"
          className={`mdw-wrap-toggle${showLines ? ' on' : ''}`}
          title="显示/隐藏行号"
          onClick={() => setShowLines((v) => !v)}
        >
          行号
        </button>
        <button
          type="button"
          className={`mdw-wrap-toggle${showRuler ? ' on' : ''}`}
          title="80 字符参考线"
          onClick={() => setShowRuler((v) => !v)}
        >
          参考线
        </button>
        <button
          type="button"
          className={`mdw-wrap-toggle${findOpen ? ' on' : ''}`}
          title="查找 Ctrl/⌘F"
          onClick={() => (findOpen ? setFindOpen(false) : openFind())}
        >
          查找
        </button>
        <button
          type="button"
          className={`mdw-wrap-toggle${wrap ? ' on' : ''}`}
          title={wrap ? '自动换行开（点击关闭）' : '自动换行关（点击开启）'}
          onClick={() => setWrap((v) => !v)}
        >
          {wrap ? '换行' : '不换行'}
        </button>
      </div>
      {slash && createPortal(
        <SlashMenu
          items={slash.items}
          active={slash.active}
          onHover={(n) => setSlashBoth((s) => s && ({ ...s, active: n }))}
          onPick={pickSlash}
          style={{ left: slash.x, top: slash.y }}
        />,
        document.body
      )}
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
    editorApiRef = null,
    onFiles = null,
    onTextSel = null,
    onSave = null,
    onUndo = null,
    onRedo = null,
  },
  articleRef
) {
  // 文档级快捷键集中接管（window 捕获阶段）：
  // 受控 textarea 的原生 undo 栈会被程序化改写冲掉，且原生撤销与我们的
  // 历史栈会互相打架——统一在这里拦截，编辑器区的按键行为才稳定可预期。
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      const k = e.key.toLowerCase();
      if (k === 'f' && mode !== 'edit') {
        // 实时预览/阅读态的查找（源码态由编辑器自己接管）；只要焦点在工作台内即可
        if (!t.closest('.mdw')) return;
        e.preventDefault();
        editorApiRef.current?.openFind?.();
        return;
      }
      // 其余快捷键只接管编辑区文本框：查找框等普通输入框保留原生撤销
      if (!t.closest('.mdw-editor,.mdw-lp-src,.mdw-lp-title,.mdw-title-input')) return;
      if (k === 's') {
        e.preventDefault();
        onSave?.();
        return;
      }
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) onRedo?.();
        else onUndo?.();
        return;
      }
      if (k === 'y') {
        e.preventDefault();
        onRedo?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onSave, onUndo, onRedo, mode, editorApiRef]);

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
          onFiles={onFiles}
          editorApiRef={editorApiRef}
          onTextSel={onTextSel}
        />
      </div>
    );
  }

  return (
    <div className={`mdw-split mode-${mode}`}>
      {mode === 'edit' && (
        <SourceEditor
          title={title}
          body={body}
          onTitle={onTitle}
          onBody={onBody}
          editorApiRef={editorApiRef}
          onFiles={onFiles}
          onTextSel={onTextSel}
        />
      )}
      {mode === 'preview' && (
        <div className="mdw-pane mdw-preview">
          <div className="mdw-reader">
            {/* 阅读态此前不渲染标题，与 live/源码两态断裂；题头与正文同轴同宽 */}
            {title ? <h1 className="mdw-reader-title">{title}</h1> : null}
            <article ref={articleRef} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
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
