// 可编排工具区（#139）：按 layout 渲染；隐藏项进「更多」；底部「编排工具区…」。
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { inMoreOf, metaOf, onBarOf } from './modules.js';
import { useToolActsLayout } from './use-layout.js';
import ToolActsLayoutPanel from './layout-panel.jsx';
import './style.css';

/**
 * @param {'dir'|'group'} kind
 * @param {Record<string, (ctx:{open:boolean}) => import('react').ReactNode>} renderers
 * @param {Record<string, () => void>} [actions] 无自定义 render 时的点击
 * @param {Record<string, string>} [titles]
 * @param {Record<string, boolean>} [disabled]
 * @param {Record<string, string>} [labels] 覆盖模块表 label（如「更多 (3)」）
 * @param {string} [className]
 */
export default function ToolActsBar({
  kind,
  renderers = {},
  actions = {},
  titles = {},
  disabled = {},
  labels = {},
  className = '',
}) {
  const { layout, setLayout } = useToolActsLayout(kind);
  const [moreOpen, setMoreOpen] = useState(false);
  const [morePos, setMorePos] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const moreBtnRef = useRef(null);
  const moreMenuRef = useRef(null);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDoc = (e) => {
      if (moreBtnRef.current?.contains(e.target)) return;
      if (moreMenuRef.current?.contains(e.target)) return;
      setMoreOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  const barItems = layout.filter((x) => onBarOf(kind, x));
  const moreItems = layout.filter((x) => inMoreOf(kind, x));

  const labelOf = (id) => labels[id] || metaOf(kind, id).label || id;

  const renderDefaultBtn = (id, opts = {}) => (
    <button
      key={id}
      type="button"
      className={opts.primary ? 'btn small primary' : 'btn small ghost'}
      title={titles[id] || labelOf(id)}
      disabled={!!disabled[id]}
      onClick={() => actions[id] && actions[id]()}
    >
      {labelOf(id)}
    </button>
  );

  const renderOne = (id) => {
    if (id === 'more') {
      return (
        <button
          key="more"
          ref={moreBtnRef}
          type="button"
          className={'btn small ghost' + (moreOpen ? ' is-open' : '')}
          title={titles.more || '更多操作'}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMorePos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
            setMoreOpen((v) => !v);
          }}
        >
          {labelOf('more')} ▾
        </button>
      );
    }
    if (renderers[id]) {
      return <span key={id} className="ta-slot">{renderers[id]({ open: moreOpen })}</span>;
    }
    return renderDefaultBtn(id, { primary: metaOf(kind, id).section === 'primary' });
  };

  return (
    <div className={'ta-bar' + (className ? ` ${className}` : '')}>
      {barItems.map((x) => renderOne(x.id))}

      {moreOpen && morePos && createPortal(
        <div
          ref={moreMenuRef}
          className="ta-more-menu"
          role="menu"
          style={{ top: morePos.top, right: morePos.right }}
        >
          {moreItems.length === 0 && (
            <div className="ta-more-empty">没有收纳的工具——可在编排里把按钮收入更多</div>
          )}
          {moreItems.map((x) => (
            <button
              key={x.id}
              type="button"
              role="menuitem"
              className="ta-more-it"
              disabled={!!disabled[x.id]}
              title={titles[x.id] || labelOf(x.id)}
              onClick={() => {
                setMoreOpen(false);
                if (actions[x.id]) actions[x.id]();
              }}
            >
              {labelOf(x.id)}
            </button>
          ))}
          <div className="ta-more-sep" />
          <button
            type="button"
            role="menuitem"
            className="ta-more-it ta-more-cfg"
            onClick={() => {
              setMoreOpen(false);
              setPanelOpen(true);
            }}
          >
            自定义工具栏…
          </button>
        </div>,
        document.body
      )}

      {panelOpen && createPortal(
        <div className="ta-panel-mask" onClick={() => setPanelOpen(false)}>
          <div className="ta-panel-wrap" onClick={(e) => e.stopPropagation()}>
            <ToolActsLayoutPanel
              kind={kind}
              layout={layout}
              setLayout={setLayout}
              onClose={() => setPanelOpen(false)}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
