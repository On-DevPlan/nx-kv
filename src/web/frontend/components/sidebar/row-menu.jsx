// 侧边栏的菜单装配：行菜单（⋯ / 右键）+「＋」菜单 + 设置气泡。
//
// 只回答「菜单里有什么」——怎么弹、怎么关、键盘怎么走，在 overlay.jsx 的 PopMenu；
// 菜单项点了之后改什么，由调用方传进来的回调决定。
//
// **两件不同的事，不能混在一个动作里**：
//   · 「归入项目组 X」= 数据（store 里看板的成员表，POST /api/boards/assign，会导出、会跨机）
//   · 「放进收纳组 X」= 显示（prefs.groups，浏览器本地，只影响我怎么看）
// 菜单里分别占一段，用分隔线隔开，措辞也不一样——用户点的时候就知道改的是哪一个。
import { api } from '../../api/client.js';
import { addGroup, moveToGroup, groupOf } from '../../prefs.js';

const itemIdOfRow = (row) => (row.type === 'board' ? 'board:' + row.id : 'repo:' + (row.key || row.id));

/** 行菜单：资产（项目 / 项目组）与收纳盒各一套 */
export function rowMenuItems({ row, prefs, patchPrefs, onNavigate, boards, onDataChanged, dialog }) {
  const groups = prefs.groups || [];
  const myId = itemIdOfRow(row);
  const inGroup = groupOf(groups, myId);

  // 收纳盒那一段（资产共用）：放进某个盒子 / 取出 / 新建盒子
  const boxItems = (row.type === 'repo' || row.type === 'board') ? [
    'sep',
    ...groups.map((g) => ({
      label: (inGroup === g.id ? '✓ ' : '') + `放进收纳组「${g.name}」`,
      icon: 'archive',
      onClick: () => patchPrefs((p) => ({ groups: moveToGroup(p.groups || [], myId, g.id) })),
    })),
    ...(inGroup ? [{
      label: '从收纳组取出（回到顶层）',
      icon: 'x',
      onClick: () => patchPrefs((p) => ({ groups: moveToGroup(p.groups || [], myId, '') })),
    }] : []),
    {
      label: '新建收纳组并放进去…',
      icon: 'plus',
      onClick: async () => {
        const name = await dialog({ title: '新建收纳组', input: true, placeholder: '盒子名，如 前端 / 参考' });
        if (!name) return;
        patchPrefs((p) => {
          const { groups: next, id } = addGroup(p.groups || [], name.trim());
          return { groups: moveToGroup(next, myId, id) };
        });
      },
    },
  ] : [];

  if (row.type === 'repo') {
    const boardList = boards || [];
    // 归属项目组上带 key（成员按 key 存）
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
      { label: '置顶', icon: 'pin', onClick: () => patchPrefs({ order: [rKeyId(row), ...(prefs.order || []).filter((k) => k !== rKeyId(row))] }) },
      'sep',
      // —— 数据：项目组成员表 ——
      ...boardList.map((b) => ({
        label: (inBoard(b) ? '✓ ' : '') + (inBoard(b) ? '移出项目组「' : '归入项目组「') + b.name + '」',
        icon: 'repo',
        onClick: () => assign(b, inBoard(b)),
      })),
      ...boxItems,
      'sep',
      { label: '从侧边栏隐藏（不删登记）', icon: 'x', onClick: () => patchPrefs((p) => ({ hidden: [...(p.hidden || []), myId] })) },
    ];
  }

  if (row.type === 'board') {
    return [
      { label: '在仓库页打开（筛选到这一组）', icon: 'repo', onClick: () => onNavigate('#/repos?board=' + encodeURIComponent(row.id)) },
      {
        label: '重命名…', icon: 'edit', onClick: async () => {
          const name = await dialog({ title: '重命名项目组', input: true, placeholder: row.name, value: row.name });
          if (!name || name.trim() === row.name) return;
          try {
            await api(`/api/boards/${encodeURIComponent(row.id)}`, { method: 'PATCH', body: { name: name.trim() } });
            onDataChanged && onDataChanged();
          } catch (err) { alert('重命名失败: ' + err.message); }
        },
      },
      ...boxItems,
      'sep',
      {
        label: '删除项目组（成员仓库回到清单）', icon: 'trash', danger: true, onClick: async () => {
          if (!confirm(`删除项目组「${row.name}」？它的 ${row.count} 个仓库仍留在仓库清单里，只是少了一份归属。`)) return;
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

  if (row.type === 'group') {
    return [
      {
        label: row.open ? '收起收纳组' : '展开收纳组', icon: 'chevron',
        onClick: () => patchPrefs((p) => ({ groupOpen: { ...(p.groupOpen || {}), [row.id]: !row.open } })),
      },
      {
        label: '重命名…', icon: 'edit', onClick: async () => {
          const name = await dialog({ title: '重命名收纳组', input: true, placeholder: row.name, value: row.name });
          if (!name || !name.trim()) return;
          patchPrefs((p) => ({ groups: (p.groups || []).map((g) => (g.id === row.id ? { ...g, name: name.trim() } : g)) }));
        },
      },
      {
        label: '新建收纳组…', icon: 'plus', onClick: async () => {
          const name = await dialog({ title: '新建收纳组', input: true, placeholder: '盒子名，如 前端 / 参考' });
          if (!name) return;
          patchPrefs((p) => ({ groups: addGroup(p.groups || [], name.trim()).groups }));
        },
      },
      'sep',
      {
        // 只拆格子：里面的项目/项目组回到顶层平铺，一个都不少（它们不是盒子的数据）
        label: `解散收纳组（${row.count} 个条目回到顶层）`, icon: 'trash', danger: true, onClick: () => {
          if (!confirm(`解散收纳组「${row.name}」？里面的 ${row.count} 个条目会回到顶层，项目与项目组本身不受影响。`)) return;
          patchPrefs((p) => ({ groups: (p.groups || []).filter((g) => g.id !== row.id) }));
        },
      },
    ];
  }

  return [{ label: '打开全局任务池', icon: 'globe', onClick: () => onNavigate('#/global') }];
}

// order 里资产用 itemId（'repo:<key>' / 'board:<id>'），与 model.js 同一套标识
function rKeyId(row) {
  return row.type === 'board' ? 'board:' + row.id : 'repo:' + (row.key || row.id);
}

/** 搜索框右侧「＋」的菜单项：登记项目 / 新建项目组 / 新建收纳组 */
export function addMenuItems({ dialog, toast, patchPrefs, onDataChanged }) {
  return [
    {
      label: '登记项目（仓库）…', icon: 'folder', onClick: async () => {
        const path = await dialog({
          title: '登记项目',
          input: true,
          placeholder: '仓库绝对路径，如 D:/a_js/js_proj/nx-kv',
        });
        if (!path) return;
        try {
          await api('/api/repos', { method: 'POST', body: { path: path.trim() } });
          toast('已登记项目 ' + path.trim());
          onDataChanged && onDataChanged();
        } catch (err) { toast('登记失败: ' + err.message); }
      },
    },
    {
      label: '新建项目组…', icon: 'repo', onClick: async () => {
        const name = await dialog({ title: '新建项目组', input: true, placeholder: '组名，如 前端 / nx 家族' });
        if (!name) return;
        try {
          await api('/api/boards', { method: 'POST', body: { name: name.trim() } });
          toast('已新建项目组 ' + name.trim());
          onDataChanged && onDataChanged();
        } catch (err) { toast('新建失败: ' + err.message); }
      },
    },
    'sep',
    {
      // 收纳组只活在 prefs 里，不用发请求
      label: '新建收纳组（显示用）…', icon: 'archive', onClick: async () => {
        const name = await dialog({ title: '新建收纳组', input: true, placeholder: '盒子名，如 前端 / 参考' });
        if (!name) return;
        patchPrefs((p) => ({ groups: addGroup(p.groups || [], name.trim()).groups }));
        toast('已新建收纳组 ' + name.trim());
      },
    },
  ];
}

/** 齿轮按钮（设置气泡）的菜单项 */
export function cfgMenuItems({ prefs, patchPrefs, onNavigate }) {
  return [
    { label: (prefs.defaultFolded ? '✓ ' : '') + '侧边栏默认收起', icon: 'flow', onClick: () => patchPrefs((p) => ({ defaultFolded: !p.defaultFolded })) },
    { label: (prefs.defaultGroupFolded ? '✓ ' : '') + '收纳组默认收起', icon: 'archive', onClick: () => patchPrefs((p) => ({ defaultGroupFolded: !p.defaultGroupFolded })) },
    'sep',
    ...(prefs.hidden || []).length
      ? [{ label: `恢复 ${prefs.hidden.length} 个隐藏条目`, icon: 'refresh', onClick: () => patchPrefs({ hidden: [] }) }]
      : [],
    ...(prefs.groups || []).length
      ? [{ label: `解散全部 ${prefs.groups.length} 个收纳组`, icon: 'trash', danger: true, onClick: () => patchPrefs({ groups: [], groupOpen: {} }) }]
      : [],
    'sep',
    // 登录已合并进云端页（独立 #/auth 已下线，见 origin/main 的 cloud 改造）
    { label: '云端 / 登录…', icon: 'gear', onClick: () => onNavigate('#/cloud') },
  ].filter(Boolean);
}
