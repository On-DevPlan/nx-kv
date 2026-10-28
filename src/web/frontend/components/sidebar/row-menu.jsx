// 侧边栏的菜单装配：行菜单（⋯ / 右键）+「＋」菜单 + 设置气泡。
//
// 只回答「菜单里有什么」——怎么弹、怎么关、键盘怎么走，在 overlay.jsx 的 PopMenu；
// 菜单项点了之后改什么，由调用方传进来的回调决定。
//
// 从 index.jsx 拆出来是为了守住行数闸门：菜单装配是纯数据（不碰 JSX 渲染），
// 留在渲染文件里只会把 index.jsx 撑大。
import { api } from '../../api/client.js';

/** 目录行 / 分组行 / 全局池行的菜单项 */
export function rowMenuItems({ row, prefs, patchPrefs, onNavigate, dialog, newGroup }) {
  const groups = prefs.groups || [];

  if (row.type === 'dir') {
    const inGroup = (prefs.dirGroups || {})[row.key] || '';
    return [
      { label: '打开详情', icon: 'folder', onClick: () => onNavigate('#/dir/' + encodeURIComponent(row.key)) },
      { label: '置顶', icon: 'pin', onClick: () => patchPrefs({ order: [row.key, ...(prefs.order || []).filter((k) => k !== row.key)] }) },
      'sep',
      ...groups.map((g) => ({
        label: (inGroup === g.id ? '✓ ' : '') + '移到分组「' + g.name + '」',
        icon: 'folder',
        onClick: () => patchPrefs((p) => ({ dirGroups: { ...(p.dirGroups || {}), [row.key]: g.id } })),
      })),
      inGroup
        ? { label: '移出分组', icon: 'flow', onClick: () => patchPrefs((p) => { const dg = { ...(p.dirGroups || {}) }; delete dg[row.key]; return { dirGroups: dg }; }) }
        : { label: '新建分组并移入…', icon: 'plus', onClick: () => newGroup(row.key) },
      'sep',
      { label: '从侧边栏隐藏（不删数据）', icon: 'x', onClick: () => patchPrefs((p) => ({ hidden: [...(p.hidden || []), row.key] })) },
    ];
  }

  if (row.type === 'group') {
    return [
      { label: row.open ? '折叠分组' : '展开分组', icon: 'chevron', onClick: () => patchPrefs((p) => ({ groupOpen: { ...(p.groupOpen || {}), [row.id]: !row.open } })) },
      { label: '重命名分组…', icon: 'edit', onClick: async () => {
        const name = await dialog({ title: '重命名分组', input: true, value: row.name });
        if (name) patchPrefs((p) => ({ groups: p.groups.map((g) => (g.id === row.id ? { ...g, name } : g)) }));
      } },
      'sep',
      { label: '删除分组（成员回归未分组）', icon: 'trash', danger: true, onClick: () => patchPrefs((p) => ({ groups: p.groups.filter((g) => g.id !== row.id) })) },
    ];
  }

  return [{ label: '打开全局任务池', icon: 'globe', onClick: () => onNavigate('#/global') }];
}

/** 搜索框右侧「＋」的菜单项 */
export function addMenuItems({ dialog, toast, refreshLocal, newGroup }) {
  return [
    { label: '添加目录…', icon: 'folder', onClick: async () => {
        const cwd = await dialog({ title: '添加目录', input: true, placeholder: '工作目录绝对路径，如 D:/DevProjects/my/github/nx-kv' });
        if (!cwd) return;
        try {
          await api('/api/localtasks/topic', { method: 'POST', body: { cwd } });
          toast('已登记目录 ' + cwd);
          refreshLocal && refreshLocal();
        } catch (err) { toast('登记失败: ' + err.message); }
      } },
    { label: '新建分组…', icon: 'plus', onClick: () => newGroup() },
  ];
}

/** 齿轮按钮（设置气泡）的菜单项 */
export function cfgMenuItems({ prefs, patchPrefs, onNavigate }) {
  return [
    { label: (prefs.defaultFolded ? '✓ ' : '') + '侧边栏默认收起', icon: 'flow', onClick: () => patchPrefs((p) => ({ defaultFolded: !p.defaultFolded })) },
    { label: (prefs.defaultGroupFolded ? '✓ ' : '') + '分组默认收起', icon: 'folder', onClick: () => patchPrefs((p) => ({ defaultGroupFolded: !p.defaultGroupFolded })) },
    'sep',
    ...(prefs.hidden || []).length
      ? [{ label: `恢复 ${prefs.hidden.length} 个隐藏目录`, icon: 'refresh', onClick: () => patchPrefs({ hidden: [] }) }]
      : [],
    { label: '登录 / 设置…', icon: 'gear', onClick: () => onNavigate('#/auth') },
  ].filter(Boolean);
}
