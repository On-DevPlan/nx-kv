/** 源码编辑器操作：选区包裹、行前缀、缩进、列表续行（对齐 Obsidian / Typora）
 *  返回 { value, start, end }；不直接改 DOM，由 React 受控回写后再恢复选区。 */

function result(value, start, end) {
  return { value, start, end };
}

/** 用 before/after 包裹选区；无选区时插入占位并选中 */
export function wrapSelection(ta, before, after = before, placeholder = '') {
  if (!ta) return null;
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const selected = value.slice(s, e);
  const inner = selected || placeholder;
  const next = value.slice(0, s) + before + inner + after + value.slice(e);
  const ns = s + before.length;
  return result(next, ns, ns + inner.length);
}

/** 对选中各行（或当前行）切换行首前缀 */
export function toggleLinePrefix(ta, prefix) {
  if (!ta) return null;
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const lineEnd = (() => {
    const i = value.indexOf('\n', e);
    return i === -1 ? value.length : i;
  })();
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const allOn = lines.every((l) => l.startsWith(prefix) || l === '');
  const nextLines = lines.map((l) => {
    if (!l && lines.length > 1) return l;
    if (allOn) return l.startsWith(prefix) ? l.slice(prefix.length) : l;
    return l.startsWith(prefix) ? l : prefix + l;
  });
  const nextBlock = nextLines.join('\n');
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
  const delta = nextBlock.length - block.length;
  return result(next, s, Math.max(s, e + delta));
}

const INDENT = '  ';

export function indentLines(ta, outdent = false) {
  if (!ta) return null;
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const lineEnd = (() => {
    const i = value.indexOf('\n', Math.max(e - (e > 0 && value[e - 1] === '\n' ? 1 : 0), lineStart));
    return i === -1 ? value.length : i;
  })();
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  let removedFirst = 0;
  const nextLines = lines.map((l, i) => {
    if (outdent) {
      if (l.startsWith(INDENT)) {
        if (i === 0) removedFirst = INDENT.length;
        return l.slice(INDENT.length);
      }
      if (l.startsWith('\t')) {
        if (i === 0) removedFirst = 1;
        return l.slice(1);
      }
      if (l.startsWith(' ')) {
        if (i === 0) removedFirst = 1;
        return l.slice(1);
      }
      return l;
    }
    return INDENT + l;
  });
  const nextBlock = nextLines.join('\n');
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
  if (outdent) {
    const ns = Math.max(lineStart, s - removedFirst);
    const ne = Math.max(ns, e - (block.length - nextBlock.length));
    return result(next, ns, ne);
  }
  return result(next, s + INDENT.length, e + INDENT.length * lines.length);
}

/** Enter：空列表项收回；否则续行同前缀 */
export function continueListOnEnter(ta) {
  if (!ta) return null;
  const { value, selectionStart: s, selectionEnd: e } = ta;
  if (s !== e) return null;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const line = value.slice(lineStart, s);
  const m = line.match(/^(\s*)([-*+]|\d+\.)(\s+)(\[[ xX]\]\s+)?(.*)$/);
  if (!m) return null;
  const [, indent, bullet, sp, box, rest] = m;
  if (!String(rest || '').trim()) {
    return result(value.slice(0, lineStart) + value.slice(s), lineStart, lineStart);
  }
  let nextBullet = bullet;
  if (/^\d+\.$/.test(bullet)) {
    nextBullet = `${Number(bullet.slice(0, -1)) + 1}.`;
  }
  const insert = `\n${indent}${nextBullet}${sp}${box || ''}`;
  const next = value.slice(0, s) + insert + value.slice(e);
  const caret = s + insert.length;
  return result(next, caret, caret);
}

export const FORMAT_OPS = {
  bold: (ta) => wrapSelection(ta, '**', '**', '粗体'),
  italic: (ta) => wrapSelection(ta, '*', '*', '斜体'),
  code: (ta) => wrapSelection(ta, '`', '`', 'code'),
  strike: (ta) => wrapSelection(ta, '~~', '~~', '删除线'),
  link: (ta) => {
    if (!ta) return null;
    const { value, selectionStart: s, selectionEnd: e } = ta;
    const selected = value.slice(s, e) || '链接文字';
    const next = `${value.slice(0, s)}[${selected}](url)${value.slice(e)}`;
    const urlStart = s + selected.length + 3;
    return result(next, urlStart, urlStart + 3);
  },
  h2: (ta) => toggleLinePrefix(ta, '## '),
  h3: (ta) => toggleLinePrefix(ta, '### '),
  ul: (ta) => toggleLinePrefix(ta, '- '),
  todo: (ta) => toggleLinePrefix(ta, '- [ ] '),
  quote: (ta) => toggleLinePrefix(ta, '> '),
};

export function runFormat(ta, op) {
  const fn = FORMAT_OPS[op];
  return fn ? fn(ta) : null;
}

export function countStats(text) {
  const t = String(text || '');
  const lines = t.length ? t.split('\n').length : 0;
  const chars = t.length;
  const words = t.trim() ? t.trim().split(/\s+/).length : 0;
  return { lines, chars, words };
}

/** 光标 → 1-based 行/列 */
export function caretLineCol(text, index) {
  const t = String(text || '');
  const i = Math.max(0, Math.min(index ?? 0, t.length));
  const before = t.slice(0, i);
  const line = before.split('\n').length;
  const col = before.length - before.lastIndexOf('\n');
  return { line, col };
}

/** 在光标处插入文本（粘贴图 / 拖入后写 `![]()`） */
export function insertTextAtCursor(ta, text) {
  if (!ta || text == null) return null;
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const next = value.slice(0, s) + text + value.slice(e);
  const caret = s + String(text).length;
  return result(next, caret, caret);
}

/** 在 text 中找 query 的全部起止（区分大小写可选） */
export function findAllMatches(text, query, { caseSensitive = false } = {}) {
  const q = String(query || '');
  if (!q) return [];
  const src = String(text || '');
  const hay = caseSensitive ? src : src.toLowerCase();
  const needle = caseSensitive ? q : q.toLowerCase();
  const out = [];
  let from = 0;
  while (from <= hay.length) {
    const i = hay.indexOf(needle, from);
    if (i === -1) break;
    out.push({ start: i, end: i + q.length });
    from = i + Math.max(1, q.length);
  }
  return out;
}

/** 行首 `/` 命令（Notion：新行首位输入 / 出菜单） */
export const SLASH_CMDS = [
  { id: 'text', ops: ['text', '正文', 'p', 'paragraph'], label: '正文', hint: '纯文本', turn: 'text' },
  { id: 'h2', ops: ['h2', '标题', 'heading', 'h'], label: '标题', hint: '##', turn: 'h2' },
  { id: 'h3', ops: ['h3', '小标题'], label: '小标题', hint: '###', turn: 'h3' },
  { id: 'ul', ops: ['ul', 'list', '列表'], label: '列表', hint: '- ', turn: 'ul' },
  { id: 'todo', ops: ['todo', 'task', '待办'], label: '待办', hint: '- [ ]', turn: 'todo' },
  { id: 'quote', ops: ['quote', '引用'], label: '引用', hint: '> ', turn: 'quote' },
  { id: 'bold', ops: ['bold', 'b', '粗体'], label: '粗体', hint: '**', format: 'bold' },
  { id: 'code', ops: ['code', '代码'], label: '行内代码', hint: '`', format: 'code' },
  { id: 'link', ops: ['link', '链接'], label: '链接', hint: '[]()', format: 'link' },
];

/** 工具条 1–6 转变（与斜杠块类型对齐） */
export const TURN_INTO = [
  { key: '1', id: 'text', label: '正文', hint: '1', apply: (t) => stripBlockPrefix(t) },
  { key: '2', id: 'h2', label: '标题', hint: '2', apply: (t) => withBlockPrefix(stripBlockPrefix(t), '## ') },
  { key: '3', id: 'h3', label: '小标题', hint: '3', apply: (t) => withBlockPrefix(stripBlockPrefix(t), '### ') },
  { key: '4', id: 'ul', label: '列表', hint: '4', apply: (t) => withBlockPrefix(stripBlockPrefix(t), '- ') },
  { key: '5', id: 'todo', label: '待办', hint: '5', apply: (t) => withBlockPrefix(stripBlockPrefix(t), '- [ ] ') },
  { key: '6', id: 'quote', label: '引用', hint: '6', apply: (t) => withBlockPrefix(stripBlockPrefix(t), '> ') },
];

const BLOCK_PREFIX_RE = /^(#{1,3}\s|>\s|-\s+(?:\[[ xX]\]\s+)?)/;

export function stripBlockPrefix(text) {
  const lines = String(text || '').split('\n');
  return lines
    .map((l) => l.replace(BLOCK_PREFIX_RE, ''))
    .join('\n');
}

export function withBlockPrefix(text, prefix) {
  const lines = String(text || '').split('\n');
  if (!lines.length) return prefix;
  return lines
    .map((l, i) => {
      if (!l.trim() && lines.length > 1) return l;
      return i === 0 || l.trim() ? prefix + l.replace(BLOCK_PREFIX_RE, '') : l;
    })
    .join('\n');
}

/** 对整块应用转变（忽略选区） */
export function turnBlock(ta, turnId) {
  if (!ta) return null;
  const cmd = TURN_INTO.find((t) => t.id === turnId || t.key === String(turnId));
  if (!cmd) return null;
  const next = cmd.apply(ta.value);
  return { value: next, start: 0, end: next.length };
}

/** 源码模式：只转变光标所在行（或选中的多行） */
export function turnLine(ta, turnId) {
  if (!ta) return null;
  const cmd = TURN_INTO.find((t) => t.id === turnId || t.key === String(turnId));
  if (!cmd) return null;
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const lineEnd = (() => {
    const i = value.indexOf('\n', e);
    return i === -1 ? value.length : i;
  })();
  const block = value.slice(lineStart, lineEnd);
  const nextBlock = cmd.apply(block);
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
  return result(next, lineStart, lineStart + nextBlock.length);
}

/** 解析斜杠：仅「行首」`/query`（新行首位），行中 `/` 不触发 */
export function slashQueryAt(ta) {
  if (!ta) return null;
  const { value, selectionStart: s, selectionEnd: e } = ta;
  if (s !== e) return null;
  const before = value.slice(0, s);
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineBefore = before.slice(lineStart);
  const m = lineBefore.match(/^\/([^\s\n]*)$/);
  if (!m) return null;
  const query = m[1] || '';
  return { start: lineStart, end: s, query };
}

export function filterSlashCmds(query) {
  const q = String(query || '').toLowerCase();
  if (!q) return SLASH_CMDS;
  return SLASH_CMDS.filter((c) => c.ops.some((k) => k.startsWith(q) || k.includes(q)));
}

/** 吃掉行首 `/query`，再 turn / format */
export function applySlashCommand(ta, cmd) {
  const hit = slashQueryAt(ta);
  if (!hit || !cmd) return null;
  const { value } = ta;
  const cleared = value.slice(0, hit.start) + value.slice(hit.end);
  const fake = {
    value: cleared,
    selectionStart: hit.start,
    selectionEnd: hit.start,
  };
  if (cmd.turn) return turnLine(fake, cmd.turn);
  return runFormat(fake, cmd.format);
}

/** 全文查找（大小写不敏感）；返回 [{ start, end }] */
export function findMatches(text, query) {
  const q = String(query || '');
  if (!q) return [];
  const src = String(text || '');
  const hay = src.toLowerCase();
  const needle = q.toLowerCase();
  const out = [];
  let from = 0;
  while (from <= hay.length - needle.length) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    out.push({ start: i, end: i + q.length });
    from = i + Math.max(1, needle.length);
  }
  return out;
}

/** 粗略滚到字符偏移（逻辑行 × line-height） */
export function scrollTextareaToIndex(ta, index) {
  if (!ta) return;
  const before = String(ta.value || '').slice(0, Math.max(0, index));
  const line = before.split('\n').length;
  const cs = getComputedStyle(ta);
  let lh = parseFloat(cs.lineHeight);
  if (!Number.isFinite(lh) || lh <= 0) {
    lh = (parseFloat(cs.fontSize) || 13) * 1.7;
  }
  const pad = parseFloat(cs.paddingTop) || 0;
  ta.scrollTop = Math.max(0, pad + (line - 2) * lh - ta.clientHeight / 3);
}

/** 从 DataTransfer / Clipboard 收集图片 File */
export function imageFilesFromDataTransfer(dt) {
  if (!dt) return [];
  const out = [];
  if (dt.files?.length) {
    for (const f of dt.files) {
      if (/^image\//.test(f.type)) out.push(f);
    }
  }
  if (!out.length && dt.items?.length) {
    for (const it of dt.items) {
      if (it.kind === 'file' && /^image\//.test(it.type)) {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}
