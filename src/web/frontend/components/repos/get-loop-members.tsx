// 组页「持续 get」成员子菜单（#250）：dir 与 group 面板功能对齐——
// dir 主页「更多 → 持续 get」直接开 GetLoopModal（页面只对应一个仓库）；
// 组横跨多个成员仓库，而 getLoop 是**仓库级**配置，所以组页先弹成员子菜单
// （每行带当前开关状态），选中成员由调用方开同一颗 GetLoopModal——配置语义与 dir 同源。
//
// ⚠️ 契约：本组件是**纯子菜单**，只回传选中的仓库（onPick）。选中/弹窗状态必须由
// 调用方持有——PopMenu 的条目点击是「先 onClose 再 onClick」，选中状态若存在组件
// 内部，会随外层 onClose 的卸载一起丢掉（探针实测踩过：弹窗永远开不出来）。
//
// 未登记本机仓库的占位成员不进列表：没有仓库 id 就没有 PATCH /api/repos/:id 的落点，
// 点了也存不了（GetLoopModal 对 id 缺失同样只读）。
import { useMemo } from 'react';
import { PopMenu } from '../popup/index.jsx';
import type { RepoRow } from '../../types.js';

/** 子菜单里的成员行（组页 MemberItem 的 key/name 已够用，按最小面收窄）。 */
export interface GetLoopMemberRef {
  key: string;
  name: string;
}

/** 阻塞窗口的兜底显示值（与 GetLoopModal 的 DEFAULT_MINUTES 同口径）。 */
const DEFAULT_MINUTES = 10;

export default function GetLoopMembersMenu({ x, y, members, repos, onPick, onClose }: {
  /** 弹出坐标（视口系，来自触发点击） */
  x: number;
  y: number;
  members: GetLoopMemberRef[];
  repos: RepoRow[];
  /** 选中成员项目（调用方据此开 GetLoopModal） */
  onPick: (repo: RepoRow) => void;
  /** 菜单收尾（点外 / Esc 关闭；条目点击也会先走它，调用方状态要经得住「关了再选」） */
  onClose: () => void;
}) {
  const repoByKey = useMemo(() => new Map(repos.map((r) => [r.key, r])), [repos]);

  const items = members
    .map((m) => ({ m, repo: repoByKey.get(m.key) || null }))
    .filter((x): x is { m: GetLoopMemberRef; repo: RepoRow } => !!(x.repo && x.repo.id))
    .map(({ m, repo }) => {
      const loop = repo.getLoop && typeof repo.getLoop === 'object' ? repo.getLoop : null;
      const on = !!(loop && loop.enabled);
      const raw = loop ? loop.waitMinutes : undefined;
      const mm = raw !== undefined && raw !== null ? Number(raw) : DEFAULT_MINUTES;
      return {
        label: `${m.name} · ${on ? `开（${mm} 分钟）` : '关'}`,
        icon: on ? 'check' : 'refresh',
        onClick: () => onPick(repo),
      };
    });

  return <PopMenu x={x} y={y} items={items} onClose={onClose} />;
}
