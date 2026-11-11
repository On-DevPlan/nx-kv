// 实时预览块编辑器的按键子动作：onKeyDown 的每个分支一个纯函数式处理器。
// ctx 由组件装配：{ e, i, val, ta, blocks, commit, setFocus, pendingSelRef,
// slashRef, liveTaRef, setSlashBoth, applyBlockOp }；返回 true = 已接管。
// 注意：Delete 块尾并块**不在这里**——它是结构钉测试锚定的行为，留在
// md-panes.jsx 的 onKeyDown 本体里。
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  continueListOnEnter,
  isBareListItemLine,
} from '../../modules/md/md-edit-ops.js';
import {
  isEmptyBlock,
  isFrontmatterBlock,
  normalizeBlockText,
} from '../../modules/md/md-parse.js';
import type { EditOpResult, PendingSel } from './md-panes-helpers.js';
import type { SlashState } from './slash-menu.jsx';

/** 块编辑器按键处理器的公共上下文（由 md-panes.tsx 装配）。 */
export interface LiveKeyCtx {
  e: ReactKeyboardEvent<HTMLTextAreaElement>;
  i: number;
  val: string;
  ta: HTMLTextAreaElement;
  blocks: string[];
  commit: (next: string[], kind?: string) => void;
  setFocus: (i: number | null) => void;
  pendingSelRef: { current: PendingSel | null };
  slashRef: { current: SlashState | null };
  liveTaRef: { current: HTMLTextAreaElement | null };
  setSlashBoth: (next: SlashState | null) => void;
  applyBlockOp: (i: number, op: EditOpResult | null | undefined) => void;
}

/** Enter（无修饰）：列表续行优先；否则在光标处拆成新块，光标落新块块首（Notion 行为） */
export function handleEnterSplit(ctx: LiveKeyCtx) {
  const { e, i, val, ta, blocks, commit, setFocus, pendingSelRef, setSlashBoth, applyBlockOp } = ctx;
  const list = continueListOnEnter(ta);
  if (list) {
    e.preventDefault();
    applyBlockOp(i, list);
    return true;
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
  return true;
}

/**
 * Backspace 两种块首场景：
 *   1. 空的首块（还有别的块）→ 移除它，焦点留首块——清掉「头上莫名多出的空块」
 *   2. 光标在块首（无选区、非首块）→ 并入上一块，光标落接缝（Notion 行为）。
 * FM 块（属性卡）不许被并进正文：合并会把 `---` 撕碎成普通文本。
 */
export function handleBackspaceStart(ctx: LiveKeyCtx) {
  const { e, i, val, ta, blocks, commit, setFocus, pendingSelRef, slashRef, setSlashBoth } = ctx;
  if (isEmptyBlock(val) && i === 0 && blocks.length > 1) {
    e.preventDefault();
    setSlashBoth(null);
    const next = blocks.slice();
    next.splice(i, 1);
    commit(next);
    setFocus(0);
    return true;
  }
  if (
    ta.selectionStart === 0 && ta.selectionEnd === 0
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
    return true;
  }
  return false;
}

/**
 * Backspace 在**空的列表项行**上（光标前只剩 `- ` / `- [ ] ` / `1. ` 这类裸前缀，
 * #100 验收反馈）：一键剥掉前缀「逃出列表」——落点是**空白行**继续打字，
 * 而不是被顶回上一行（此前：删完前缀再按一下，原生会把行首 \n 吃掉、光标
 * 跳到上一行行尾）。与 continueListOnEnter 的「空项 Enter 收回」成对，
 * 同为 Notion 语义。落点按行在块里的位置分三种（块内存不住空行——空行是
 * 块分隔符，join/split 往返即裂）：
 *   独行块   → 本块原地变空，光标留在本块
 *   块尾行   → 上文留下，新开一个空块（Shift+Enter 块尾同款约定）
 *   块中行   → 拆成 [上文, '', 下文]，光标落中间空块
 */
export function handleBareListEscape(ctx: LiveKeyCtx) {
  const { e, i, val, ta, blocks, commit, setFocus, pendingSelRef, slashRef, setSlashBoth } = ctx;
  if (ta.selectionStart !== ta.selectionEnd || slashRef.current) return false;
  const s = ta.selectionStart;
  const lineStart = val.lastIndexOf('\n', s - 1) + 1;
  const lineEndIdx = val.indexOf('\n', s);
  const lineEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
  // 整行必须只有裸前缀（光标夹在中间也一样）——否则 `- 待办|` 会整行被误删
  const wholeLine = val.slice(lineStart, lineEnd);
  if (!isBareListItemLine(wholeLine)) return false;
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
  return true;
}

/**
 * Shift+Enter = 块内软换行。**中段**放行原生插入（\n 在块内存活，实测）；
 * 块头/块尾不能放行——joinMdBlocks 剥尾随 \n、splitMdBlocks 把前导空行当
 * 分隔符（2026-11-07 #92 实测换行被往返吃掉，表现为按键无响应）——
 * 等效改写为「新开一个空块」：视觉同为多出一行，且模型存得住。
 */
export function handleSoftBreak(ctx: LiveKeyCtx) {
  const { e, i, val, ta, blocks, commit, setFocus, pendingSelRef, setSlashBoth } = ctx;
  const s = ta.selectionStart;
  const en = ta.selectionEnd;
  let at: number | null = null;
  if (s === 0 && en === 0) at = i;
  else if (s === val.length && en === val.length) at = i + 1;
  if (at == null) return false; // 中段：原生插入
  e.preventDefault();
  setSlashBoth(null);
  const next = blocks.slice();
  next.splice(at, 0, '');
  pendingSelRef.current = { index: at, start: 0, end: 0 };
  commit(next);
  setFocus(at);
  return true;
}

/**
 * ↑↓ 跨块：块首 ↑ 落上一块**末尾**、块尾 ↓ 落下一块**开头**（#92）——
 * 以前两个方向都落下一块的末尾（LiveBlock 默认光标在末尾），往下走时
 * 光标总在块的右下角、像跳过了整块开头，只能鼠标点回来。
 * 软换行块的**视觉行**兜底：光标不在块首/块尾时先放行原生移动，
 * 一帧后没动 = 已在第一/最后视觉行——补一次跨块跳转（Notion 行为）。
 */
export function handleArrowNav(ctx: LiveKeyCtx) {
  const { e, i, val, ta, blocks, setFocus, pendingSelRef, liveTaRef } = ctx;
  const collapsed = ta.selectionStart === ta.selectionEnd;
  if (!collapsed || e.shiftKey || e.altKey) return;
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
