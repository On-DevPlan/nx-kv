// 行尾「⋯」菜单：低频操作收进来，高频操作（完成/解冻）留直出按钮。
// 点外/按 Esc 关闭；菜单项 { label, danger?, onPick }。
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../web/frontend/components/icons.jsx';

export default function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <span className="rowmenu" ref={ref}>
      <button
        type="button"
        className="rowmenu-btn"
        aria-label="更多操作"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="dots" size={13} />
      </button>
      {open ? (
        <span className="rowmenu-pop" role="menu">
          {list.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={'rowmenu-item' + (it.danger ? ' danger' : '')}
              onClick={() => { setOpen(false); it.onPick(); }}
            >
              {it.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
