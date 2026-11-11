// 行首 `/` 斜杠命令菜单：键盘交互（↑↓/Enter/Tab/Esc）与浮层组件。
// 实时预览与源码两个编辑器共用（菜单位置算法不同，由调用方算好 x/y 传入）。
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

/** 一条斜杠命令（md-edit-ops 的 SLASH_CMDS 元素）。 */
export interface SlashItem {
  id: string;
  label: string;
  hint: string;
  [k: string]: any;
}

/** 浮层状态：index 是预览态的块序号（源码态没有）。 */
export interface SlashState {
  [k: string]: any;
  index?: number;
  query: string;
  items: SlashItem[];
  active: number;
  x: number;
  y: number;
}

/**
 * 按键事件的最小面：React 合成事件与原生 KeyboardEvent 都满足——
 * 斜杠菜单既在 onKeyDown 里判（合成），也在 document 捕获里兜底（原生）。
 */
export interface SlashKeyEvent {
  key: string;
  code: string;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/** 菜单状态的最小读取面（ref 里的当前值 / 组件 props）。 */
interface SlashStateLike {
  items?: SlashItem[];
  active?: number;
}

function isSlashArrow(e: SlashKeyEvent) {
  return e.key === 'ArrowDown' || e.key === 'ArrowUp'
    || e.code === 'ArrowDown' || e.code === 'ArrowUp';
}

export function slashActiveIndex(s: SlashStateLike | null | undefined) {
  if (!s?.items?.length) return 0;
  const a = s.active;
  if (typeof a !== 'number' || Number.isNaN(a)) return 0;
  return Math.min(Math.max(0, a), s.items.length - 1);
}

/** 斜杠菜单键盘：返回 true 表示已处理 */
export function handleSlashKey(
  e: SlashKeyEvent,
  slashRef: { current: SlashState | null },
  { move, pick, close }: {
    move: (delta: number) => void;
    pick: (cmd: SlashItem | undefined) => void;
    close: () => void;
  },
) {
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

export interface SlashMenuProps {
  items: SlashItem[];
  active: number;
  onPick: (c: SlashItem) => void;
  onHover: (i: number) => void;
  style?: CSSProperties;
}

export function SlashMenu({ items, active, onPick, onHover, style }: SlashMenuProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
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
