// 工作区布局模型：初始布局 JSON + 全局属性 + 读盘愈合 / 存盘剪枝。
//
// 这一层贴着 FlexLayout 的模型语义写，不自造：
//   · 模型 = JSON 树（row → tabset → tab），UI 是它的投影
//   · 存盘 = model.toJson()；恢复 = Model.fromJson()
//
// 布局存 localStorage（独立 key）：面板摆在哪跟数据无关，进 store.json 只会让 diff 变噪音。
// 与 prefs（展开态、隐藏、排序那类 UI 偏好）分开存 —— 两边生命周期不同：
// prefs 是「这个浏览器的口味」，布局是「这个工作区的骨架」。
import { Actions, Model } from 'flexlayout-react';
import type { IJsonModel } from 'flexlayout-react';
import { normalizeSidebarWeight, sideStateAttrs } from '../components/sidebar/side-state.js';

/**
 * 布局 JSON（FlexLayout 的外部边界形状）：row → tabset → tab 的树。
 *
 * 这里的字段按库的 toJson 形态声明，但不逐字段穷举——愈合/剪枝只按结构读写
 * 这几个键，其余（config、global 的细项）原样透传：所以入参是 `any`
 * （JSON.parse 的产物），本接口只用于**本文件内部**的树遍历。
 */
export interface LayoutJson {
  type?: string;
  id?: string;
  component?: string;
  name?: string;
  weight?: number;
  enableTabStrip?: boolean;
  enableClose?: boolean;
  selected?: number;
  children?: LayoutJson[];
  layout?: LayoutJson;
  borders?: LayoutJson[];
  subLayouts?: Record<string, LayoutJson>;
}

/** flexlayout 0.11 的 .d.ts 没声明 Model.updateAttrs（运行时存在，App 层同样打补丁）。 */
type ModelWithAttrs = Model & { updateAttrs(attrs: Record<string, unknown>): void };

/** 布局的落点。与 prefs 的 LS_KEY 分开存：布局大、单独读写不易互相踩。 */
export const WORKSPACE_KEY = 'nx-kv-ui.workspace';

/** 全局属性：属性继承的根（global.tabXxx ← 每个 tab 的默认值） */
const GLOBAL_ATTRS = {
  tabEnableClose: true,
  tabEnableDrag: true,
  tabEnableRename: false, // 页签只读：双击不出改名输入框
  // 「弹出 / 浮窗」**按钮**一律不要（2026-11-04 #33）：面板的落点由策略表决定，
  // 用户不需要在标题栏上挑「这块面板开成什么样」。能力留着——设置面板就是
  // float 面板（openFloatingPanel 走 popoutTab(id,'float')，门控是 tabEnableFloat，
  // 与这里的 popout 无关）。
  // tabEnablePopout=false（2026-11-07 #91）：浮窗头部的原生「弹出到浏览器窗口」按钮
  // 以 getRootRow().isAllowedInWindow()（读 enablePopout）为渲染条件，这里一关即消失。
  tabEnablePopout: false,
  tabEnablePopoutIcon: false,
  tabEnableFloat: true,
  tabEnableFloatIcon: false,
  tabEnablePin: false,
  tabSetEnableClose: false,
  tabSetEnableCloseButton: true,
  // 「最大化」全线下掉（2026-11-04 #39）：页签条右端的 Maximize/Restore 按钮、右键
  // 菜单的「最大化」、双击标题栏最大化，库都走 tabSetNode.canMaximize() 门控——
  // 这个全局属性一关全部消失，不需要逐处摘按钮。
  tabSetEnableMaximize: false,
  tabSetEnableDrag: true,
  tabSetEnableDrop: true,
  tabSetEnableTabGroups: false,
  tabSetAutoSelectTab: true,
  borderEnableClose: true,
  enableEdgeDock: true,
  enableEdgeDockIndicators: true,
  rootOrientationVertical: false,
};

/**
 * 初始布局：侧栏在左（一个 tabset，可拖宽/可拖走），工作区在右。
 * 「目录只从侧栏进」是**默认布局的约定**，不是硬编码的壳 ——
 * 侧栏面板本身只是一个 tab，可以拖去任何地方、拖出成浮窗。
 */
export function initialLayoutJson(): IJsonModel {
  return {
    global: { ...GLOBAL_ATTRS },
    borders: [],
    layout: {
      type: 'row',
      children: [
        {
          type: 'tabset',
          id: 'ts_sidebar',
          weight: 16,
          // 不出页签条（#33 无页签化）：侧栏自己的品牌行就是标题；
          // 页签条会压在工作区顶部的面包屑上，把路径挡住。
          enableTabStrip: false,
          // 目录页签不可关——关掉后 SidebarPanel 卸载，关闭态把手一起消失，界面卡死。
          children: [{ type: 'tab', id: 't_sidebar', name: '目录', component: 'sidebar', enableClose: false }],
        },
        {
          type: 'tabset',
          id: 'ts_main',
          weight: 68,
          // 没有页签条（2026-11-04 #33）：主内容区**同时只显示一个面板**，
          // 顶部用面包屑显示当前位置（见 components/layout/breadcrumb.jsx）。
          enableTabStrip: false,
          children: [{ type: 'tab', id: 't_welcome', name: '开始', component: 'welcome' }],
        },
        {
          type: 'tabset',
          id: 'ts_right',
          weight: 16,
          enableTabStrip: false,
          children: [],
        },
      ],
    },
  };
}

/**
 * 出厂全局属性**每次加载都补上**。
 *
 * 为什么不靠存盘里的 `global`：`toJson()` 只写**与默认值不同**的项，
 * 所以一份旧布局里可能压根没有 `global` 这一段（或缺某几项）——
 * 存盘里的属性是「用户改过的差量」，不是「完整配置」。
 * 不补 = 老布局加载后新开的入口又消失了（浮窗/弹出图标不出现）。
 */
export function applyGlobalAttrs(model: Model): Model {
  (model as ModelWithAttrs).updateAttrs({ ...GLOBAL_ATTRS });
  return model;
}

/**
 * 剪掉空 tabset（children 为空的面板组），以及修剪后变空的 row。
 *
 * **为什么要剪**：FlexLayout 的 toJson 会把空 tabset 原样写进布局——
 * 拖动/关闭面板的某些路径会留下空面板组，存盘后每次恢复都渲染成一块白板。
 * 恢复时剪 = 已经存坏的布局自动愈合；存盘前剪 = 不再产生新的。
 *
 * 纯函数：输入输出都是布局 JSON（不是 Model 实例），单测直接覆盖。
 * 返回 null 表示根被剪空（一个可用面板组都不剩），调用方决定回退到初始布局。
 */
export function pruneEmptyTabsets(json: LayoutJson | null): LayoutJson | null {
  if (!json || json.type !== 'row' || !Array.isArray(json.children)) return json;
  const walk = (node: LayoutJson): LayoutJson => {
    if (node.type !== 'row') return node;
    node.children = (node.children || [])
      .map((c) => (c.type === 'row' ? walk(c) : c))
      .filter((c) => {
        if (c.type === 'tabset') return (c.children || []).length > 0;
        if (c.type === 'row') return (c.children || []).length > 0;
        return true;
      });
    return node;
  };
  const layout = walk(json);
  return (layout.children || []).length ? json : null;
}

/**
 * 剪掉**空壳容器**：空 border（边缘栏）与空 subLayout（浮窗/弹出子布局）。
 *
 * `pruneEmptyTabsets` 只管主布局树；这两类壳在它视野之外——
 * 空的 border 恢复后渲染成一条无标题、无关闭按钮的空白竖条；
 * 空的 subLayout 恢复后渲染成一块空白浮窗。都是「没有视图却占位、又删不掉」的面板。
 * 存盘前剪 = 不再产生新的；读盘时剪 = 已经存坏的布局自动愈合。
 *
 * 纯函数：就地修改并返回原 json。单测直接覆盖。
 */
export function pruneBlankChrome(json: LayoutJson | null): LayoutJson | null {
  if (!json || typeof json !== 'object') return json;
  if (Array.isArray(json.borders)) {
    json.borders = json.borders.filter((b) => Array.isArray(b.children) && b.children.length > 0);
  }
  if (json.subLayouts && typeof json.subLayouts === 'object') {
    for (const id of Object.keys(json.subLayouts)) {
      const sub = json.subLayouts[id];
      const row = sub && sub.layout;
      const empty = !row
        || !Array.isArray(row.children)
        || row.children.length === 0
        || (row.children.length === 1 && row.children[0] && row.children[0].type === 'tabset' && (row.children[0].children || []).length === 0);
      if (empty) delete json.subLayouts[id];
    }
    if (Object.keys(json.subLayouts).length === 0) delete json.subLayouts;
  }
  return json;
}

/**
 * 读盘时愈合侧栏：补回缺失的目录页签、钉死 enableClose、归一病态 weight。
 *
 * 关键路径：目录 tab 被拖进主内容 tabset 后，收起/关闭会把整个主面板的
 * enableTabStrip 关掉、weight 压到 2.5——页签条消失，目录也选不中，界面卡死。
 * 只要目录和别的组件共处同一 tabset，就拆回「左目录 / 右内容」。
 *
 * 返回是否改过 json（调用方决定要不要立刻回写）。
 */
export function healSidebarLayout(json: LayoutJson | null): boolean {
  if (!json || !json.layout) return false;
  let changed = false;
  // 闭包里写、外面读：用函数返回值取，避免 TS 把「只在闭包里赋过值」的变量收窄成 null
  const findSidebar = (root: LayoutJson): { tab: LayoutJson | null; ts: LayoutJson | null } => {
    let tab: LayoutJson | null = null;
    let ts: LayoutJson | null = null;
    const walk = (node: LayoutJson | null, parent: LayoutJson | null) => {
      if (!node) return;
      if (node.type === 'tab' && node.component === 'sidebar') {
        tab = node;
        if (parent && parent.type === 'tabset') ts = parent;
      }
      if (Array.isArray(node.children)) {
        for (const c of node.children) walk(c, node);
      }
    };
    walk(root, null);
    return { tab, ts };
  };
  const { tab: sidebarTab, ts: sidebarTs } = findSidebar(json.layout);

  const row = json.layout;
  // 根行 children（行不是 row 时为 null）：后面的 unshift 都落在它上面
  const rowChildren = row && row.type === 'row' && Array.isArray(row.children) ? row.children : null;

  if (!sidebarTab) {
    // 目录被关掉了：塞回主布局左侧一个专用 tabset
    if (rowChildren) {
      rowChildren.unshift({
        type: 'tabset',
        id: 'ts_sidebar',
        weight: sideStateAttrs('expanded').weight,
        enableTabStrip: false,
        children: [{ type: 'tab', id: 't_sidebar', name: '目录', component: 'sidebar', enableClose: false }],
      });
      changed = true;
    }
    return changed;
  }

  const tab = sidebarTab;
  if (tab.enableClose !== false) {
    tab.enableClose = false;
    changed = true;
  }

  // 目录与其它页签混在同一 tabset → 拆开（否则收起侧栏会误伤主编辑区）
  const mixed = sidebarTs
    && Array.isArray(sidebarTs.children)
    && sidebarTs.children.some((c) => c && c.component !== 'sidebar');
  if (mixed && sidebarTs && rowChildren) {
    const kids = sidebarTs.children || [];
    const idx = kids.indexOf(tab);
    if (idx >= 0) kids.splice(idx, 1);
    // 修正 selected：原先指向被拆走之后的页签
    if (typeof sidebarTs.selected === 'number') {
      if (idx >= 0 && sidebarTs.selected > idx) sidebarTs.selected -= 1;
      else if (idx >= 0 && sidebarTs.selected === idx) {
        sidebarTs.selected = Math.max(0, Math.min(kids.length - 1, idx));
      }
      if (kids.length === 0) delete sidebarTs.selected;
      else if (sidebarTs.selected >= kids.length) sidebarTs.selected = kids.length - 1;
    }
    // 主内容区恢复正常页签条与权重（被关掉条 / 压成窄轨的都修回来）
    sidebarTs.enableTabStrip = true;
    const mw = Number(sidebarTs.weight);
    if (!Number.isFinite(mw) || mw < 8) sidebarTs.weight = 84;

    rowChildren.unshift({
      type: 'tabset',
      id: 'ts_sidebar',
      weight: sideStateAttrs('expanded').weight,
      enableTabStrip: false, // 侧栏不出页签条（#42：页签条会压住顶部面包屑）
      children: [tab],
    });
    changed = true;
    return changed;
  }

  if (sidebarTs) {
    const w = Number(sidebarTs.weight);
    // 读盘时若处于关闭档（含被拖到近 0）：直接展开。
    // 关掉后把手看不见时，刷新就能回来——比卡死在无侧栏强。
    if (!Number.isFinite(w) || w < 2) {
      const attrs = sideStateAttrs('expanded');
      if (sidebarTs.weight !== attrs.weight || sidebarTs.enableTabStrip !== attrs.enableTabStrip) {
        sidebarTs.weight = attrs.weight;
        sidebarTs.enableTabStrip = attrs.enableTabStrip;
        changed = true;
      }
    } else {
      const next = normalizeSidebarWeight(w);
      if (w !== next) {
        sidebarTs.weight = next;
        const st = next < 8 ? 'collapsed' : 'expanded';
        sidebarTs.enableTabStrip = sideStateAttrs(st).enableTabStrip;
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * 读盘时按新面板模型愈合（2026-11-04 #33）：
 *   1. 内容 tabset 一律**不显示页签条**（页签概念已删）；
 *   2. 老布局里没有**右侧栏**（ts_right）→ 补一个空的；
 *   3. 侧栏 tabset 同样不显示页签条（原来那条「目录」标题没意义了）。
 *
 * 老布局里的多页并存由 clearMainPanels 收拾：主区是单面板位。
 */
export function healNoTabs(json: LayoutJson | null): boolean {
  if (!json || !json.layout) return false;
  let changed = false;
  const walk = (node: LayoutJson) => {
    if (node.type === 'tabset') {
      if (node.enableTabStrip !== false) {
        node.enableTabStrip = false;
        changed = true;
      }
    }
    if (Array.isArray(node.children)) for (const c of node.children) walk(c);
  };
  walk(json.layout);
  const row = json.layout;
  if (row && row.type === 'row' && Array.isArray(row.children)
      && !row.children.some((c) => c && c.id === 'ts_right')) {
    row.children.push({ type: 'tabset', id: 'ts_right', weight: 16, enableTabStrip: false, children: [] });
    changed = true;
  }
  return changed;
}

/**
 * 读盘时愈合**主区 tabset 丢失**（maincontent 白板的直接病因）。
 *
 * 主区 tabset 什么时候会没：主区最后一个页签被关掉/清掉的瞬间，FlexLayout
 * 会把空 tabset **自动从活模型里删除**——saveModel 存盘时它已经不在了。
 * 这样的布局读回来，主区永远白板：openPanel 的主区分支 mainTabsetId() 找不到
 * 落点，点什么都开不出来（任务 #86 修复窗口期存坏过一批这样的布局）。
 *
 * 愈合 = 没有任何「内容 tabset」（ts_sidebar/ts_right 或纯侧栏 tabset 之外的）
 * 时，补一块带「开始」页的 ts_main——与初始布局同形，不空（空的会在存盘前
 * 被 pruneEmptyTabsets 再剪掉，白修）。
 *
 * 纯函数：就地修改并返回是否改过（调用方决定要不要回写）。单测直接覆盖。
 */
export function healMainTabset(json: LayoutJson | null): boolean {
  if (!json || !json.layout || json.layout.type !== 'row' || !Array.isArray(json.layout.children)) return false;
  let hasMain = false;
  const walk = (node: LayoutJson) => {
    if (hasMain) return;
    if (node.type === 'tabset') {
      const kids = node.children || [];
      // 装着**非侧栏**页签的 tabset 才算主区；空 tabset 和纯目录 tabset（含旧
      // 布局 ts_sidebar 丢 id 的形态）都不算——空的更不是，它正是病灶本身
      if (kids.some((k) => k && k.component !== 'sidebar')) hasMain = true;
    }
    if (Array.isArray(node.children)) for (const c of node.children) walk(c);
  };
  walk(json.layout);
  if (hasMain) return false;
  const seed = {
    type: 'tabset',
    id: 'ts_main',
    weight: 68,
    enableTabStrip: false,
    children: [{ type: 'tab', id: 't_welcome', name: '开始', component: 'welcome' }],
  };
  const rowChildren = json.layout.children;
  const rightIdx = rowChildren.findIndex((c) => c && c.id === 'ts_right');
  if (rightIdx >= 0) rowChildren.splice(rightIdx, 0, seed);
  else rowChildren.push(seed);
  return true;
}

/**
 * #115：老布局可能把右栏面板（refs / progress）存进了主内容区 ts_main——
 * 用户看到的是「点查看详情，文档列表把 landing 页整块顶掉」。
 *
 * 读盘时把它们从 ts_main 摘出来，补一个右栏 tabset 收进去（weight 16、无页签条），
 * 主区被压扁的 weight 修回 68。纯 JSON 层愈合，不动模型。
 * @returns 是否改过
 */
export function healRightPanelsInMain(json: any): boolean {
  const root = json && json.layout;
  if (!root || !Array.isArray(root.children)) return false;
  const main = root.children.find((c: any) => c && c.id === 'ts_main');
  if (!main || !Array.isArray(main.children)) return false;
  const isRightTab = (t: any) => !!t && t.type === 'tab' && ['refs', 'progress'].includes(String(t.component || ''));
  let changed = false;
  const rightTabs = main.children.filter(isRightTab);
  if (rightTabs.length) {
    main.children = main.children.filter((t: any) => !isRightTab(t));
    if (!main.children.length) {
      main.children.push({ type: 'tab', id: 't_welcome', name: '开始', component: 'welcome' });
    }
    let right = root.children.find((c: any) => c && c.id === 'ts_right');
    if (!right) {
      right = { type: 'tabset', id: 'ts_right', weight: 16, enableTabStrip: false, children: [] };
      root.children.push(right);
    }
    right.children = [...(right.children || []), ...rightTabs];
    changed = true;
  }
  const mw = Number(main.weight);
  if (!Number.isFinite(mw) || mw < 30) {
    main.weight = 68;
    changed = true;
  }
  return changed;
}

/** 读盘 → 模型；坏数据不吞掉整台应用，退回初始布局 */
export function loadModel(): Model {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return applyGlobalAttrs(Model.fromJson(initialLayoutJson()));
    const json = JSON.parse(raw);
    if (!json || !json.layout) return applyGlobalAttrs(Model.fromJson(initialLayoutJson()));
    // 剪空壳：老布局里已经存进去的空 tabset / 空 border / 空浮窗在这一步愈合
    if (!pruneEmptyTabsets(json.layout)) return applyGlobalAttrs(Model.fromJson(initialLayoutJson()));
    pruneBlankChrome(json);
    healSidebarLayout(json);
    healNoTabs(json); // 新面板模型：没有页签条、补右侧栏
    healMainTabset(json); // 主区 tabset 被存丢的布局：补回带「开始」页的 ts_main（否则主区永远白板）
    healRightPanelsInMain(json); // #115：refs/progress 被存进主区的老布局 → 搬回右栏
    return applyGlobalAttrs(Model.fromJson(json));
  } catch {
    return applyGlobalAttrs(Model.fromJson(initialLayoutJson()));
  }
}

/** 落盘：布局 JSON */
export function saveModel(model: Model | null | undefined) {
  if (!model) return;
  try {
    const out = model.toJson();
    // 存盘前剪空壳：库自己不删（见 pruneEmptyTabsets / pruneBlankChrome 的注释）
    if (out.layout && pruneEmptyTabsets(out.layout)) {
      pruneBlankChrome(out);
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(out));
    }
  } catch {
    /* 配额 / 隐私模式：布局不落盘不影响本次会话使用 */
  }
}

/**
 * 运行时剪掉空 tabset（主布局与浮窗里都算）。
 *
 * **为什么要运行时剪**：FlexLayout 0.11 的「浮窗」路径（点 tabset 标题栏的浮窗图标）
 * 把 tabset 连锅端进子布局后，**不给原位置留任何清理**——原 tabset 空了、
 * 没有标题栏也没有关闭按钮，渲染成一块无法删除的空白面板，直到刷新才被读盘剪枝愈合。
 * 库在 deleteTabset 之外的路径不 tidy，这里兜底：每次模型变化后删一次空 tabset。
 *
 * 返回删除的数量（0 = 无空壳）；调用方在 change listener 里使用，注意防重入。
 */
export function pruneBlankTabsets(model: Model | null | undefined): number {
  if (!model) return 0;
  const blanks: string[] = [];
  model.visitNodes((node) => {
    if (node.getType() === 'tabset' && (node.getChildren() || []).length === 0) blanks.push(node.getId());
  });
  for (const id of blanks) model.doAction(Actions.deleteTabset(id));
  return blanks.length;
}

export function clearStoredModel() {
  try {
    localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    /* 忽略 */
  }
}
