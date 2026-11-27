// 左下角 sfoot 的插件条目：插件 client bundle 自注册，宿主只负责渲染与导航。
import { Icon } from '../icons.jsx';
import { usePluginSidebar } from '../../plugin-host/registry.js';
import type { AppRoute } from '../../types.js';

export default function PluginFootEntries({
  route,
  onNavigate,
}: {
  route?: Partial<AppRoute>;
  onNavigate?: (hash: string) => void;
}) {
  const entries = usePluginSidebar();
  return (
    <>
      {entries.map(({ pluginId, entry }) => (
        <button
          key={`${pluginId}:${entry.id}`}
          className={'trow' + (route?.pluginId === pluginId && route?.pageId === entry.page ? ' active' : '')}
          onClick={() =>
            onNavigate?.(`#/plugin/${encodeURIComponent(pluginId)}/${encodeURIComponent(entry.page)}`)
          }
        >
          <span className="gico"><Icon name={entry.icon || 'list'} /></span>
          <span className="nm">{entry.label}</span>
        </button>
      ))}
    </>
  );
}
