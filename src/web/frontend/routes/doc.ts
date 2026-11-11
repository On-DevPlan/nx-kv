// 文档视图（`#/doc?ref=<docId>&repo=|board=&name=`）。
//
// 文档页（#88）：点文档列表的一行进来，地址要能复现同一篇。
// 归属（repo / board）一起带上——DocPanel 靠它决定「更多 → 文字列表」列谁的文章。
import type { AppRoute, PanelConfig, SpecCtx } from '../types.js';
import { docLabelOf, encodeDocRef } from './doc-ref.js';
import { definePage } from './types.js';

export const docPage = definePage({
  view: 'doc',
  panelOf: (route: AppRoute, ctx: SpecCtx) => {
    // 必须与 reverse 的 doc 分支**逐字**互逆：config 少一个字段就裂面板
    // （openPanel 按 component+config 去重）。归属字段只在有值时出现。
    if (!route.key) return null;
    const config: PanelConfig = { docId: route.key };
    if (route.repoKey) config.repoKey = route.repoKey;
    else if (route.boardKey) {
      config.boardKey = route.boardKey;
      config.boardName = route.boardName || '';
    }
    return {
      panel: { component: 'doc', config },
      name: ctx.docTitle || ctx.pageTitle || docLabelOf(route.key),
    };
  },
  reverse: [
    {
      component: 'doc',
      order: 0,
      format: (cfg) => {
        // 归属（repo / board）一起带上——DocPanel 靠它决定「更多 → 文字列表」列谁的文章。
        if (!cfg.docId) return null;
        // 手拼查询串（不走 URLSearchParams）：encodeDocRef 已自行编码，
        // 交给 URLSearchParams 会二次编码成 %252F，与 panelOf 就对不上了。
        const parts = [`ref=${encodeDocRef(cfg.docId)}`];
        if (cfg.repoKey) parts.push(`repo=${encodeURIComponent(cfg.repoKey)}`);
        else if (cfg.boardKey) {
          parts.push(`board=${encodeURIComponent(cfg.boardKey)}`);
          if (cfg.boardName) parts.push(`name=${encodeURIComponent(cfg.boardName)}`);
        }
        return `#/doc?${parts.join('&')}`;
      },
    },
  ],
});
