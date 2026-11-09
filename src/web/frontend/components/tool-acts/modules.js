// group / dir / task / doc 工具区模块表（#139/#143，参考 nx-ft toolbar-modules）。
// 判定只此一处：栏渲染与编排面板共用，零 React 依赖。
//
// 规则：数组次序 = 工具栏渲染次序；visible=false → 收入「更多」；
// more 与主按钮 noHide；section='more' 默认进更多（visible 缺省 false）。

export const DIR_MODULES = [
  { id: 'new', label: '＋ 新建页', section: 'primary', noHide: true },
  { id: 'tpl', label: '模板', section: 'bar' },
  { id: 'import', label: '导入', section: 'bar' },
  { id: 'progress', label: '进程', section: 'bar' },
  { id: 'orch', label: '编排', section: 'bar' },
  { id: 'more', label: '更多', section: 'bar', noHide: true },
  { id: 'deleted', label: '已删除任务', section: 'more' },
  { id: 'refs', label: '查看列表', section: 'more' },
];

export const GROUP_MODULES = [
  { id: 'new', label: '＋ 新增任务', section: 'primary', noHide: true },
  { id: 'progress', label: '进程', section: 'bar' },
  { id: 'addMember', label: '添加成员', section: 'bar' },
  { id: 'orch', label: '编排', section: 'bar' },
  { id: 'more', label: '更多', section: 'bar', noHide: true },
  { id: 'refs', label: '查看列表', section: 'more' },
];

// MD 任务编辑器工具区（#143）：默认头栏只留 新任务 / 提交 / 更多；
// 次级动作默认进更多，可编排提到工具栏。menuGroup 仅影响更多菜单分层。
export const TASK_MODULES = [
  { id: 'new', label: '新任务', section: 'primary', noHide: true },
  { id: 'submit', label: '提交', section: 'primary', noHide: true },
  { id: 'more', label: '更多', section: 'bar', noHide: true },
  { id: 'mode', label: '源码模式', section: 'more', menuGroup: 'edit' },
  { id: 'img', label: '插入图片', section: 'more', menuGroup: 'edit' },
  { id: 'att', label: '添加附件', section: 'more', menuGroup: 'edit' },
  { id: 'import', label: '导入', section: 'more', menuGroup: 'edit' },
  { id: 'draft', label: '存草稿', section: 'more', menuGroup: 'edit' },
  { id: 'chain', label: '任务链', section: 'more', menuGroup: 'task' },
  { id: 'clone', label: '克隆任务', section: 'more', menuGroup: 'task' },
  { id: 'fork', label: 'Fork 任务', section: 'more', menuGroup: 'task' },
  { id: 'complete', label: '标为完成', section: 'more', menuGroup: 'task' },
  { id: 'cancel-task', label: '取消任务', section: 'more', menuGroup: 'task', danger: true },
  { id: 'mark', label: '评论', section: 'more', menuGroup: 'task' },
  { id: 'delete', label: '删除', section: 'more', menuGroup: 'task', danger: true },
  { id: 'preview', label: '预览提示词', section: 'more', menuGroup: 'view' },
  { id: 'overview', label: '总览', section: 'more', menuGroup: 'view' },
  { id: 'prog', label: '进程', section: 'more', menuGroup: 'view' },
  { id: 'source', label: '原文', section: 'more', menuGroup: 'view' },
  { id: 'shortcuts', label: '快捷键', section: 'more', menuGroup: 'view' },
];

// MD 文档编辑器（#143）：默认「保存 · 更多」（与 task 主按钮在左、更多靠右同构）；
// 次级动作可编排上栏。
export const DOC_MODULES = [
  { id: 'save', label: '保存', section: 'primary', noHide: true },
  { id: 'more', label: '更多', section: 'bar', noHide: true },
  { id: 'mode', label: '源码模式', section: 'more', menuGroup: 'edit' },
  { id: 'rename', label: '重命名', section: 'more', menuGroup: 'doc' },
  { id: 'delete', label: '删除', section: 'more', menuGroup: 'doc', danger: true },
  { id: 'list', label: '文字列表', section: 'more', menuGroup: 'view' },
];

// 仓库管理页头部（#145/#147）：默认只留「登记仓库 · 更多」（与 task/doc 同构——
// 次级动作默认收进更多，可在编排里拖上工具栏/调顺序）。
export const REPOS_MODULES = [
  { id: 'add', label: '登记仓库', section: 'primary', noHide: true },
  { id: 'more', label: '更多', section: 'bar', noHide: true },
  { id: 'boards', label: '分组管理', section: 'more', menuGroup: 'manage' },
  { id: 'refs', label: '参考仓库管理', section: 'more', menuGroup: 'manage' },
  { id: 'transfer', label: '导入导出', section: 'more', menuGroup: 'manage' },
];

// 仓库表**行内**动作（#148）：默认布局与旧版一致（编辑/打开/删除上栏 + 更多收纳
// 持续 get / 对齐 remote），五个动作全部可编排（kind=repos-row）。
export const REPOS_ROW_MODULES = [
  { id: 'edit', label: '编辑', section: 'bar' },
  { id: 'open', label: '打开', section: 'bar' },
  { id: 'del', label: '删除', section: 'bar', danger: true },
  { id: 'more', label: '更多', section: 'bar', noHide: true },
  { id: 'getloop', label: '持续 get…', section: 'more', menuGroup: 'repo' },
  { id: 'remote', label: '对齐 remote', section: 'more', menuGroup: 'repo' },
];

const META = {
  dir: Object.fromEntries(DIR_MODULES.map((m) => [m.id, m])),
  group: Object.fromEntries(GROUP_MODULES.map((m) => [m.id, m])),
  task: Object.fromEntries(TASK_MODULES.map((m) => [m.id, m])),
  doc: Object.fromEntries(DOC_MODULES.map((m) => [m.id, m])),
  repos: Object.fromEntries(REPOS_MODULES.map((m) => [m.id, m])),
  'repos-row': Object.fromEntries(REPOS_ROW_MODULES.map((m) => [m.id, m])),
};

export function modulesOf(kind) {
  if (kind === 'group') return GROUP_MODULES;
  if (kind === 'task') return TASK_MODULES;
  if (kind === 'doc') return DOC_MODULES;
  if (kind === 'repos') return REPOS_MODULES;
  if (kind === 'repos-row') return REPOS_ROW_MODULES;
  return DIR_MODULES;
}

export function metaOf(kind, id) {
  return (META[kind] && META[kind][id]) || {};
}

/** 默认落在「更多」：section 以 more 开头，或显式 defaultInMore */
export function defaultInMore(kind, id) {
  const m = metaOf(kind, id);
  return String(m.section || '').startsWith('more') || !!m.defaultInMore;
}

/** 是否出现在工具栏上 */
export function onBarOf(kind, item) {
  const m = metaOf(kind, item.id);
  if (m.noHide) return true;
  if (item.visible !== undefined) return item.visible !== false;
  return !defaultInMore(kind, item.id);
}

/** 是否出现在「更多」菜单（工具栏已显示的不重复；noHide 项不进菜单） */
export function inMoreOf(kind, item) {
  if (item.id === 'more') return false;
  if (metaOf(kind, item.id).noHide) return false;
  return !onBarOf(kind, item);
}

export function normalizeLayout(kind, list) {
  const mods = modulesOf(kind);
  const known = new Set(mods.map((m) => m.id));
  const seen = new Set();
  const out = [];
  for (const x of list || []) {
    if (!x || !x.id || !known.has(x.id) || seen.has(x.id)) continue;
    seen.add(x.id);
    const m = metaOf(kind, x.id);
    out.push(m.noHide ? { ...x, visible: true } : x);
  }
  for (const m of mods) {
    if (seen.has(m.id)) continue;
    out.push({
      id: m.id,
      visible: m.noHide ? true : !defaultInMore(kind, m.id),
    });
  }
  // more 尽量靠后（主按钮等可在其前）
  const moreIdx = out.findIndex((x) => x.id === 'more');
  if (moreIdx >= 0 && moreIdx < out.length - 1) {
    const [more] = out.splice(moreIdx, 1);
    // 插到最后一个 bar 项之后、more-only 之前
    let insertAt = out.length;
    for (let i = 0; i < out.length; i++) {
      if (defaultInMore(kind, out[i].id) && !onBarOf(kind, out[i])) {
        insertAt = i;
        break;
      }
    }
    out.splice(insertAt, 0, more);
  }
  return out;
}

export function defaultLayout(kind) {
  return normalizeLayout(
    kind,
    modulesOf(kind).map((m) => ({
      id: m.id,
      visible: m.noHide ? true : !defaultInMore(kind, m.id),
    }))
  );
}

export function moveItem(layout, id, dir) {
  const i = layout.findIndex((x) => x.id === id);
  if (i < 0) return layout;
  const j = dir < 0 ? i - 1 : i + 1;
  if (j < 0 || j >= layout.length) return layout;
  const next = layout.slice();
  const tmp = next[i];
  next[i] = next[j];
  next[j] = tmp;
  return next;
}

export function setVisible(layout, id, visible, kind) {
  if (metaOf(kind, id).noHide) return layout;
  return layout.map((x) => (x.id === id ? { ...x, visible: !!visible } : x));
}
