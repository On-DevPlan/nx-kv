// group / dir / task / doc 工具区模块表（#139/#143，参考 nx-ft toolbar-modules）。
// 判定只此一处：栏渲染与编排面板共用，零 React 依赖。
//
// 规则：数组次序 = 工具栏渲染次序；visible=false → 收入「更多」；
// more 与主按钮 noHide；section='more' 默认进更多（visible 缺省 false）。

/** 工具区的种类（kind）。 */
export type ToolActsKind = 'dir' | 'group' | 'task' | 'doc' | 'repos' | 'repos-row';

/** 模块表的一项（静态声明）。 */
export interface ToolModule {
  id: string;
  label: string;
  /** 按钮/菜单项前的图标（资产名，见 svghub 目录）；空 = 纯文字 */
  icon?: string;
  section?: string;
  noHide?: boolean;
  menuGroup?: string;
  danger?: boolean;
  /** 锁末位（主按钮之类不可被挪到后面） */
  lockLast?: boolean;
  /** 显式默认进「更多」 */
  defaultInMore?: boolean;
}

/** 编排后的一项（存 localStorage 的布局条目）。 */
export interface LayoutItem {
  id: string;
  visible?: boolean;
}

export const DIR_MODULES: ToolModule[] = [
  { id: 'new', label: '新建页', icon: 'plus', section: 'primary', noHide: true },
  { id: 'import', label: '导入', icon: 'import', section: 'bar' },
  { id: 'progress', label: '进程', icon: 'progress', section: 'bar' },
  { id: 'orch', label: '编排', icon: 'flow', section: 'bar' },
  // #126：草稿开关作用于选中的任务（没选中时给提示），默认在工具栏可见
  { id: 'plan', label: '草稿态', icon: 'pin', section: 'bar' },
  { id: 'more', label: '更多', icon: 'dots', section: 'bar', noHide: true },
  { id: 'refs', label: '查看列表', icon: 'list', section: 'more' },
  // #165：持续 get（waitgoal）配置收进 topic 主页「更多」——按主题粒度控制，不再放仓库管理页
  { id: 'getloop', label: '持续 get', icon: 'refresh', section: 'more' },
];

export const GROUP_MODULES: ToolModule[] = [
  { id: 'new', label: '新增任务', icon: 'plus', section: 'primary', noHide: true },
  { id: 'progress', label: '进程', icon: 'progress', section: 'bar' },
  { id: 'addMember', label: '添加成员', icon: 'users', section: 'bar' },
  { id: 'orch', label: '编排', icon: 'flow', section: 'bar' },
  { id: 'more', label: '更多', icon: 'dots', section: 'bar', noHide: true },
  { id: 'refs', label: '查看列表', icon: 'list', section: 'more' },
];

// MD 任务编辑器工具区（#143）：默认头栏只留 新任务 / 提交 / 更多；
// 次级动作默认进更多，可编排提到工具栏。menuGroup 仅影响更多菜单分层。
export const TASK_MODULES: ToolModule[] = [
  { id: 'new', label: '新任务', icon: 'plus', section: 'primary', noHide: true },
  { id: 'submit', label: '提交', icon: 'send', section: 'primary', noHide: true },
  { id: 'more', label: '更多', icon: 'dots', section: 'bar', noHide: true },
  { id: 'mode', label: '源码模式', icon: 'code', section: 'more', menuGroup: 'edit' },
  { id: 'img', label: '插入图片', icon: 'img', section: 'more', menuGroup: 'edit' },
  { id: 'att', label: '添加附件', icon: 'clip', section: 'more', menuGroup: 'edit' },
  { id: 'import', label: '导入', icon: 'import', section: 'more', menuGroup: 'edit' },
  { id: 'draft', label: '存草稿', icon: 'save', section: 'more', menuGroup: 'edit' },
  { id: 'chain', label: '任务链', icon: 'chain', section: 'more', menuGroup: 'task' },
  { id: 'clone', label: '克隆任务', icon: 'copy', section: 'more', menuGroup: 'task' },
  { id: 'fork', label: 'Fork 任务', icon: 'fork', section: 'more', menuGroup: 'task' },
  // #131：plan 态开关放在任务页「更多」里（与「标为完成」同组）——
  // 用户在任务详情页就能把这条任务转成草稿态 / 转回待领取，不用回目录页。
  { id: 'plan', label: '转为草稿', icon: 'pin', section: 'more', menuGroup: 'task' },
  { id: 'complete', label: '标为完成', icon: 'check', section: 'more', menuGroup: 'task' },
  { id: 'cancel-task', label: '取消任务', icon: 'ban', section: 'more', menuGroup: 'task', danger: true },
  { id: 'mark', label: '评论', icon: 'comment', section: 'more', menuGroup: 'task' },
  { id: 'delete', label: '删除', icon: 'trash', section: 'more', menuGroup: 'task', danger: true },
  { id: 'preview', label: '预览提示词', icon: 'eye', section: 'more', menuGroup: 'view' },
  { id: 'overview', label: '总览', icon: 'overview', section: 'more', menuGroup: 'view' },
  { id: 'prog', label: '进程', icon: 'progress', section: 'more', menuGroup: 'view' },
  { id: 'source', label: '原文', icon: 'doc', section: 'more', menuGroup: 'view' },
  { id: 'shortcuts', label: '快捷键', icon: 'keyboard', section: 'more', menuGroup: 'view' },
];

// MD 文档编辑器（#143）：默认「保存 · 更多」（与 task 主按钮在左、更多靠右同构）；
// 次级动作可编排上栏。
export const DOC_MODULES: ToolModule[] = [
  { id: 'save', label: '保存', icon: 'save', section: 'primary', noHide: true },
  { id: 'more', label: '更多', icon: 'dots', section: 'bar', noHide: true },
  { id: 'mode', label: '源码模式', icon: 'code', section: 'more', menuGroup: 'edit' },
  { id: 'rename', label: '重命名', icon: 'rename', section: 'more', menuGroup: 'doc' },
  { id: 'delete', label: '删除', icon: 'trash', section: 'more', menuGroup: 'doc', danger: true },
  { id: 'list', label: '文字列表', icon: 'list', section: 'more', menuGroup: 'view' },
];

// 仓库管理页头部（#145/#147）：默认只留「登记仓库 · 更多」（与 task/doc 同构——
// 次级动作默认收进更多，可在编排里拖上工具栏/调顺序）。
export const REPOS_MODULES: ToolModule[] = [
  { id: 'add', label: '登记仓库', icon: 'plus', section: 'primary', noHide: true },
  { id: 'more', label: '更多', icon: 'dots', section: 'bar', noHide: true },
  { id: 'boards', label: '分组管理', icon: 'board', section: 'more', menuGroup: 'manage' },
  { id: 'refs', label: '参考仓库管理', icon: 'repo-ref', section: 'more', menuGroup: 'manage' },
  { id: 'transfer', label: '导入导出', icon: 'transfer', section: 'more', menuGroup: 'manage' },
];

// 仓库表**行内**动作（#148）：默认布局与旧版一致（编辑/打开/删除上栏 + 更多收纳
// 持续 get / 对齐 remote），五个动作全部可编排（kind=repos-row）。
export const REPOS_ROW_MODULES: ToolModule[] = [
  { id: 'edit', label: '编辑', icon: 'edit', section: 'bar' },
  { id: 'open', label: '打开', icon: 'open', section: 'bar' },
  { id: 'del', label: '删除', icon: 'trash', section: 'bar', danger: true },
  { id: 'more', label: '更多', icon: 'dots', section: 'bar', noHide: true },
  { id: 'getloop', label: '持续 get…', icon: 'refresh', section: 'more', menuGroup: 'repo' },
  { id: 'remote', label: '对齐 remote', icon: 'remote', section: 'more', menuGroup: 'repo' },
];

// kind → id → 模块（缺 key 的 id 查不到，调用方用 `|| {}` 兜）
const META: Record<string, Record<string, ToolModule>> = {
  dir: Object.fromEntries(DIR_MODULES.map((m) => [m.id, m])),
  group: Object.fromEntries(GROUP_MODULES.map((m) => [m.id, m])),
  task: Object.fromEntries(TASK_MODULES.map((m) => [m.id, m])),
  doc: Object.fromEntries(DOC_MODULES.map((m) => [m.id, m])),
  repos: Object.fromEntries(REPOS_MODULES.map((m) => [m.id, m])),
  'repos-row': Object.fromEntries(REPOS_ROW_MODULES.map((m) => [m.id, m])),
};

export function modulesOf(kind: string): ToolModule[] {
  if (kind === 'group') return GROUP_MODULES;
  if (kind === 'task') return TASK_MODULES;
  if (kind === 'doc') return DOC_MODULES;
  if (kind === 'repos') return REPOS_MODULES;
  if (kind === 'repos-row') return REPOS_ROW_MODULES;
  return DIR_MODULES;
}

export function metaOf(kind: string, id: string): Partial<ToolModule> {
  return (META[kind] && META[kind][id]) || {};
}

/** 默认落在「更多」：section 以 more 开头，或显式 defaultInMore */
export function defaultInMore(kind: string, id: string): boolean {
  const m = metaOf(kind, id);
  return String(m.section || '').startsWith('more') || !!m.defaultInMore;
}

/** 是否出现在工具栏上 */
export function onBarOf(kind: string, item: LayoutItem): boolean {
  const m = metaOf(kind, item.id);
  if (m.noHide) return true;
  if (item.visible !== undefined) return item.visible !== false;
  return !defaultInMore(kind, item.id);
}

/** 是否出现在「更多」菜单（工具栏已显示的不重复；noHide 项不进菜单） */
export function inMoreOf(kind: string, item: LayoutItem): boolean {
  if (item.id === 'more') return false;
  if (metaOf(kind, item.id).noHide) return false;
  return !onBarOf(kind, item);
}

export function normalizeLayout(kind: string, list: LayoutItem[] | null | undefined): LayoutItem[] {
  const mods = modulesOf(kind);
  const known = new Set(mods.map((m) => m.id));
  const seen = new Set<string>();
  const out: LayoutItem[] = [];
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
      const x = out[i];
      if (x && defaultInMore(kind, x.id) && !onBarOf(kind, x)) {
        insertAt = i;
        break;
      }
    }
    // moreIdx 已判 ≥0：splice 必取回一项（more 恒在列表里）
    if (more) out.splice(insertAt, 0, more);
  }
  return out;
}

export function defaultLayout(kind: string): LayoutItem[] {
  return normalizeLayout(
    kind,
    modulesOf(kind).map((m) => ({
      id: m.id,
      visible: m.noHide ? true : !defaultInMore(kind, m.id),
    }))
  );
}

export function moveItem(layout: LayoutItem[], id: string, dir: number): LayoutItem[] {
  const i = layout.findIndex((x) => x.id === id);
  if (i < 0) return layout;
  const j = dir < 0 ? i - 1 : i + 1;
  if (j < 0 || j >= layout.length) return layout;
  const next = layout.slice();
  // i / j 都已在界内：这里取到的两项必非空
  const tmp = next[i]!;
  next[i] = next[j]!;
  next[j] = tmp;
  return next;
}

export function setVisible(layout: LayoutItem[], id: string, visible: boolean, kind: string): LayoutItem[] {
  if (metaOf(kind, id).noHide) return layout;
  return layout.map((x) => (x.id === id ? { ...x, visible: !!visible } : x));
}
