// 工作区面板定位与清场：找面板、认区域 tabset、单面板位清场、tabset 属性读写。
//
// 区域定位统一命名（2026-11-04 #33）：sidebar / maincontent / rightSidebar / float，
// 面板 → 落点的策略表在 ./areas.js；这里只负责「在活模型里找到那个落点」。
import { Actions, DockLocation } from 'flexlayout-react';
import type { ITabSetAttributes, Model, Node, TabNode, TabSetNode } from 'flexlayout-react';
import type { PanelConfig, PanelSpec } from '../types.js';
import { sideStateAttrs } from '../components/sidebar/side-state.js';

/** flexlayout 0.11 的 .d.ts 没声明 DockLocation.getByName（运行时按名字取停靠位）。 */
const dockOf = (name: string): DockLocation =>
  (DockLocation as unknown as { getByName(n: string): DockLocation }).getByName(name);

/** flexlayout 的 tabset 未声明 getSelectedTab 时的兼容形态（currentMainPanel 用）。 */
type TabSetLike = TabSetNode & { getSelectedTab?(): TabNode | null };

/**
 * config 的**序无关**签名（#86 实测坑）：openPage 拼的 config 键序和
 * panelSpecOfRoute 生成的不一定一致（{task,groupId} vs {groupId,task}），
 * JSON.stringify 对键序敏感——同一页签被裂成两块（去重失效，双页签）。
 * 键排序后拼平；undefined 字段跳过（旧 JSON 行为里 undefined ≡ 缺省）。
 */
export function configSig(config?: PanelConfig | null): string {
  const c = config || {};
  return Object.keys(c)
    .filter((k) => c[k] !== undefined)
    .sort()
    .map((k) => `${k}=${String(c[k])}`)
    .join('|');
}

/** 找到已打开的同款面板（component + config 一致）——避免重复开同名面板 */
export function findOpenPanel(
  model: Model | null | undefined,
  component: string,
  config?: PanelConfig | null,
): TabNode | null {
  if (!model) return null;
  const want = configSig(config);
  let hit: TabNode | null = null;
  model.visitNodes((node) => {
    if (hit) return;
    if (node.getType() !== 'tab') return;
    const tab = node as TabNode;
    if (tab.getComponent() !== component) return;
    if (configSig(tab.getConfig() || {}) !== want) return;
    hit = tab;
  });
  return hit;
}

/** 全部 tabset（主布局里的；border 的不算——那是边界栏） */
export function allTabsets(model: Model): TabSetNode[] {
  const out: TabSetNode[] = [];
  model.visitNodes((node) => {
    if (node.getType() === 'tabset') out.push(node as TabSetNode);
  });
  return out;
}

/** 第一个 component 匹配的页签（**不限 config**）——单例面板只有一块。 */
export function findComponentPanel(model: Model | null | undefined, component: string): TabNode | null {
  if (!model) return null;
  let hit: TabNode | null = null;
  model.visitNodes((node) => {
    if (hit) return;
    if (node.getType() !== 'tab') return;
    const tab = node as TabNode;
    if (tab.getComponent() !== component) return;
    hit = tab;
  });
  return hit;
}

/**
 * 主内容区**当前**面板的规格（component / name / config）。
 *
 * 主区是单面板位（新的进来旧的出去，#33）——评论 / 反馈这类临时页会把当前
 * 面板顶掉；关掉临时页时用它把原面板**放回去**，否则主区空掉、只剩侧边栏
 * （#106 验收反馈）。
 */
export function currentMainPanel(model: Model | null | undefined): PanelSpec | null {
  if (!model) return null;
  const tsId = mainTabsetId(model);
  if (!tsId) return null;
  const ts = model.getNodeById(tsId) as TabSetLike | undefined;
  if (!ts) return null;
  const sel = typeof ts.getSelectedTab === 'function' ? ts.getSelectedTab() : null;
  const tabs = (ts.getTabNodes && ts.getTabNodes()) || [];
  const tab = sel || tabs[tabs.length - 1] || null;
  if (!tab) return null;
  // component 在库里可缺省；缺省时给空串（openPanel 见到空 component 会早退）
  return { component: tab.getComponent() || '', name: tab.getName(), config: tab.getConfig() || {} };
}

/** 这个 tabset 里有没有指定 component 的页签 */
function hasComponent(tabset: TabSetNode, components: string[]): boolean {
  if (!components || !components.length) return false;
  return (tabset.getTabNodes() || []).some((t) => components.includes(t.getComponent() || ''));
}

/**
 * 开面板的落点。
 *
 * **不能落进侧栏自己的 tabset**——侧栏是一个「面板」，它所在的面板组是给它用的；
 * 从侧栏开别的面板，页签应该进**工作区**，否则工作区会开在侧栏旁边，
 * 侧栏那一组还会越攒越多。
 */
export function activeTabsetId(model: Model, exclude: string[] = []): string | undefined {
  const ts = model.getActiveTabset() || model.getFirstTabSet();
  if (ts && !hasComponent(ts, exclude)) return ts.getId();
  const fallback = [...allTabsets(model)].reverse().find((s) => !hasComponent(s, exclude));
  return fallback ? fallback.getId() : (ts ? ts.getId() : undefined);
}

/** 主内容区的 tabset（主内容区**同时只显示一个面板**——没有页签） */
export function mainTabsetId(model: Model | null | undefined): string | null {
  if (!model) return null;
  let hit: string | null = null;
  model.visitNodes((node) => {
    if (hit) return;
    if (node.getType() !== 'tabset') return;
    const ts = node as TabSetNode;
    const id = ts.getId();
    if (id === 'ts_main') { hit = id; return; }
    // 老布局里主区的 id 可能不是 ts_main：取「不是侧栏、不是右侧栏」的那组
    if (id !== 'ts_sidebar' && id !== 'ts_right' && !hasComponent(ts, ['sidebar'])) hit = id;
  });
  return hit;
}

/** 右侧栏区域的组件（进程 / 文档列表——「右侧栏单面板位」的两个住户） */
export const RIGHT_AREA_COMPONENTS = ['progress', 'refs'];

/**
 * 主内容区的面板组件（#115）。用来把「混进主区的右栏面板」认出来：
 * 老布局里 refs 可能被存进 ts_main，那时它所在 tabset 同时含 dir/group 这类主区面板——
 * 这绝不该被当成右侧栏（否则 setRightSidebarVisible 会把主区压成 16% 宽）。
 */
export const MAIN_AREA_COMPONENTS = ['dir', 'page', 'group', 'repos', 'overview', 'doc', 'dag', 'compose', 'templates'];

/**
 * 右侧栏（并发进程面板）的 tabset。
 *
 * 不只认 id=ts_right：FlexLayout 的 fromJson 会丢**空 tabset**——全新会话
 * （localStorage 无存盘）走 initialLayoutJson() 直接 fromJson，ts_right 还没出生
 * 就没了（2026-11-07 探针实锤）。此时第一块右栏面板会 dock 出一个临时 tabset，
 * 这里按**内容**（装着 progress/refs）认回它，关闭/收起/清场才都有靶子。
 */
export function rightTabsetId(model: Model | null | undefined): string | null {
  if (!model) return null;
  let hit: string | null = null;
  model.visitNodes((node) => {
    if (hit) return;
    // #115：浮窗里的 tabset 也装着 refs/progress，但它不是「右侧栏」——
    // 把它当成 rightTabset 会让 openPanel 认为面板已经在右栏而什么都不做。
    if (String(node.getId()).startsWith('float')) return;
    if (node.getType() === 'tabset' && node.getId() === 'ts_right') {
      hit = node.getId();
      return;
    }
    if (node.getType() === 'tabset' && typeof (node as TabSetNode).getTabNodes === 'function') {
      const kids = (node as TabSetNode).getTabNodes() || [];
      const comps = kids.map((t) => t.getComponent() || '');
      // 含主区面板的 tabset 是主内容区，哪怕它里面混着一块 refs（#115 的老布局残留）
      if (comps.some((c) => MAIN_AREA_COMPONENTS.includes(c))) return;
      if (comps.some((c) => RIGHT_AREA_COMPONENTS.includes(c))) hit = node.getId();
    }
  });
  return hit;
}

const RIGHT_WEIGHT_OPEN = 16;
const RIGHT_WEIGHT_CLOSED = 0;

/** 展开 / 收起右侧栏（关掉进程面板后重量归零，再开进程时拉回来） */
export function setRightSidebarVisible(model: Model | null | undefined, visible: boolean): boolean {
  const id = rightTabsetId(model);
  if (!id) return false;
  return setTabsetAttrs(model, id, {
    weight: visible ? RIGHT_WEIGHT_OPEN : RIGHT_WEIGHT_CLOSED,
    enableTabStrip: false,
  });
}

/**
 * 关掉右侧栏里的进程面板（并收起右侧栏）。
 * 验收：右 sidebar 要能关——以前进程常驻、没有关闭入口。
 */
export function closeRightSidebar(model: Model | null | undefined) {
  if (!model) return;
  const victims: string[] = [];
  model.visitNodes((node) => {
    if (node.getType() !== 'tab') return;
    if ((node as TabNode).getComponent() === 'progress') victims.push(node.getId());
  });
  for (const id of victims) model.doAction(Actions.deleteTab(id));
  setRightSidebarVisible(model, false);
}

/**
 * 右侧栏是**单面板位**：ts_right 的 enableTabStrip 恒为 false——两块面板共存时
 * 没有页签条可切换，后开的那块会把先开的挡死（看得见却回不去）。
 * 开新右栏前把**别的**右栏面板清掉（keepComponent 保留自己）。
 * 与主区的单面板位（clearMainPanels）同一模型。
 */
export function clearRightPanels(model: Model | null | undefined, keepComponent?: string): number {
  if (!model) return 0;
  const rightTs = rightTabsetId(model);
  const victims: string[] = [];
  model.visitNodes((node) => {
    if (node.getType() !== 'tab') return;
    const tab = node as TabNode;
    if (keepComponent && tab.getComponent() === keepComponent) return;
    const parent = tab.getParent();
    if (!parent || parent.getId() !== rightTs) return;
    victims.push(tab.getId());
  });
  for (const id of victims) model.doAction(Actions.deleteTab(id));
  return victims.length;
}

/**
 * 关掉右侧栏里的某块面板（refs 等非进程面板用）：
 * 删掉该 component 的全部页签；右侧栏因此**空了**才收起——
 * 进程还开着时不连带收起（收起会把进程一起藏掉）。
 */
export function closeRightPanelOf(model: Model | null | undefined, component: string) {
  if (!model) return;
  const victims: string[] = [];
  model.visitNodes((node) => {
    if (node.getType() !== 'tab') return;
    if ((node as TabNode).getComponent() === component) victims.push(node.getId());
  });
  for (const id of victims) model.doAction(Actions.deleteTab(id));
  const rightTs = rightTabsetId(model);
  const ts = rightTs ? (model.getNodeById(rightTs) as TabSetNode | undefined) : null;
  const rest = ts ? (ts.getTabNodes() || []).length : 0;
  if (!rest) setRightSidebarVisible(model, false);
}

/**
 * 主内容区切到某目录/任务时，若右侧进程面板已开，同步它的 dirKey/task——
 * 否则会一直显示「上一个任务」所属目录的进程（#33 验收反馈）。
 * #86：主区切到**组锚定页**（config.groupId）时进程跟着切组模式
 * （config.groupKey）——「进程跟着主区走」对组任务同样成立；不传 groupId
 * 维持目录/全局模式。已关的进程面板不会因此被拉出来（无 tab 早退）。
 */
export function syncProgressPanel(
  model: Model | null | undefined,
  { dirKey, groupId, task }: { dirKey?: string; groupId?: string; task?: string | number } = {},
) {
  if (!model) return;
  const tab = findComponentPanel(model, 'progress');
  if (!tab) return;
  // 右侧栏单面板位：进程被同步（主区切了目录/任务）时，refs 这类别的右栏面板让位
  clearRightPanels(model, 'progress');
  const prev = tab.getConfig() || {};
  const next: PanelConfig = groupId ? { groupKey: groupId } : { dirKey: dirKey || '' };
  if (task != null && String(task) !== '') next.task = String(task);
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  model.doAction(Actions.updateNodeAttributes(tab.getId(), { config: next }));
  if (dirKey || groupId) setRightSidebarVisible(model, true);
}

/**
 * 清掉主内容区里的面板（含并排的「旁路原文」）。
 * 侧栏 / 右侧进程栏不动；浮窗也不动。
 * @param {string} [keepId] 保留这一块（openPanel 先落新页签再清旧内容时传它——
 *   先清后落会把唯一 tabset 清空，FlexLayout 自动删掉空 tabset，新页签没地方落）
 */
export function clearMainPanels(model: Model | null | undefined, keepId: string | null = null): number {
  if (!model) return 0;
  const rightTs = rightTabsetId(model);
  const victims: string[] = [];
  model.visitNodes((node) => {
    if (node.getType() !== 'tab') return;
    if (keepId && node.getId() === keepId) return;
    const tab = node as TabNode;
    const c = tab.getComponent();
    // 右栏组件（可能在 ts_right，也可能在临时 tabset——见 rightTabsetId 注）永不当主区内容清
    if (c === 'sidebar' || RIGHT_AREA_COMPONENTS.includes(c || '')) return;
    const parent = tab.getParent();
    if (!parent || parent.getType() !== 'tabset') return;
    const tsId = parent.getId();
    if (tsId === 'ts_sidebar' || (rightTs && tsId === rightTs)) return;
    // 浮窗在 subLayout 里，父 tabset 不在主布局——用窗口 id 判断。
    // ⚠️ 只认 'float'：新 flexlayout 里**主窗页签**的 getWindowId() 也返回真值
    // （主 layout 自己的 GUID）——旧写法 `if (node.getWindowId())` 把主区页签
    // 全判成浮窗，clearMainPanels 变空转，主区单面板位失效、页签越堆越多
    //（#86 探针实测：组页 ↔ 任务页来回点，隐藏页签成堆）。popoutTab 开的
    // 浮窗窗口 id 恒为 'float'（openFloatingPanel 传入）。
    if (typeof tab.getWindowId === 'function' && tab.getWindowId() === 'float') return;
    victims.push(tab.getId());
  });
  for (const id of victims) model.doAction(Actions.deleteTab(id));
  return victims.length;
}

/** 关掉主区里所有「旁路」面板（config.beside） */
export function closeBesidePanels(model: Model | null | undefined): number {
  if (!model) return 0;
  const victims: string[] = [];
  model.visitNodes((node) => {
    if (node.getType() !== 'tab') return;
    const cfg = (node as TabNode).getConfig() || {};
    if (cfg.beside) victims.push(node.getId());
  });
  for (const id of victims) model.doAction(Actions.deleteTab(id));
  return victims.length;
}

/** 把一个面板挪到指定停靠位（换布局用） */
export function dockPanel(model: Model | null | undefined, tabId: string, location: string): boolean {
  if (!model) return false;
  const target = activeTabsetId(model);
  if (!target) return false;
  model.doAction(Actions.moveNode(tabId, target, dockOf(location), -1, true));
  return true;
}

/**
 * 确保某块面板**停在右侧栏**（#115）。
 *
 * 为什么需要：面板位置是 localStorage 里记住的——老布局可能把文档列表（refs）存成
 * 主内容区的一块，于是「查看详情」只会 selectTab，它就继续占着正文区域（用户看到的
 * 「列表取代了 landing 页」）。这里做一次**自愈**：发现它不在右侧 tabset 就搬过去；
 * 右侧 tabset 还没有（老布局）就先 dock 到根行右缘，让 FlexLayout 现建一个。
 * @returns 是否真的搬了
 */
export function ensureInRightArea(model: Model | null | undefined, tabId: string | null | undefined): boolean {
  if (!model || !tabId) return false;
  const node = model.getNodeById(tabId) as TabNode | undefined;
  if (!node) return false;
  const right = rightTabsetId(model);
  const parentId = node.getParent && node.getParent() ? node.getParent()!.getId() : '';
  if (right && parentId === right) return false; // 已经在右栏，什么都不用做
  if (right) {
    model.doAction(Actions.moveNode(tabId, right, dockOf('center'), -1, true));
    return true;
  }
  const root = model.getRootRow ? model.getRootRow() : null;
  if (root) {
    model.doAction(Actions.moveNode(tabId, root.getId(), dockOf('right'), -1, true));
    return true;
  }
  return false;
}

/** 关闭某个面板 */
export function closePanel(model: Model | null | undefined, tabId: string | null | undefined): boolean {
  if (!model || !tabId) return false;
  model.doAction(Actions.deleteTab(tabId));
  return true;
}

// ─── 清空当前面板组 ─────────────────────────────────────────────
//
// 页签条右端的「清空」按钮：一次关掉**本组**的全部可关页签。
// 只作用于按钮所在的 tabset——别的组、浮窗、边界栏一概不碰；
// 目录这类钉死页签（enableClose:false）天然不在「可关」之列，侧栏组
// 因为没有可关页签，连按钮都不出现。

/** 本组里实际会关掉的页签数（按钮角标/确认框口径，与 clearTabset 一致） */
export function countClearable(model: Model | null | undefined, tabset: TabSetNode | null | undefined): number {
  if (!model || !tabset) return 0;
  return (tabset.getTabNodes() || []).filter((t) => t.isEnableClose()).length;
}

/** 节点是否在**主布局**里（浮窗/弹出窗是 subLayout，根不是主布局的根行） */
function inMainLayout(model: Model | null | undefined, node: Node): boolean {
  let p: Node | undefined = node;
  while (p && p.getParent()) p = p.getParent();
  const root = model && model.getRootRow && model.getRootRow();
  return !!p && p === root;
}

/**
 * 清空一个面板组：关掉该组里全部**可关**页签（钉死的目录页签不动）。
 *
 * 兜底「开始」页：如果清完**主布局里一个内容页签都不剩**（侧栏不算——
 * 不能让主区剩「侧栏 + 一片白」，后续开面板还会挤进侧栏组），就先在原组里
 * 放一块「开始」页再删，清完仍是一个可用落点。
 * 全部走 Actions（doAction）：可逐步撤销，清空后的空组由 change 监听里的
 * 剪枝自动收走（连最后一组都清掉时，兜底页让该组始终非空、不会被剪）。
 *
 * @returns {number} 关掉的页签数
 */
export function clearTabset(model: Model | null | undefined, tabset: TabSetNode | null | undefined): number {
  if (!model || !tabset) return 0;
  const deletable = (tabset.getTabNodes() || []).filter((t) => t.isEnableClose());
  if (!deletable.length) return 0;

  // 主布局清完还有没有别的**内容**页签（侧栏钉死页签不算数）
  const deletableIds = new Set(deletable.map((t) => t.getId()));
  let survivor = false;
  model.visitNodes((node) => {
    if (survivor || node.getType() !== 'tab') return;
    if (deletableIds.has(node.getId())) return;
    if ((node as TabNode).getComponent() === 'sidebar') return;
    if (inMainLayout(model, node)) survivor = true;
  });
  if (!survivor) {
    model.doAction(Actions.addTab(
      { type: 'tab', name: '开始', component: 'welcome' },
      tabset.getId(),
      dockOf('center'),
      -1,
      true
    ));
  }
  for (const t of deletable) model.doAction(Actions.deleteTab(t.getId()));
  return deletable.length;
}

/** 找到承载某个 component 页签的 tabset id（侧栏收起/展开要用它改 weight） */
export function tabsetOfComponent(model: Model | null | undefined, component: string): string | null {
  if (!model) return null;
  const hits: TabSetNode[] = [];
  model.visitNodes((node) => {
    if (hits.length) return;
    if (node.getType() !== 'tab') return;
    if ((node as TabNode).getComponent() !== component) return;
    // TabNode 没有 getTabset()：页签的父节点就是它所在的 tabset
    const parent = node.getParent();
    if (parent && parent.getType() === 'tabset') hits.push(parent as TabSetNode);
  });
  const hit = hits[0];
  return hit ? hit.getId() : null;
}

/** 读某个 tabset 的 weight（布局宽度 = weight 的比例分摊）；找不到返回 null */
export function tabsetWeight(model: Model | null | undefined, tabsetId: string | null | undefined): number | null {
  if (!model || !tabsetId) return null;
  let w: number | null = null;
  model.visitNodes((node) => {
    if (w !== null) return;
    if (node.getType() === 'tabset' && node.getId() === tabsetId) w = (node as TabSetNode).getWeight();
  });
  return w;
}

/** 改 tabset 属性（weight / enableTabStrip …）；目标不存在时安全 no-op */
export function setTabsetAttrs(
  model: Model | null | undefined,
  tabsetId: string | null | undefined,
  attrs: ITabSetAttributes,
): boolean {
  if (!model || !tabsetId) return false;
  let found = false;
  model.visitNodes((node) => {
    if (found) return;
    if (node.getType() === 'tabset' && node.getId() === tabsetId) found = true;
  });
  if (!found) return false;
  model.doAction(Actions.updateNodeAttributes(tabsetId, attrs));
  return true;
}

/**
 * 运行时补回被关掉的目录页签（停靠到主布局最左侧）。
 * 返回新 tabset id；已存在则直接返回现有 tabset id。
 */
export function restoreSidebarTab(model: Model | null | undefined): string | null {
  if (!model) return null;
  const existing = tabsetOfComponent(model, 'sidebar');
  if (existing) return existing;
  const first = model.getFirstTabSet && model.getFirstTabSet();
  const target = first ? first.getId() : null;
  if (!target) return null;
  model.doAction(Actions.addTab(
    { type: 'tab', id: 't_sidebar', name: '目录', component: 'sidebar', enableClose: false },
    target,
    dockOf('left'),
    -1,
    true
  ));
  const tsId = tabsetOfComponent(model, 'sidebar');
  if (tsId) setTabsetAttrs(model, tsId, sideStateAttrs('expanded'));
  return tsId;
}

/** 当前选中的 tab（深链同步用） */
export function activeTab(model: Model | null | undefined): TabNode | null {
  const ts = model && model.getActiveTabset();
  const tab = ts && ts.getSelectedNode();
  return tab || null;
}
