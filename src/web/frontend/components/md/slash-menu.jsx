// 行首 `/` 斜杠命令菜单：键盘交互（↑↓/Enter/Tab/Esc）与浮层组件。
// 实时预览与源码两个编辑器共用（菜单位置算法不同，由调用方算好 x/y 传入）。
import { useEffect, useRef } from 'react';

function isSlashArrow(e) {
  return e.key === 'ArrowDown' || e.key === 'ArrowUp'
    || e.code === 'ArrowDown' || e.code === 'ArrowUp';
}

export function slashActiveIndex(s) {
  if (!s?.items?.length) return 0;
  const a = s.active;
  if (typeof a !== 'number' || Number.isNaN(a)) return 0;
  return Math.min(Math.max(0, a), s.items.length - 1);
}

/** 斜杠菜单键盘：返回 true 表示已处理 */
export function handleSlashKey(e, slashRef, { move, pick, close }) {
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

export function SlashMenu({ items, active, onPick, onHover, style }) {
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
