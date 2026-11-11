// 侧边栏的菜单装配：行菜单（⋯ / 右键）+「＋」菜单。
// （设置已从气泡菜单搬进**浮动设置面板** modules/settings/panel.jsx）
//
// 只回答「菜单里有什么」——怎么弹、怎么关、键盘怎么走，在 components/popup 的 PopMenu；
// 菜单项点了之后改什么，由调用方传进来的回调决定。
//
// **菜单操作的是真实数据**：看板归属走 board assign（仓库页的那套看板），
// 「＋」菜单是登记仓库 / 新建看板——不再有「本地分组」这种只活在浏览器里的东西。
import { api } from '../../api/client.js';
import type { BoardRow, Prefs } from '../../types.js';
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
}

/** 仓库行 / 看板行 / 全局池行的菜单项 */
export function rowMenuItems({ row, prefs, patchPrefs, onNavigate, boards, onDataChanged, refreshLocal, toast, dialog }: RowMenuArgs): PopMenuItem[] {
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
      { label: '从侧边栏隐藏（不删登记）', icon: 'x', onClick: () => patchPrefs?.((p) => ({ hidden: [...(p.hidden || []), row.key] })) },
    ];
  }

  if (row.type === 'board') {
    return [
      { label: '在仓库页打开该看板', icon: 'repo', onClick: () => onNavigate?.('#/repos') },
      'sep',
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

  return [{ label: '打开全局任务池', icon: 'globe', onClick: () => onNavigate?.('#/global') }];
}

/** addMenuItems 的入参。 */
export interface AddMenuArgs {
  dialog: DialogFn;
  toast: (msg: string) => void;
  onDataChanged?: () => void;
}

/** 搜索框右侧「＋」的菜单项 */
export function addMenuItems({ dialog, toast, onDataChanged }: AddMenuArgs): PopMenuItem[] {
  return [
    {
      label: '登记仓库…', icon: 'folder', onClick: async () => {
        // dialog 的单输入分支回 string（见 useDialog.collect）
        const path = await dialog({
          title: '登记仓库',
          input: true,
          placeholder: '仓库绝对路径，如 D:/a_js/js_proj/nx-kv',
        }) as string | null;
        if (!path) return;
        try {
          await api('/api/repos', { method: 'POST', body: { path: path.trim() } });
          toast('已登记仓库 ' + path.trim());
          if (onDataChanged) onDataChanged();
        } catch (err) {
          // catch 变量是 unknown：只取 message
          toast('登记失败: ' + (err as Error).message);
        }
      },
    },
    {
      label: '新建看板（项目组）…', icon: 'plus', onClick: async () => {
        // 同上：单输入回 string
        const name = await dialog({ title: '新建看板', input: true, placeholder: '看板名，如 前端 / nx 家族' }) as string | null;
        if (!name) return;
        try {
          await api('/api/boards', { method: 'POST', body: { name: name.trim() } });
          toast('已新建看板 ' + name.trim());
          if (onDataChanged) onDataChanged();
        } catch (err) {
          // catch 变量是 unknown：只取 message
          toast('新建失败: ' + (err as Error).message);
        }
      },
    },
  ];
}
