// 侧边栏 namespace 分区的操作层（#167）：与 Sidebar 组件解耦的纯 hooks。
//
// #167 是**纯 UI 组织**：分区（namespace）= prefs.namespaces 里的 {id, name,
// items[], collapsed?, pinned?}——归属 / 排序 / 置顶 / 折叠全部落在这份显示态里，
// 不碰任何数据模型（仓库登记 / 看板 / 任务队列零改动）。
import { useCallback, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { DialogFn } from '../popup/index.js';
import type { SidebarNs } from '../../types.js';
import { UNGROUPED_KEY, type SideRow } from './model.js';
import type { MenuState } from './index.js';

/** 操作层入参：patchPrefs（持久化）+ 弹菜单/弹对话框所需的最小集。 */
export interface UseNsArgs {
  patchPrefs?: (patch: Partial<Record<string, unknown>> | ((prev: Record<string, unknown>) => Partial<Record<string, unknown>>)) => void;
  toast: (msg: string) => void;
  dialog: DialogFn;
  setMenu: (m: MenuState | null) => void;
}

export function useNamespaces({ patchPrefs, toast, dialog, setMenu }: UseNsArgs) {
  const [nsForm, setNsForm] = useState<{ id: string; name: string; moveTo?: string } | null>(null);

  const withNs = useCallback(
    (fn: (list: SidebarNs[]) => SidebarNs[]) => {
      patchPrefs?.((p) => ({
        namespaces: fn(Array.isArray(p.namespaces) ? p.namespaces.map((n) => ({ ...n, items: [...n.items] })) : []),
      }));
    },
    [patchPrefs]
  );

  const rowKeyOf = (row: SideRow): string =>
    row.type === 'board' ? 'board:' + String(row.id) : String(row.key || '');

  const toggleNsCollapse = useCallback(
    (nsId: string) => {
      // #174：「未分组」不是真分区——折叠态走 prefs.nsUngroupedOpen（默认折叠）
      if (nsId === UNGROUPED_KEY) {
        patchPrefs?.((p) => ({ nsUngroupedOpen: !(p.nsUngroupedOpen === true) }));
        return;
      }
      withNs((list) => list.map((n) => (n.id === nsId ? { ...n, collapsed: !n.collapsed } : n)));
    },
    [withNs, patchPrefs]
  );

  /** #174：下拉框聚焦（'' = 全部 / ACTIVE_KEY = 运行中 / ns id = 单分区） */
  const setFocusNs = useCallback(
    (focus: string) => patchPrefs?.({ focusNs: String(focus || '') }),
    [patchPrefs]
  );
  const toggleNsPinned = useCallback(
    (nsId: string) => withNs((list) => list.map((n) => (n.id === nsId ? { ...n, pinned: !n.pinned } : n))),
    [withNs]
  );
  const moveNs = useCallback(
    (nsId: string, dir: -1 | 1) => withNs((list) => {
      const i = list.findIndex((n) => n.id === nsId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const arr = [...list];
      const a = arr[i];
      const b = arr[j];
      if (!a || !b) return list;
      arr[i] = b;
      arr[j] = a;
      return arr;
    }),
    [withNs]
  );
  const removeNs = useCallback(
    (nsId: string) => withNs((list) => list.filter((n) => n.id !== nsId)),
    [withNs]
  );
  const moveToNs = useCallback(
    (row: SideRow, nsId: string) => {
      const k = rowKeyOf(row);
      if (!k) return;
      withNs((list) => {
        const arr = list.map((n) => ({ ...n, items: n.items.filter((x) => x !== k) }));
        const t = arr.find((n) => n.id === nsId);
        if (t) t.items.push(k);
        return arr;
      });
    },
    [withNs]
  );
  /** #180：把条目加入命名空间——**允许多归属**（同一 topic 可同时在多个 ns 里），
   *  只做本 ns 内去重，不从其它 ns 挪走。 */
  const addToNs = useCallback(
    (nsId: string, keys: string[]) => {
      const ks = (keys || []).filter(Boolean);
      if (!ks.length) return;
      withNs((list) =>
        list.map((n) => {
          if (n.id !== nsId) return n;
          const add = ks.filter((k) => !n.items.includes(k));
          return add.length ? { ...n, items: [...n.items, ...add] } : n;
        })
      );
    },
    [withNs]
  );

  const removeFromNs = useCallback(
    (row: SideRow) => {
      const k = rowKeyOf(row);
      if (!k) return;
      // #180：多归属——只从当前这份（nsId）spaces 移除，其它命名空间不受影响
      const nsId = (row as SideRow & { nsId?: string }).nsId;
      withNs((list) => list.map((n) => {
        if (nsId && n.id !== nsId) return n;
        return n.items.includes(k) ? { ...n, items: n.items.filter((x) => x !== k) } : n;
      }));
    },
    [withNs]
  );
  /** #256：管理弹窗里按**条目键**移除（无需 SideRow——键形与 items 一致：'board:<id>' | '<仓库key>'）。
      只从指定分区移除，登记与其它分区不受影响。 */
  const removeItemFromNs = useCallback(
    (nsId: string, itemKey: string) => {
      const k = String(itemKey || '');
      if (!k) return;
      withNs((list) => list.map((n) => (n.id !== nsId ? n : { ...n, items: n.items.filter((x) => x !== k) })));
    },
    [withNs]
  );
  const newNsAndMove = useCallback(
    (name: string, moveKey: string | null) => {
      const k = String(moveKey || '');
      const id = 'ns_' + Date.now().toString(36);
      withNs((list) => {
        const arr = list.map((n) => ({ ...n, items: n.items.filter((x) => x !== k) }));
        arr.push({ id, name, items: k ? [k] : [] });
        return arr;
      });
      toast(`已新建分区「${name}」${k ? '并移入对应条目' : ''}`);
    },
    [withNs, toast]
  );
  const renameNs = useCallback(
    (nsId: string, name: string) => withNs((list) => list.map((n) => (n.id === nsId ? { ...n, name } : n))),
    [withNs]
  );

  /** ns 头行菜单（⋯ / 右键）：重命名 / 置顶 / 移动 / 折叠 / 删除。 */
  const openNsMenu = useCallback(
    (e: ReactMouseEvent<HTMLElement>, row: SideRow) => {
      e.preventDefault();
      e.stopPropagation();
      const isUngrouped = row.key === UNGROUPED_KEY;
      setMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          ...(isUngrouped ? [] : [{ label: '重命名…', icon: 'edit', onClick: () => setNsForm({ id: row.key, name: row.name }) }]),
          { label: row.collapsed ? '展开分区' : '折叠分区', icon: 'chevron', onClick: () => toggleNsCollapse(row.key) },
          ...(isUngrouped
            ? []
            : [
                { label: row.pinned ? '取消置顶' : '置顶分区', icon: 'pin', onClick: () => toggleNsPinned(row.key) },
                { label: '上移', icon: 'back', onClick: () => moveNs(row.key, -1) },
                { label: '下移', icon: 'chevron', onClick: () => moveNs(row.key, 1) },
                'sep' as const,
                {
                  label: '删除分区（条目回未分组）',
                  icon: 'trash',
                  danger: true,
                  onClick: async () => {
                    const ok = await dialog({
                      title: `删除分区「${row.name}」`,
                      message: `分区里的 ${row.count} 个条目会回到未分组（登记与看板不受影响）。`,
                      danger: true,
                      okText: '删除',
                    });
                    if (ok) removeNs(row.key);
                  },
                },
              ]),
        ],
      });
    },
    [dialog, moveNs, removeNs, toggleNsCollapse, toggleNsPinned]
  );

  return { nsForm, setNsForm, toggleNsCollapse, moveToNs, addToNs, removeFromNs, removeItemFromNs, newNsAndMove, renameNs, openNsMenu, setFocusNs, moveNs, removeNs };
}
