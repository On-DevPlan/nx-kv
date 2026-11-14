// #105 / #109：文档列表面板的「跟随左侧目录」解析——纯函数，便于单测。
//
// 面板是常驻的：打开时写进 config 的宿主只是**那一刻**的，用户切到别的目录后它还停在
// 原来的项目上。所以生效宿主以当前**路由**为准。但「以路由为准」不能是「解析不到就回
// 落到 config」——用户点开列表里的某一行会跳到 `#/doc?...`，那一刻路由不再指向目录，
// 回退 config 就会把列表刷回最先打开时的项目（#109 反馈里「莫名回到 flutter」）。
//
// 因此返回**三态**，由面板决定怎么用：
//   host —— 路由明确指向一个仓库 / 组：切换到它（并记住）；
//   none —— 路由明确指向某个目录 / 组，但解析不出宿主（目录没登记）：显示「未登记」，
//           不能拿旧宿主冒充；
//   idle —— 当前视图与文档宿主无关（文档页、总览、仓库页…）：**保持不动**，既不刷新
//           列表，也不改标题。
import type { AppRoute, LocalTopic } from '../types.js';

export interface FollowedHost {
  repoKey?: string;
  groupKey?: string;
  name?: string;
}

export type FollowResolution =
  | ({ kind: 'host' } & FollowedHost)
  | { kind: 'none' }
  | { kind: 'idle' };

/** 路径归一（与后端 normalizePathKey 同口径：分隔符统一 + 大小写不敏感）。 */
function normPath(p: unknown): string {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function boardOf(boards: any[] | undefined, raw: string): any {
  return (boards || []).find(
    (x: any) =>
      String(x.id || '') === raw ||
      String(x.key || '') === raw ||
      String(x.name || '').toLowerCase() === raw.toLowerCase()
  );
}

/**
 * 路由 → 文档列表宿主的解析结果（三态，见文件头）。
 * @param route 当前路由（App 维护）
 * @param rows 本机队列主题（带 repo / cwd）
 * @param repos 已登记仓库
 * @param boards 看板（组）
 */
export function resolveFollowedHost(
  route: Partial<AppRoute> | null | undefined,
  rows: LocalTopic[] | undefined,
  repos: any[] | undefined,
  boards: any[] | undefined
): FollowResolution {
  if (!route) return { kind: 'idle' };
  const list = repos || [];

  if (route.view === 'dir' && route.key) {
    const topic = (rows || []).find((r) => r.key === route.key) as any;
    const topicKey = String(topic?.repo?.key || '').trim();
    const byKey = topicKey ? list.find((r) => String(r.key || '') === topicKey) : undefined;
    const cwd = normPath(topic?.cwd);
    const byPath = cwd ? list.find((r) => normPath(r.path) === cwd) : undefined;
    const hit = byKey || byPath;
    // 目录没登记成仓库 → 明确「无宿主」（面板提示去 repo add），不拿旧宿主冒充
    return hit ? { kind: 'host', repoKey: String(hit.key || ''), name: String(hit.name || '') } : { kind: 'none' };
  }

  if (route.view === 'group' && route.key) {
    const raw = String(route.key);
    const b = boardOf(boards, raw);
    return b
      ? { kind: 'host', groupKey: String(b.key || raw), name: String(b.name || raw) }
      : { kind: 'host', groupKey: raw, name: raw }; // 看板清单还没加载时按原值当 key，不吞
  }

  // 文档页（#109 的关键）：点开列表里的某一行会进 #/doc?ref=…&repo=…（或 &board=…），
  // 这仍是「同一个宿主」的延续——从这里认宿主，列表就不会跳回别处。
  if (route.view === 'doc') {
    const rk = String(route.repoKey || '').trim();
    const bk = String(route.boardKey || '').trim();
    if (rk) {
      const r = list.find((x) => String(x.key || '') === rk) as any;
      return { kind: 'host', repoKey: rk, name: String(r?.name || rk) };
    }
    if (bk) return { kind: 'host', groupKey: bk, name: String(route.boardName || bk) };
    return { kind: 'idle' };
  }

  // 总览 / 仓库页 / 模板页…：与宿主无关，保持列表原样
  return { kind: 'idle' };
}
