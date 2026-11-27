// 通用插件页面宿主：#/plugin/<pluginId>/<pageId>[/<sessionId>]
// 页面组件由插件 client bundle 注册；宿主只注入 PluginClientApi。
import { useMemo } from 'react';
import { useApp } from '../app-context.jsx';
import { useToast } from '../components/toast/index.jsx';
import { popRoute } from '../components/layout/route-history.js';
import { buildPluginClientApi } from './client-api.js';
import { PluginComponent } from './plugin-component.jsx';
import { dropPluginPageSession, getPluginPageSession } from './session.js';
import './style.css';

export interface PluginPageConfig {
  pluginId?: string;
  pageId?: string;
  sessionId?: string;
  props?: Record<string, unknown>;
}

export default function PluginPageHost({ config }: { config?: PluginPageConfig }) {
  const app = useApp();
  const toast = useToast();
  const pluginId = String(config?.pluginId || '');
  const pageId = String(config?.pageId || '');
  const session = config?.sessionId ? getPluginPageSession(config.sessionId) : undefined;
  const ctx = session?.ctx || {};
  const entry = session?.entry;

  const apiValue = useMemo(
    () =>
      buildPluginClientApi({
        pluginId,
        ctx,
        entry,
        app,
        toast,
        closePage: () => {
          dropPluginPageSession(config?.sessionId);
          const prev = popRoute();
          app.onNavigate?.(prev || '#/');
        },
        onDraftCreated: () => dropPluginPageSession(config?.sessionId),
      }),
    [pluginId, config?.sessionId, session, ctx, entry, app, toast],
  );

  if (!pluginId || !pageId) {
    return <div className="muted" style={{ padding: 20 }}>插件页面地址不完整。</div>;
  }
  return (
    <div className="plugin-page-host">
      <PluginComponent
        pluginId={pluginId}
        componentId={pageId}
        props={{ api: apiValue, ...(config?.props || {}) }}
      />
    </div>
  );
}
