// 两个「单例页」视图：仓库管理 / 全部目录总览。
//
// 它们没有参数（地址就是身份），所以两个方向都只有一行；合在一个文件里是刻意的——
// 各自单独开文件反而看不出「这两者同构」。
import type { AppRoute, SpecCtx } from '../types.js';
import { definePage, type RoutePage } from './types.js';

function singleton(view: string, component: string, title: string): RoutePage {
  return definePage({
    view,
    panelOf: (_route: AppRoute, _ctx: SpecCtx) => ({
      panel: { component, config: {} },
      name: title,
    }),
    reverse: [{ component, order: 0, format: () => `#/${view}` }],
  });
}

export const reposPage = singleton('repos', 'repos', '仓库管理');
export const overviewPage = singleton('overview', 'overview', '全部目录总览');
