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
  isFrontmatterBlock,
  isEmptyBlock,
  joinMdBlocks,
  liveBodyBlocks,
  normalizeBlockText,
  renderMarkdownHtml,
} from '../../modules/md/md-parse.js';
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
  isBareListItemLine,
  runFormat,
  scrollTextareaToIndex,
  slashQueryAt,
  toggleNthTodo,
  turnBlock,
  turnLine,
} from '../../modules/md/md-edit-ops.js';

// 格式快捷键 → 编辑操作（预览态划选后直接套用）
const FMT_KEYS = { b: 'bold', i: 'italic', e: 'code', k: 'link' };

/** 正文里已经自带 `# 标题` 了吗（跳过 frontmatter）——阅读态据此决定要不要再画题头 */
function bodyHasH1(body) {
  let t = String(body || '').replace(/^\uFEFF/, '').trimStart();
  if (t.startsWith('---')) {
    const end = t.indexOf('\n---', 3);
    if (end > 0) t = t.slice(end + 4).trimStart();
  }
  return /^#[ \t]+\S/.test(t);
}

function autoSize(el) {
  if (!el) return;
  el.style.height = '0px';
  // 高度交给内容本身（scrollHeight = 行数 × 行高）——原来写死最小 28px，
  // 比一行标题（16px × 1.35 ≈ 21.6px）还高：点进标题块就凭空多出 6px，
  // 下方内容跟着抖（2026-11-04 任务 #31）。
  el.style.height = `${el.scrollHeight}px`;
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
  // frontmatter 块：预览态渲染成属性卡（renderMarkdownHtml），编辑态等宽小字
  if (/^---\s*$/.test(t.split('\n', 1)[0] || '') && t.includes('\n')) return 'fm';
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
  onToggleTodo,
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
      el.focus();
      const n = el.value.length;
      try { el.setSelectionRange(n, n); } catch { /* ignore */ }
    }
  }, [focused, text, index, pendingSelRef, pendingFormatRef, onTaReady, onChange]);

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
      onClick={(e) => {
        // 复选框点击直接切换（#99：视图态 ☑/☐ 可点——专业编辑器基线行为）。
        // 不进编辑态；开关走 updateAt=op 通道（可撤销）。DOM 里 .mdw-cb 的序号
        // 与块源码里 todo 行的序号一一对应（按行序渲染）。
        const cb = e.target.closest?.('.mdw-cb');
        if (cb) {
          e.stopPropagation();
          const cbs = [...e.currentTarget.querySelectorAll('.mdw-cb')];
          onToggleTodo?.(index, cbs.indexOf(cb));
          return;
        }
        // 划选评论：有选区时不进编辑，把选区留给上层 mouseup 浮层
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && String(sel).trim()) return;
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
/** 正文块：剥掉首个一级标题行（= 文档标题，由顶部标题栏单独编辑，提交时再写入） */
function bodyBlocksOnly(body) {
  return liveBodyBlocks(body);
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
//
// **高度必须跟着宽度一起重算**（2026-11-08 #94 验收反馈「title下有一大段空白」）：
// fit() 读 scrollHeight，而 scrollHeight 是**当前宽度**下折行的结果——面板
// 刚打开、布局尚未定宽时，标题会按极窄宽度折成七八行，scrollHeight 暴涨到
// 几百 px（实测窄容器 316px、用户现场 271px）。此后宽度恢复正常、标题只占
// 一行，高度却再也降不回去（fit 只在 value 变化时跑，宽度变化不触发）——
// 标题下方就留着一大段空白。
//
// 修法：ResizeObserver 观察自身宽度，宽度一变就重算高度（宽度是唯一会让
// scrollHeight 变化的外部因素；文字变化由 value 依赖覆盖）。
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
    // 宽度变了要重算：面板拖宽/拖窄、布局首次定宽、浮窗开合都会改宽度。
    // 观察自身盒子（含 padding）比监听 window resize 准——窗口没变、面板变了
    // 同样要重算。
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => fit());
      ro.observe(el);
    } else {
      window.addEventListener('resize', fit);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', fit);
    };
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
  onCloseSelMenu, hideTitle = false,
}) {
  const [focus, setFocus] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [slash, setSlash] = useState(null); // { index, query, items, active, x, y }
  const pendingSelRef = useRef(null);
  // 预览态划选后按格式键：先记下待套用的操作，块进入编辑态并恢复选区后再执行
  const pendingFormatRef = useRef(null);
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
    // 瞬时定位，不走 smooth：平滑滚动与行号槽的即时同步互相打架，命中行会
    // 上下浮动、落点不稳（2026-11-03 任务 #7 移除）。
    el?.scrollIntoView?.({ block: 'center' });
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
    /** 预览态划选后按 Ctrl/⌘B/I/E/K：把该块切到编辑态并保留选区，再套用格式 */
    formatSelection(op) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return false;
      const text = String(sel.toString() || '');
      if (!text.trim()) return false;
      const node = sel.anchorNode;
      const el = node?.nodeType === 3 ? node.parentElement : node;
      const blockEl = el?.closest?.('.mdw-lp-block');
      if (!blockEl || !articleRef.current?.contains(blockEl)) return false;
      const i = Number(blockEl.getAttribute('data-i'));
      if (!Number.isInteger(i) || i < 0 || i >= blocks.length) return false;
      const raw = normalizeBlockText(blocks[i] ?? '');
      const pos = raw.indexOf(text);
      if (pos === -1) return false; // 选区跨 markdown 标记时保守放弃，不做错位改写
      pendingSelRef.current = { index: i, start: pos, end: pos + text.length };
      pendingFormatRef.current = op;
      onCloseSelMenu?.();
      setFocus(i);
      return true;
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

  // document 捕获：预览态划选后按 Backspace/Delete —— 把选中文字删掉（#98）。
  // 视图块是渲染好的 HTML，选区落在不可编辑内容上，浏览器默认对 Backspace
  // 无动于衷（编辑态 textarea 原生行为本来就对，这里只补视图态这一块）。
  // 映射口径与 formatSelection 一致：选区文本在块源码里 indexOf 定位；跨
  // markdown 标记/跨块时 indexOf 不中 → 保守放弃，不做错位改写。
  // 删除后进编辑态、光标落接缝（op 走历史栈，Ctrl+Z 可撤）。
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      // 焦点在可编辑元素里：原生行为已正确（textarea 选区删除 / contentEditable 标题）
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = String(sel.toString() || '');
      if (!text.trim()) return;
      const node = sel.anchorNode;
      const el = node?.nodeType === 3 ? node.parentElement : node;
      const blockEl = el?.closest?.('.mdw-lp-block');
      if (!blockEl || !articleRef.current?.contains(blockEl)) return;
      const i = Number(blockEl.getAttribute('data-i'));
      if (!Number.isInteger(i) || i < 0 || i >= blocks.length) return;
      const raw = normalizeBlockText(blocks[i] ?? '');
      const pos = raw.indexOf(text);
      if (pos === -1) return; // 跨标记/跨块：保守放弃，不删
      e.preventDefault();
      updateAt(i, raw.slice(0, pos) + raw.slice(pos + text.length));
      pendingSelRef.current = { index: i, start: pos, end: pos };
      onCloseSelMenu?.();
      setFocus(i);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [blocks, onBody, articleRef, onCloseSelMenu]);

  const onKeyDown = (i, e) => {
    const val = normalizeBlockText(blocks[i] ?? '');
    const ta = e.target;
    liveTaRef.current = ta;

    // IME 组合中（拼音候选未上屏）：按键归输入法，块级快捷键一概不接——
    // 否则选字回车的 Enter 会被当「拆块」、删拼音的 Backspace 会被当「并块」
    // （标题区同款守卫，见 TitleArea 的 onEnter）。
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;

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

    if (e.key === 'Backspace' && isEmptyBlock(val) && i === 0 && blocks.length > 1) {
      e.preventDefault();
      setSlashBoth(null);
      const next = blocks.slice();
      next.splice(i, 1);
      commit(next);
      setFocus(0);
      return;
    }
    // Backspace 在块首（无选区、非首块）：并入上一块，光标落在接缝处（Notion 行为）。
    // 这也是清掉「头上莫名多出的空块」的自然手段——空块并一次就消失。
    // FM 块（属性卡）不许被并进正文：合并会把 `---` 撕碎成普通文本。
    if (
      e.key === 'Backspace'
      && ta.selectionStart === 0 && ta.selectionEnd === 0
      && i > 0 && !slashRef.current
      && !isFrontmatterBlock(normalizeBlockText(blocks[i - 1] ?? ''))
    ) {
      e.preventDefault();
      setSlashBoth(null);
      const prev = normalizeBlockText(blocks[i - 1] ?? '');
      const next = blocks.slice();
      next[i - 1] = prev + val;
      next.splice(i, 1);
      pendingSelRef.current = { index: i - 1, start: prev.length, end: prev.length };
      commit(next);
      setFocus(i - 1);
      return;
    }
    // Backspace 在**空的列表项行**上（光标前只剩 `- ` / `- [ ] ` / `1. ` 这类裸前缀，
    // #100 验收反馈）：一键剥掉前缀「逃出列表」——落点是**空白行**继续打字，
    // 而不是被顶回上一行（此前：删完前缀再按一下，原生会把行首 \n 吃掉、光标
    // 跳到上一行行尾）。与 continueListOnEnter 的「空项 Enter 收回」成对，
    // 同为 Notion 语义。落点按行在块里的位置分三种（块内存不住空行——空行是
    // 块分隔符，join/split 往返即裂）：
    //   独行块   → 本块原地变空，光标留在本块
    //   块尾行   → 上文留下，新开一个空块（Shift+Enter 块尾同款约定）
    //   块中行   → 拆成 [上文, '', 下文]，光标落中间空块
    if (
      e.key === 'Backspace'
      && ta.selectionStart === ta.selectionEnd && !slashRef.current
    ) {
      const s = ta.selectionStart;
      const lineStart = val.lastIndexOf('\n', s - 1) + 1;
      const lineEndIdx = val.indexOf('\n', s);
      const lineEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
      // 整行必须只有裸前缀（光标夹在中间也一样）——否则 `- 待办|` 会整行被误删
      const wholeLine = val.slice(lineStart, lineEnd);
      const isBareItem = isBareListItemLine(wholeLine);
      if (isBareItem) {
        e.preventDefault();
        setSlashBoth(null);
        const above = val.slice(0, lineStart).replace(/\n$/, '');
        const below = lineEndIdx === -1 ? '' : val.slice(lineEnd + 1);
        const next = blocks.slice();
        if (!above && !below) {
          // 独行块：本块原地变空
          next[i] = '';
          pendingSelRef.current = { index: i, start: 0, end: 0 };
          commit(next);
          setFocus(i);
        } else if (!below) {
          // 块尾行：上文留下，新开一个空块
          next[i] = above;
          next.splice(i + 1, 0, '');
          pendingSelRef.current = { index: i + 1, start: 0, end: 0 };
          commit(next);
          setFocus(i + 1);
        } else {
          // 块中行：上文 / 空块 / 下文，光标落中间空块
          next[i] = above;
          next.splice(i + 1, 0, '', below);
          pendingSelRef.current = { index: i + 1, start: 0, end: 0 };
          commit(next);
          setFocus(i + 1);
        }
        return;
      }
    }
    // Delete 在块尾（无选区、非末块）：把下一块并进来，光标落接缝——
    // Backspace 并上块的镜像（Notion 行为）。FM 块同理不许被并：
    // 合并会把下一块的 `---` 撕碎成普通文本。
    if (
      e.key === 'Delete'
      && ta.selectionStart === val.length && ta.selectionEnd === val.length
      && i < blocks.length - 1 && !slashRef.current
      && !isFrontmatterBlock(normalizeBlockText(blocks[i + 1] ?? ''))
    ) {
      e.preventDefault();
      setSlashBoth(null);
      const nxt = normalizeBlockText(blocks[i + 1] ?? '');
      const next = blocks.slice();
      next[i] = val + nxt;
      next.splice(i + 1, 1);
      pendingSelRef.current = { index: i, start: val.length, end: val.length };
      commit(next);
      setFocus(i);
      return;
    }
    // Shift+Enter = 块内软换行。**中段**放行原生插入（\n 在块内存活，实测）；
    // 块头/块尾不能放行——joinMdBlocks 剥尾随 \n、splitMdBlocks 把前导空行当
    // 分隔符（2026-11-07 #92 实测换行被往返吃掉，表现为按键无响应）——
    // 等效改写为「新开一个空块」：视觉同为多出一行，且模型存得住。
    if (e.key === 'Enter' && e.shiftKey && !mod && !slashRef.current) {
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      if (s === 0 && en === 0) {
        e.preventDefault();
        setSlashBoth(null);
        const next = blocks.slice();
        next.splice(i, 0, '');
        pendingSelRef.current = { index: i, start: 0, end: 0 };
        commit(next);
        setFocus(i);
        return;
      }
      if (s === val.length && en === val.length) {
        e.preventDefault();
        setSlashBoth(null);
        const next = blocks.slice();
        next.splice(i + 1, 0, '');
        pendingSelRef.current = { index: i + 1, start: 0, end: 0 };
        commit(next);
        setFocus(i + 1);
        return;
      }
      return; // 中段：原生插入
    }
    // 斜杠菜单打开时禁止块间跳转（必须用 ref，避免闭包过期）
    if (slashRef.current) return;
    // ↑↓ 跨块：块首 ↑ 落上一块**末尾**、块尾 ↓ 落下一块**开头**（#92）——
    // 以前两个方向都落下一块的末尾（LiveBlock 默认光标在末尾），往下走时
    // 光标总在块的右下角、像跳过了整块开头，只能鼠标点回来。
    const collapsed = ta.selectionStart === ta.selectionEnd;
    if (collapsed && !e.shiftKey && !e.altKey) {
      if (e.key === 'ArrowUp' && ta.selectionStart === 0 && i > 0) {
        e.preventDefault();
        const prevLen = normalizeBlockText(blocks[i - 1] ?? '').length;
        pendingSelRef.current = { index: i - 1, start: prevLen, end: prevLen };
        setFocus(i - 1);
        return;
      }
      if (e.key === 'ArrowDown' && ta.selectionEnd === val.length && i < blocks.length - 1) {
        e.preventDefault();
        pendingSelRef.current = { index: i + 1, start: 0, end: 0 };
        setFocus(i + 1);
        return;
      }
      // 软换行块的**视觉行**兜底：光标不在块首/块尾时先放行原生移动，
      // 一帧后没动 = 已在第一/最后视觉行——补一次跨块跳转（Notion 行为）
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const before = { start: ta.selectionStart, end: ta.selectionEnd };
        const dir = e.key;
        requestAnimationFrame(() => {
          const el = liveTaRef.current;
          if (!el || el !== document.activeElement) return;
          if (el.selectionStart !== before.start || el.selectionEnd !== before.end) return;
          const len = normalizeBlockText(blocks[i] ?? '').length;
          if (dir === 'ArrowUp' && before.start > 0 && i > 0) {
            // ↑ 到上一块**末尾**（跨块只动光标不改内容，FM 块也可进入）
            const prevLen = normalizeBlockText(blocks[i - 1] ?? '').length;
            pendingSelRef.current = { index: i - 1, start: prevLen, end: prevLen };
            setFocus(i - 1);
          } else if (dir === 'ArrowDown' && before.end < len && i < blocks.length - 1) {
            pendingSelRef.current = { index: i + 1, start: 0, end: 0 };
            setFocus(i + 1);
          }
        });
      }
    }
  };

  const ingestFiles = (files, ta) => {
    if (!files?.length || !onFiles) return;
    // 实时预览的光标是**块内**偏移，绝不能当全文 insertAt——否则会插进
    // frontmatter（保存时被剥掉，附件仓留下孤儿文件；任务 #15 验收根因）。
    onFiles(files, {
      mode: 'live',
      focusIndex: focus,
      caretInBlock: ta ? ta.selectionStart : null,
    });
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
        {/* 标题行：评论/反馈面板不要（#104——引用信息在面板头部，标题行是多余的） */}
        {!hideTitle && (
          <TitleArea
            className="mdw-lp-title"
            value={title}
            placeholder="无标题"
            onTitle={onTitle}
            onFocus={() => { setFocus(null); setSlashBoth(null); }}
            onEnter={() => { if (blocks.length) setFocus(0); }}
          />
        )}
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
              pendingFormatRef={pendingFormatRef}
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
              onToggleTodo={(idx, n) => {
                const raw = normalizeBlockText(blocks[idx] ?? '');
                const next = toggleNthTodo(raw, n);
                if (next) updateAt(idx, next);
              }}
              onPasteFiles={(files, ta) => ingestFiles(files, ta)}
              onTextSel={onTextSel}
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
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return; // IME 组合中：按键归输入法
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
    // 源码态 textarea 持有全文，selectionStart 才是合法的全文偏移。
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
            onDrop={(e) => {
              // 拖文件进来 = 与粘贴同一通道（实时预览态已有拖放，源码态补齐对等能力）
              const files = imageFilesFromDataTransfer(e.dataTransfer);
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
    onCloseSelMenu = null,
    hideTitle = false,
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
      const inEditorText = t.closest('.mdw-editor,.mdw-lp-src,.mdw-lp-title,.mdw-title-input');
      if (k === 'f' && mode !== 'edit') {
        // 实时预览/阅读态的查找（源码态由编辑器自己接管）；只要焦点在工作台内即可
        if (!t.closest('.mdw')) return;
        e.preventDefault();
        editorApiRef.current?.openFind?.();
        return;
      }
      if (!inEditorText) {
        // 预览态划选后按格式键：切编辑态并套格式（Notion/Typora 行为）
        if (mode === 'split' && FMT_KEYS[k]) {
          if (editorApiRef.current?.formatSelection?.(FMT_KEYS[k])) e.preventDefault();
        }
        return;
      }
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

  // 源码态：偶尔切过去改标记（入口在「更多」菜单里，不再占页头）
  if (mode === 'edit') {
    return (
      <div className="mdw-split mode-edit">
        <SourceEditor
          title={title}
          body={body}
          onTitle={onTitle}
          onBody={onBody}
          editorApiRef={editorApiRef}
          onFiles={onFiles}
          onTextSel={onTextSel}
        />
      </div>
    );
  }

  // 只读文档（外部绑定）：没有模式可切，直接渲染阅读视图。
  // 「阅读」不再是用户可选模式（#47 撤掉），只作为不可写文档的兜底呈现。
  if (!onBody && !onTitle) {
    return (
      <div className="mdw-split mode-read">
        <div className="mdw-pane mdw-preview">
          <div className="mdw-reader">
            {/* 阅读态此前不渲染标题，与 live/源码两态断裂；题头与正文同轴同宽。
                正文自带 `# 标题` 时不再画外部题头——文档的 body 本来就含首行标题，
                两个都画就是同一行字出现两次（阅读态看起来像渲染 bug）。 */}
            {title && !bodyHasH1(body) ? (
              <h1 className="mdw-reader-title">{title}</h1>
            ) : null}
            <article ref={articleRef} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      </div>
    );
  }

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
        onCloseSelMenu={onCloseSelMenu}
        hideTitle={hideTitle}
      />
    </div>
  );
});

const MODES = [
  { id: 'split', label: '实时预览' },
  { id: 'edit', label: '源码' },
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
