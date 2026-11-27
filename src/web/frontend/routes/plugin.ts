// 通用插件页面：#/plugin/<pluginId>/<pageId>[/<sessionId>]
// 页面组件由插件 client bundle 注册；宿主只负责路由与挂载。
import type { AppRoute, SpecCtx } from '../types.js';
import { definePage } from './types.js';

export const pluginPage = definePage({
  view: 'plugin',
  panelOf: (route: AppRoute, _ctx: SpecCtx) => {
    const pluginId = String(route.pluginId || '');
    const pageId = String(route.pageId || '');
    if (!pluginId || !pageId) return null;
    return {
      panel: {
        component: 'plugin-page',
        config: {
          pluginId,
          pageId,
          sessionId: String(route.sessionId || ''),
        },
      },
      name: '插件页面',
    };
  },
  reverse: [
    {
      component: 'plugin-page',
      order: 0,
      format: (cfg) => {
        const pluginId = String(cfg.pluginId || '');
        const pageId = String(cfg.pageId || '');
        if (!pluginId || !pageId) return undefined;
        const base = `#/plugin/${encodeURIComponent(pluginId)}/${encodeURIComponent(pageId)}`;
        return cfg.sessionId ? `${base}/${encodeURIComponent(String(cfg.sessionId))}` : base;
      },
    },
  ],
});
