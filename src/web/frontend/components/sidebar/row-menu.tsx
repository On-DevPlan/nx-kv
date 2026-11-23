// 侧边栏的菜单装配：行菜单（⋯ / 右键）+「＋」菜单。
// （设置已从气泡菜单搬进**浮动设置面板** modules/settings/panel.jsx）
//
// 只回答「菜单里有什么」——怎么弹、怎么关、键盘怎么走，在 components/popup 的 PopMenu；
// 菜单项点了之后改什么，由调用方传进来的回调决定。
//
// **菜单操作的是真实数据**：看板归属走 board assign（仓库页的那套看板），
// 「＋」菜单是登记仓库 / 新建看板——不再有「本地分组」这种只活在浏览器里的东西。
import { api } from '../../api/client.js';
import type { BoardRow, Prefs, SidebarNs } from '../../types.js';
import type { DialogFn, PopMenuItem } from '../popup/index.js';
import type { SideRow } from './model.js';
import { ensureQueueAndGo } from './queue-nav.js';

/** rowMenuItems 的入参（菜单内容按行类型装配）。 */
export interface RowMenuArgs {
  row: SideRow;
  prefs: Partial<Prefs>;
  patchPrefs?: (patch: Partial<Prefs> | ((prev: Prefs) => Partial<Prefs>)) => void;
  onNavigate?: (hash: string) => void;
  boards?: BoardRow[] | null;
  onDataChanged?: () => void;
  refreshLocal?: () => Promise<void>;
  toast: (msg: string) => void;
  dialog: DialogFn;
  /** #167：namespace 分区清单与归属操作（条目菜单的「移入/移出分区」） */
  namespaces?: SidebarNs[];
  onMoveToNs?: (row: SideRow, nsId: string, nsName: string) => void;
  onRemoveFromNs?: (row: SideRow) => void;
  onNewNsFor?: (row: SideRow) => void;
}

/** 仓库行 / 看板行 / 全局池行的菜单项 */
export function rowMenuItems({ row, prefs, patchPrefs, onNavigate, boards, onDataChanged, refreshLocal, toast, dialog, namespaces, onMoveToNs, onRemoveFromNs, onNewNsFor }: RowMenuArgs): PopMenuItem[] {
  // #167：分区归属操作（repo / board 行通用）。当前所在分区由 items 反查。
  const nsList = Array.isArray(namespaces) ? namespaces : [];
  const rowKey = row.type === 'board' ? 'board:' + String(row.id) : String(row.key || '');
  // #180：概览里成员行带 nsId（同一 topic 可在多个 ns）——「从本空间移出」只移除当前这份
  const currentNs = (row.nsId && nsList.find((n) => n.id === row.nsId))
    || nsList.find((n) => n.items.includes(rowKey));
  const nsSection: PopMenuItem[] = nsList.length || currentNs ? [
    'sep',
    // 移入分区（排除当前所在）
    ...nsList
      .filter((n) => n.id !== currentNs?.id)
      .map((n) => ({
        label: `移入分区「${n.name}」`,
        icon: 'flow',
        onClick: () => onMoveToNs?.(row, n.id, n.name),
      })),
    ...(onNewNsFor
      ? [{ label: '新建分区并移入…', icon: 'plus', onClick: () => onNewNsFor?.(row) }]
      : []),
    ...(currentNs && onRemoveFromNs
      ? [{ label: `从「${currentNs.name}」移出`, icon: 'x', onClick: () => onRemoveFromNs?.(row) }]
      : []),
  ] : [];

  if (row.type === 'repo') {
    const boardList = boards || [];
    // 归属看板上带 key（看板的成员按 key 存）
    const inBoard = (b: BoardRow) => (row.boards || []).some((x) => x.key === b.key || x.id === b.id);
    const assign = async (b: BoardRow, remove: boolean) => {
      try {
        await api('/api/boards/assign', {
          method: 'POST',
          body: remove
            ? { key: row.key, board: b.key || b.id, remove: true }
            : { key: row.key, board: b.key || b.id },
        });
        if (onDataChanged) onDataChanged();
      } catch (err) {
        // catch 变量是 unknown：只取 message
        toast('归属变更失败: ' + (err as Error).message);
      }
    };
    return [
      // 没队列的仓库也能进详情：先建队列再跳（幂等，见 queue-nav.js）
      { label: '打开详情', icon: 'folder', onClick: () => ensureQueueAndGo({ row, onNavigate, refreshLocal, toast }) },
      { label: '置顶', icon: 'pin', onClick: () => patchPrefs?.({ order: [row.key, ...(prefs.order || []).filter((k) => k !== row.key)] }) },
      'sep',
      ...boardList.map((b) => ({
        label: (inBoard(b) ? '✓ ' : '') + (inBoard(b) ? '移出「' : '归入「') + b.name + '」',
        icon: 'folder',
        onClick: () => assign(b, inBoard(b)),
      })),
      'sep',
      ...nsSection,
    ];
  }

  if (row.type === 'board') {
    return [
      { label: '在仓库页打开该看板', icon: 'repo', onClick: () => onNavigate?.('#/repos') },
      'sep',
      ...nsSection,
      {
        label: '删除看板（成员仓库回到未分组）', icon: 'trash', danger: true, onClick: async () => {
          const ok = await dialog({
            title: `删除看板「${row.name}」`,
            message: `它的 ${row.count} 个仓库会回到未分组（登记不动）。`,
            danger: true,
            okText: '删除',
          });
          if (!ok) return;
          try {
            await api(`/api/boards/${encodeURIComponent(String(row.id))}`, { method: 'DELETE', body: {} });
            if (onDataChanged) onDataChanged();
          } catch (err) {
            // catch 变量是 unknown：只取 message
            toast('删除失败: ' + (err as Error).message);
          }
        },
      },
    ];
  }

  return []; // #190 全局任务池已删除
}

/** addMenuItems 的入参：三个入口都交给调用方弹自己的表单（#193 对齐 repos 页）。 */
export interface AddMenuArgs {
  /** 登记仓库：打开 repos 页同款的添加仓库表单弹窗（path 探测 / key 归一 / 名称描述） */
  onAddRepo?: () => void;
  /** 新建看板：打开带「名称 + 初始描述」的表单弹窗 */
  onNewBoard?: () => void;
  /** #167：新建侧栏分区（namespace） */
  onNewNs?: () => void;
}

/** 搜索框右侧「＋」的菜单项（#193：不再用单输入对话框——登记仓库少 key 必挂） */
export function addMenuItems({ onAddRepo, onNewBoard, onNewNs }: AddMenuArgs): PopMenuItem[] {
  return [
    { label: '登记仓库…', icon: 'folder', onClick: () => onAddRepo?.() },
    { label: '新建看板（项目组）…', icon: 'plus', onClick: () => onNewBoard?.() },
    'sep',
    { label: '新建分区（namespace）…', icon: 'flow', onClick: () => onNewNs?.() },
  ];
}
