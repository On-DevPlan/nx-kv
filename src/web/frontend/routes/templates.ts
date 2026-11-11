// 任务模板视图（`#/templates`、`#/templates/edit/<id>`、`#/templates/new?topic=&scope=`）。
//
// 三个形态共用一个 component：区别全在 config 的 mode 上。所以 config 必须能把
// 地址**逐字**复现——#137 踩过的坑：编辑/新建没把 mode 写进地址，选中回调把 hash
// 压成 `#/templates`，路由 effect 用空 config 重开 → 落到「模板目录」空页，
// 冲掉全屏编辑器。
import type { AppRoute, SpecCtx } from '../types.js';
import { definePage } from './types.js';

export const templatesPage = definePage({
  view: 'templates',
  panelOf: (route: AppRoute, _ctx: SpecCtx) => {
    if (route.mode === 'edit' && route.id) {
      return {
        panel: {
          component: 'templates',
          config: { mode: 'edit', id: String(route.id), name: '', topic: '', scope: [] },
        },
        name: '编辑模板',
      };
    }
    if (route.mode === 'new') {
      const scope = String(route.scope || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        panel: {
          component: 'templates',
          config: {
            mode: 'new',
            id: '',
            name: '',
            topic: String(route.topic || ''),
            scope,
          },
        },
        name: '新建模板',
      };
    }
    return { panel: { component: 'templates', config: {} }, name: '任务模板' };
  },
  reverse: [
    {
      component: 'templates',
      order: 0,
      format: (cfg) => {
        // #137：编辑/新建必须把 mode 写进地址（见文件头注释）
        const mode = String(cfg.mode || '');
        if (mode === 'edit' && cfg.id) {
          return `#/templates/edit/${encodeURIComponent(cfg.id)}`;
        }
        if (mode === 'new') {
          const parts: string[] = [];
          if (cfg.topic) parts.push(`topic=${encodeURIComponent(cfg.topic)}`);
          if (Array.isArray(cfg.scope) && cfg.scope.length) {
            parts.push(`scope=${encodeURIComponent(cfg.scope.join(','))}`);
          }
          return parts.length ? `#/templates/new?${parts.join('&')}` : '#/templates/new';
        }
        return '#/templates';
      },
    },
  ],
});
