// 侧边栏的菜单装配：行菜单（⋯ / 右键）+「＋」菜单 + 设置气泡。
//
// 只回答「菜单里有什么」——怎么弹、怎么关、键盘怎么走，在 overlay.jsx 的 PopMenu；
// 菜单项点了之后改什么，由调用方传进来的回调决定。
//
// **菜单操作的是真实数据**：看板归属走 board assign（仓库页的那套看板），
// 「＋」菜单是登记仓库 / 新建看板——不再有「本地分组」这种只活在浏览器里的东西。
import { api } from '../../api/client.js';

/** 仓库行 / 看板行 / 全局池行的菜单项 */
export function rowMenuItems({ row, prefs, patchPrefs, onNavigate, boards, onDataChanged }) {
  if (row.type === 'repo') {
    const boardList = boards || [];
    // 归属看板上带 key（看板的成员按 key 存）
    const inBoard = (b) => (row.boards || []).some((x) => x.key === b.key || x.id === b.id);
    const assign = async (b, remove) => {
      try {
        await api('/api/boards/assign', {
          method: 'POST',
          body: remove
            ? { key: row.key, board: b.key || b.id, remove: true }
            : { key: row.key, board: b.key || b.id },
        });
        onDataChanged && onDataChanged();
      } catch (err) {
        alert('归属变更失败: ' + err.message);
      }
    };
    return [
      { label: '打开详情', icon: 'folder', onClick: () => row.topicKey && onNavigate('#/dir/' + encodeURIComponent(row.topicKey)) },
      { label: '置顶', icon: 'pin', onClick: () => patchPrefs({ order: [row.key, ...(prefs.order || []).filter((k) => k !== row.key)] }) },
      'sep',
      ...boardList.map((b) => ({
        label: (inBoard(b) ? '✓ ' : '') + (inBoard(b) ? '移出「' : '归入「') + b.name + '」',
        icon: 'folder',
        onClick: () => assign(b, inBoard(b)),
      })),
      'sep',
      { label: '从侧边栏隐藏（不删登记）', icon: 'x', onClick: () => patchPrefs((p) => ({ hidden: [...(p.hidden || []), row.key] })) },
    ];
  }

  if (row.type === 'board') {
    return [
      { label: row.open ? '折叠看板' : '展开看板', icon: 'chevron', onClick: () => patchPrefs((p) => ({ groupOpen: { ...(p.groupOpen || {}), [row.id]: !row.open } })) },
      { label: '在仓库页打开该看板', icon: 'repo', onClick: () => onNavigate('#/repos') },
      'sep',
      {
        label: '删除看板（成员仓库回到未分组）', icon: 'trash', danger: true, onClick: async () => {
          if (!confirm(`删除看板「${row.name}」？它的 ${row.count} 个仓库会回到未分组（登记不动）。`)) return;
          try {
            await api(`/api/boards/${encodeURIComponent(row.id)}`, { method: 'DELETE', body: {} });
            onDataChanged && onDataChanged();
          } catch (err) {
            alert('删除失败: ' + err.message);
          }
        },
      },
    ];
  }

  return [{ label: '打开全局任务池', icon: 'globe', onClick: () => onNavigate('#/global') }];
}

/** 搜索框右侧「＋」的菜单项 */
export function addMenuItems({ dialog, toast, onDataChanged }) {
  return [
    {
      label: '登记仓库…', icon: 'folder', onClick: async () => {
        const path = await dialog({
          title: '登记仓库',
          input: true,
          placeholder: '仓库绝对路径，如 D:/a_js/js_proj/nx-kv',
        });
        if (!path) return;
        try {
          await api('/api/repos', { method: 'POST', body: { path: path.trim() } });
          toast('已登记仓库 ' + path.trim());
          onDataChanged && onDataChanged();
        } catch (err) { toast('登记失败: ' + err.message); }
      },
    },
    {
      label: '新建看板（项目组）…', icon: 'plus', onClick: async () => {
        const name = await dialog({ title: '新建看板', input: true, placeholder: '看板名，如 前端 / nx 家族' });
        if (!name) return;
        try {
          await api('/api/boards', { method: 'POST', body: { name: name.trim() } });
          toast('已新建看板 ' + name.trim());
          onDataChanged && onDataChanged();
        } catch (err) { toast('新建失败: ' + err.message); }
      },
    },
  ];
}

/** 齿轮按钮（设置气泡）的菜单项 */
export function cfgMenuItems({ prefs, patchPrefs, onNavigate }) {
  return [
    { label: (prefs.defaultFolded ? '✓ ' : '') + '侧边栏默认收起', icon: 'flow', onClick: () => patchPrefs((p) => ({ defaultFolded: !p.defaultFolded })) },
    { label: (prefs.defaultGroupFolded ? '✓ ' : '') + '看板默认收起', icon: 'folder', onClick: () => patchPrefs((p) => ({ defaultGroupFolded: !p.defaultGroupFolded })) },
    'sep',
    ...(prefs.hidden || []).length
      ? [{ label: `恢复 ${prefs.hidden.length} 个隐藏仓库`, icon: 'refresh', onClick: () => patchPrefs({ hidden: [] }) }]
      : [],
    { label: '登录 / 设置…', icon: 'gear', onClick: () => onNavigate('#/auth') },
  ].filter(Boolean);
}
