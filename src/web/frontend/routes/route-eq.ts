// 路由「是否同一个位置」的相等判定（纯函数，App 的 onNavigate 用）。
//
// 为什么单独成文件：App.tsx 卡在 600 行门禁边缘，而这个判定值得写清——
// **必须比较全部字段**。曾经只比 view/key/task，于是同一视图内带不同 mode/id
// 的跳转被判成「没变」，setRoute 直接丢掉新路由，目标面板永远不出现（#153 验收反馈）。
import type { AppRoute } from '../types.js';

/** 两个路由是否指向同一个位置（字段级全比较；缺省一律按空串等价）。 */
export function sameRoute(a: AppRoute, b: AppRoute): boolean {
  return (
    a.view === b.view &&
    a.key === b.key &&
    a.task === b.task &&
    (a.mode || '') === (b.mode || '') &&
    (a.id || '') === (b.id || '') &&
    (a.topic || '') === (b.topic || '') &&
    (a.scope || '') === (b.scope || '') &&
    (a.repoKey || '') === (b.repoKey || '') &&
    (a.boardKey || '') === (b.boardKey || '')
  );
}
