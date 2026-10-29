// 页签栏（封装组件）：主面板顶部的多页签，切换 / 关闭 / 新建。
// 纯展示：不持有状态、不碰路由——tabs/activeId/回调由调用方注入，
// 这样工作台之外（将来其它面板）也能直接复用。
import { Icon } from '../icons.jsx';

export default function TabBar({ tabs, activeId, onSelect, onClose, onNew, newLabel = '新建页' }) {
  if (!tabs?.length && !onNew) return null;
  return (
    <div className="tabbar" role="tablist" aria-label="打开的页面">
      <div className="tabbar-strip">
        {(tabs || []).map((t) => (
          <div
            key={t.id}
            role="tab"
            tabIndex={0}
            aria-selected={t.id === activeId}
            className={'tab' + (t.id === activeId ? ' on' : '') + (t.tone ? ` tone-${t.tone}` : '')}
            title={t.title}
            onClick={() => onSelect(t.id)}
            onAuxClick={(e) => {
              if (e.button === 1 && onClose) {
                e.preventDefault();
                onClose(t.id);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(t.id);
              }
            }}
          >
            <span className="tt">{t.title || '未命名'}</span>
            {onClose && (
              <span
                className="tx" role="button" tabIndex={-1}
                aria-label={`关闭「${t.title || '未命名'}」`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
              >
                <Icon name="x" size={11} />
              </span>
            )}
          </div>
        ))}
        {onNew && (
          <button type="button" className="tab-new" title={newLabel} aria-label={newLabel} onClick={onNew}>
            <Icon name="plus" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
