// 设置 → 插件：内部插件清单 + 全局开关 + 打开插件自管理页。
// 插件自管理页由插件 client bundle 注册在左下角 sfoot，这里只做导航。
import { useApp } from '../../app-context.jsx';
import { Button } from '../../components/button/index.jsx';
import { Icon } from '../../components/icons.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { usePlugins } from '../../modules/pretask/use-plugins.js';
import { pluginUiOf, usePluginUiVersion } from '../../plugin-host/registry.js';
import '../../plugin-host/style.css';

export default function PluginsSection() {
  const app = useApp();
  const toast = useToast();
  const { plugins, loading, error, setEnabled } = usePlugins();
  usePluginUiVersion();

  const openManage = (pluginId: string) => {
    const first = pluginUiOf(pluginId)?.sidebar?.[0];
    if (!first) {
      toast('这个插件还没有注册管理页');
      return;
    }
    app.onNavigate?.(`#/plugin/${encodeURIComponent(pluginId)}/${encodeURIComponent(first.page)}`);
  };

  return (
    <>
      <div className="setp-note">
        插件开关是全局的；每个主题具体显示哪些入口、点「＋ 新建页」默认触发哪一项，在新建任务下拉的「配置新建页行为…」里编辑。
      </div>
      {loading ? <div className="muted" style={{ padding: 8 }}>读取插件清单…</div> : null}
      {error ? <div className="muted" style={{ padding: 8 }}>读取失败：{error}</div> : null}
      <div className="plugin-set-list">
        {plugins.map((plugin) => {
          const hasManage = !!pluginUiOf(plugin.id)?.sidebar?.length;
          return (
            <div className="plugin-set-row" key={plugin.id}>
              <div className="plugin-set-main">
                <div className="plugin-set-name">
                  <Icon name="flow" size={14} />
                  <span>{plugin.name}</span>
                  <span className="plugin-set-id">{plugin.id}</span>
                  <span className="plugin-set-ver">v{plugin.version || '?'}</span>
                </div>
                <div className="plugin-set-desc">
                  {plugin.description || '（无描述）'}
                  <span className="plugin-set-meta"> · {plugin.entryCount} 个入口</span>
                  {plugin.error ? <span className="plugin-set-err"> · {plugin.error}</span> : null}
                </div>
              </div>
              <div className="plugin-set-acts">
                <Button
                  variant="secondary"
                  small
                  disabled={!hasManage}
                  onClick={() => openManage(plugin.id)}
                >
                  打开管理页
                </Button>
                <button
                  type="button"
                  className={'toggle' + (plugin.enabled ? ' on' : '')}
                  onClick={() => void setEnabled(plugin.id, !plugin.enabled)}
                >
                  <span className="dot" />
                  {plugin.enabled ? '开' : '关'}
                </button>
              </div>
            </div>
          );
        })}
        {!loading && !plugins.length && !error ? (
          <div className="muted" style={{ padding: 8 }}>没有加载到任何插件包。</div>
        ) : null}
      </div>
    </>
  );
}
