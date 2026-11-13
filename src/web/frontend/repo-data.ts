// 侧栏两个接口（/api/repos、/api/boards）的载荷归一与合并。
//
// **为什么单独一层**（#194「创建完项目组后 侧边栏树会消失变空白」）：
// 侧栏树的数据由仓库与看板两份清单**共同**构成，而这两份清单原先是一次原子更新
// （`Promise.all` + 一次 setState）。任一份失败——某个仓库目录读盘出错让 /api/repos
// 500、或在慢盘上扫 31 个仓库的 git 超过 30s 请求超时——**两半都被丢弃**，
// repoData 一直停在初始的 `{repos:[], boards:[]}`，侧栏树就整块变空白；
// 此时再点「＋ → 新建看板」，后端建组成功、toast 也报成功，但刷新仍走这条
// 注定失败的路径，树毫无变化（用户看到的就是「创建完项目组后树消失变空白」）。
//
// 所以：① 两份清单各自成败、各自生效（失败的一半保留旧值，绝不清空）；
// ② 载荷形状在这里收口——`{boards, unassigned}` 与裸数组都认，认不出就返回 null
// 让调用方保留旧值，而不是拿空数组把树抹平。
import type { BoardRow, RepoData, RepoRow } from './types.js';

/** /api/repos 的载荷 → 仓库数组；认不出形状返回 null（= 保留旧值）。 */
export function reposOf(payload: unknown): RepoRow[] | null {
  if (Array.isArray(payload)) return payload as RepoRow[];
  const inner = (payload as { repos?: unknown } | null)?.repos;
  return Array.isArray(inner) ? (inner as RepoRow[]) : null;
}

/** /api/boards 的载荷 → 看板数组；`{boards}` 与裸数组都认，其余返回 null。 */
export function boardsOf(payload: unknown): BoardRow[] | null {
  if (Array.isArray(payload)) return payload as BoardRow[];
  const inner = (payload as { boards?: unknown } | null)?.boards;
  return Array.isArray(inner) ? (inner as BoardRow[]) : null;
}

/** 参考仓库不进侧栏（侧栏只认开发仓库）。 */
export function devReposOnly(list: RepoRow[]): RepoRow[] {
  return list.filter((r) => (r.type || 'dev') !== 'ref');
}

/**
 * 两份清单的一次刷新结果 → 下一版 repoData。
 * 每一半**独立**判断：成功且形状可识别就换新值，其余一律沿用旧值。
 */
export function nextRepoData(
  prev: RepoData,
  patch: { repos?: unknown; boards?: unknown }
): RepoData {
  const repos = patch.repos === undefined ? null : reposOf(patch.repos);
  const boards = patch.boards === undefined ? null : boardsOf(patch.boards);
  return {
    repos: repos === null ? prev.repos : devReposOnly(repos),
    boards: boards === null ? prev.boards : boards,
  };
}
