// 浮层菜单（gmenu）：点外可关、Esc 可关；打开时焦点进第一项、↑↓ 在项间走、
// 关闭时归还触发元素焦点（原型设计稿 §6 可访问性底线）。
import { useEffect, useRef } from 'react';
import { Icon } from './icons.jsx';

/**
 * @param {number} x/y    视口坐标
 * @param {Array} items   [{label, icon?, danger?, onClick}] 或 'sep'
 * @param {Function} onClose
 */
export function PopMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const returnFocus = useRef(document.activeElement);

  useEffect(() => {
    const el = ref.current;
    const first = el && el.querySelector('button');
    if (first) first.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = [...el.querySelectorAll('button')];
        const i = btns.indexOf(document.activeElement);
        const n = btns.length;
        if (!n) return;
        const next = e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
        btns[next].focus();
      }
    };
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
      // 归还触发元素焦点
      if (returnFocus.current && document.contains(returnFocus.current)) {
        try { returnFocus.current.focus(); } catch { /* 元素可能已 unmount */ }
      }
    };
  }, [onClose]);

  // 视口内夹取：靠右/靠下时不溢出
  const style = {
    left: Math.min(x, window.innerWidth - 190),
    top: Math.min(y, window.innerHeight - 40 - items.length * 30),
  };

  return (
    <div className="gmenu" style={style} ref={ref} role="menu">
      {items.map((it, i) =>
        it === 'sep' ? (
          <div className="sep" key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={it.danger ? 'danger' : ''}
            onClick={() => { onClose(); it.onClick && it.onClick(); }}
          >
            {it.icon ? <Icon name={it.icon} /> : null}
            {it.label}
          </button>
        )
      )}
    </div>
  );
}
