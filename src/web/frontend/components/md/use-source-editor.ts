// SourceEditor 的容器 hook：状态、查找、斜杠、格式 API、粘贴/拖图都收在这里；
// 组件（md-panes.jsx）只留 textarea  JSX 与 IME 守卫（结构钉测试锚定）。
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from 'react';
import {
  caretLineCol,
  continueListOnEnter,
  countStats,
  diffIndex,
  filesFromDataTransfer,
  findMatches,
  indentLines,
  insertTextAtCursor,
  runFormat,
  scrollTextareaToIndex,
  slashQueryAt,
  turnLine,
} from '../../modules/md/md-edit-ops.js';
import { FMT_KEYS, useDropFiles } from './md-panes-helpers.js';
import type { DropRootProps, EditOpResult, EditorApi, FileDropCtx } from './md-panes-helpers.js';
import { handleSlashKey } from './slash-menu.jsx';
import type { SlashMenuProps } from './slash-menu.jsx';
import { useSlashMenu } from './use-slash-menu.js';
import type { EditorFindBarProps } from './find-bar.jsx';
import type { StatusBarProps } from './status-bar.jsx';

export interface UseSourceEditorArgs {
  body: string;
  onBody?: (body: string, kind?: string) => void;
  editorApiRef: RefObject<EditorApi | null>;
  onFiles?: ((files: File[], ctx?: FileDropCtx) => void) | null;
  onTextSel?: ((sel: { text: string; x: number; y: number } | null) => void) | null;
}

/** 源码编辑器 hook 的返回面（组件按名字取用）。 */
export interface UseSourceEditorResult {
  taRef: RefObject<HTMLTextAreaElement | null>;
  gutterRef: RefObject<HTMLDivElement | null>;
  wrap: boolean;
  showLines: boolean;
  showRuler: boolean;
  lineNums: number[] | null;
  findOpen: boolean;
  findBarProps: EditorFindBarProps;
  statusProps: StatusBarProps;
  slash: ReturnType<typeof useSlashMenu>['slash'];
  slashMenuProps: SlashMenuProps | null;
  rootProps: DropRootProps;
  ingestImages: (files: File[] | null | undefined) => void;
  focusBodyStart: () => void;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onClick: () => void;
  onPaste: (e: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onMouseUp: (e: ReactMouseEvent<HTMLTextAreaElement>) => void;
  syncCaret: () => void;
  syncGutter: () => void;
}

export function useSourceEditor({ body, onBody, editorApiRef, onFiles, onTextSel }: UseSourceEditorArgs): UseSourceEditorResult {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSel = useRef<{ start: number; end: number } | null>(null);
  const [wrap, setWrap] = useState(true);
  const [showLines, setShowLines] = useState(true);
  const [showRuler, setShowRuler] = useState(true);
  const [caret, setCaret] = useState({ line: 1, col: 1 });
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIdx, setFindIdx] = useState(0);
  const stats = countStats(body);
  const matches = findMatches(body, findQuery);

  const applyOp = (opResult: EditOpResult | null | undefined) => {
    if (!opResult) return;
    pendingSel.current = { start: opResult.start, end: opResult.end };
    onBody?.(opResult.value);
  };

  // ── 斜杠命令：浮层坐标按行列 × 行高推算 ──
  const slashPositionOf = (ta: HTMLTextAreaElement) => {
    const rect = ta.getBoundingClientRect();
    const lineH = 20;
    const line = caretLineCol(ta.value, ta.selectionStart).line;
    return {
      x: Math.min(window.innerWidth - 220, rect.left + 12),
      y: Math.min(window.innerHeight - 220, rect.top + line * lineH - ta.scrollTop + 8),
    };
  };
  const {
    slash, slashRef, slashRafRef, setSlashBoth, refreshSlash, moveSlash, pickSlash, hoverSlash,
  } = useSlashMenu({
    getTa: () => taRef.current,
    positionOf: slashPositionOf,
    onApply: (next) => { applyOp(next); },
  });

  const syncCaret = () => {
    const ta = taRef.current;
    if (!ta) return;
    setCaret(caretLineCol(ta.value, ta.selectionStart));
  };

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

  const jumpToMatch = (i: number) => {
    const ta = taRef.current;
    if (!ta || !matches.length) return;
    const idx = ((i % matches.length) + matches.length) % matches.length;
    setFindIdx(idx);
    const m = matches[idx];
    if (!m) return; // idx 已归一到 [0, matches.length)，这里只给 noUncheckedIndexedAccess 收口
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
    format(op: string) {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      applyOp(runFormat(ta, op));
    },
    turn(turnId: string) {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      applyOp(turnLine(ta, turnId));
    },
    insertAtCursor(text: string) {
      const ta = taRef.current;
      if (!ta) return;
      applyOp(insertTextAtCursor(ta, text));
    },
    getCursor() {
      const ta = taRef.current;
      return ta ? ta.selectionStart : null;
    },
    /** 撤销/重做后把光标放回改动处（公共前缀即改动起点） */
    caretFromDiff(prev: string, next: string) {
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

  const ingestImages = (files: File[] | null | undefined) => {
    if (!files?.length || !onFiles) return;
    const ta = taRef.current;
    // 源码态 textarea 持有全文，selectionStart 才是合法的全文偏移。
    onFiles(files, { insertAt: ta ? ta.selectionStart : null, mode: 'edit' });
  };

  const { rootProps } = useDropFiles({
    baseClass: 'mdw-pane mdw-pane-edit',
    skipPrevented: true,
    onDropFiles: (files) => ingestImages(files),
  });

  const syncGutter = () => {
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  const lineNums = showLines
    ? Array.from({ length: Math.max(1, stats.lines) }, (_, i) => i + 1)
    : null;

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onBody?.(e.target.value, 'typing');
    syncCaret();
    cancelAnimationFrame(slashRafRef.current);
    slashRafRef.current = requestAnimationFrame(() => {
      if (taRef.current) refreshSlash(taRef.current);
    });
  };
  const onClick = () => {
    syncCaret();
    if (!slashQueryAt(taRef.current)) setSlashBoth(null);
  };
  const onPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesFromDataTransfer(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    ingestImages(files);
  };
  const onMouseUp = (e: ReactMouseEvent<HTMLTextAreaElement>) => {
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
  };

  // 主按键分发（IME 守卫在组件侧——结构钉锚定）；斜杠菜单优先
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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
      const op = FMT_KEYS[e.key.toLowerCase()];
      if (op) {
        e.preventDefault();
        applyOp(runFormat(ta, op));
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

  const focusBodyStart = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(0, 0);
  };

  const findBarProps: EditorFindBarProps = {
    query: findQuery,
    setQuery: setFindQuery,
    index: findIdx,
    total: matches.length,
    inputRef: findInputRef,
    onNext: () => jumpToMatch(findIdx + 1),
    onPrev: () => jumpToMatch(findIdx - 1),
    onClose: () => {
      setFindOpen(false);
      taRef.current?.focus();
    },
  };
  const statusProps: StatusBarProps = {
    caret,
    stats,
    showLines,
    showRuler,
    findOpen,
    wrap,
    onToggleLines: () => setShowLines((v) => !v),
    onToggleRuler: () => setShowRuler((v) => !v),
    onToggleFind: () => (findOpen ? setFindOpen(false) : openFind()),
    onToggleWrap: () => setWrap((v) => !v),
  };
  const slashMenuProps: SlashMenuProps | null = slash
    ? {
      items: slash.items,
      active: slash.active,
      onHover: hoverSlash,
      onPick: pickSlash,
      style: { left: slash.x, top: slash.y },
    }
    : null;

  return {
    taRef, gutterRef, wrap, showLines, showRuler, lineNums,
    findOpen, findBarProps, statusProps, slash, slashMenuProps,
    rootProps, ingestImages, focusBodyStart,
    onChange, onKeyDown, onClick, onPaste, onMouseUp, syncCaret, syncGutter,
  };
}
