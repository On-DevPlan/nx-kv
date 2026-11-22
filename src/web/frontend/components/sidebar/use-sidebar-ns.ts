// 侧栏分区的装配 hook（#178）：把「分区操作 + 成员选择弹窗状态 + 候选计算」收成一处，
// index.tsx 只留一行接线（行数门禁 + 关注点分离）。纯 UI 显示态，落 prefs.namespaces。
import { useState } from 'react';
import type { BoardRow, Prefs, RepoRow, SidebarNs } from '../../types.js';
import { useNamespaces, type UseNsArgs } from './use-ns.js';
import type { NsCandidate } from './ns-add-modal.js';

export interface UseSidebarNsArgs extends UseNsArgs {
  repos?: RepoRow[] | null;
  boards?: BoardRow[] | null;
  namespaces?: SidebarNs[];
}

export function useSidebarNs({ repos, boards, namespaces, ...nsArgs }: UseSidebarNsArgs) {
  const ops = useNamespaces(nsArgs);
  // 成员选择弹窗的目标分区 id（null = 关闭）
  const [addFor, setAddFor] = useState<string | null>(null);
  // #179：分区管理弹窗（重命名 / 排序 / 删除 / 新建）
  const [manageOpen, setManageOpen] = useState(false);

  /** 某分区的添加候选：所有仓库/看板（未在本分区的排前；已在其它分区的标注出来）。 */
  const candidatesFor = (nsId: string): NsCandidate[] => {
    const list = Array.isArray(namespaces) ? namespaces : [];
    const target = list.find((n) => n.id === nsId);
    const inTarget = new Set(target?.items || []);
    const whereOf = (k: string): string => {
      const owner = list.find((n) => n.items.includes(k));
      return owner && owner.id !== nsId ? owner.name : '';
    };
    const out: NsCandidate[] = [];
    for (const b of (boards || []) as any[]) {
      const k = 'board:' + String(b.id);
      if (inTarget.has(k)) continue;
      out.push({ key: k, label: String(b.name || b.id), kind: 'board', inNsName: whereOf(k) });
    }
    for (const r of (repos || []) as any[]) {
      const k = String(r.key || r.id);
      if (inTarget.has(k)) continue;
      out.push({ key: k, label: String(r.name || k), kind: 'repo', inNsName: whereOf(k) });
    }
    return out;
  };

  /** #180：拖到顶部切换器 → 加入当前命名空间（focus 空时 = 第一个） */
  const dropToCurrent = (key: string, focus: string) => {
    const cur = focus || namespaces?.[0]?.id || '';
    // dataTransfer 存的是 'repo:<key>' / 'board:<id>'；namespace items 里仓库用裸 key
    const normalized = key.startsWith('repo:') ? key.slice(5) : key;
    if (cur && normalized) ops.addToNs(cur, [normalized]);
  };

  return { ...ops, addFor, setAddFor, candidatesFor, manageOpen, setManageOpen, dropToCurrent };
}
