// 工作区 —— 布局模型（唯一真源）+ 持久化 + 开面板
//
// 这一层贴着 FlexLayout 的模型语义写，不自造：
//   · 模型 = JSON 树（row → tabset → tab），UI 是它的投影
//   · 所有改动走 Actions.*（model.doAction），**不直接改节点属性**
//   · 存盘 = model.toJson()；恢复 = Model.fromJson()
//   · 拖拽/停靠的语义由库负责，我们只提供「往哪个 tabset 塞哪块面板」
//
// 布局存 localStorage（独立 key）：面板摆在哪跟数据无关，进 store.json 只会让 diff 变噪音。
// 与 prefs（展开态、隐藏、排序那类 UI 偏好）分开存 —— 两边生命周期不同：
// prefs 是「这个浏览器的口味」，布局是「这个工作区的骨架」。
import { Actions, DockLocation, Model } from 'flexlayout-react';

/** 布局的落点。与 prefs 的 LS_KEY 分开存：布局大、单独读写不易互相踩。 */
export const WORKSPACE_KEY = 'nx-kv-ui.workspace';

/** 全局属性：属性继承的根（global.tabXxx ← 每个 tab 的默认值） */
const GLOBAL_ATTRS = {
  tabEnableClose: true,
  tabEnableDrag: true,
  tabEnableRename: true,
  tabEnablePopout: true,
  tabEnablePopoutIcon: true, // 标题栏出现「弹出」按钮——可见入口
  tabEnableFloat: true,
  tabEnableFloatIcon: true, // 标题栏出现「浮窗」按钮——可见入口
  tabEnablePin: false,
  tabSetEnableClose: false,
  tabSetEnableCloseButton: true,
  tabSetEnableMaximize: true,
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
export function initialLayoutJson() {
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
          children: [{ type: 'tab', id: 't_sidebar', name: '目录', component: 'sidebar' }],
        },
        {
          type: 'tabset',
          id: 'ts_main',
          weight: 84,
          children: [{ type: 'tab', id: 't_welcome', name: '开始', component: 'welcome' }],
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
export function applyGlobalAttrs(model) {
  model.updateAttrs({ ...GLOBAL_ATTRS });
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
export function pruneEmptyTabsets(json) {
  if (!json || json.type !== 'row' || !Array.isArray(json.children)) return json;
  const walk = (node) => {
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
  return layout.children.length ? json : null;
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
export function pruneBlankChrome(json) {
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

/** 读盘 → 模型；坏数据不吞掉整台应用，退回初始布局 */
export function loadModel() {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return applyGlobalAttrs(Model.fromJson(initialLayoutJson()));
    const json = JSON.parse(raw);
    if (!json || !json.layout) return applyGlobalAttrs(Model.fromJson(initialLayoutJson()));
    // 剪空壳：老布局里已经存进去的空 tabset / 空 border / 空浮窗在这一步愈合
    if (!pruneEmptyTabsets(json.layout)) return applyGlobalAttrs(Model.fromJson(initialLayoutJson()));
    pruneBlankChrome(json);
    return applyGlobalAttrs(Model.fromJson(json));
  } catch {
    return applyGlobalAttrs(Model.fromJson(initialLayoutJson()));
  }
}

/** 落盘：布局 JSON */
export function saveModel(model) {
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
export function pruneBlankTabsets(model) {
  if (!model) return 0;
  const blanks = [];
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

/** 找到已打开的同款面板（component + config 一致）——避免重复开同名面板 */
export function findOpenPanel(model, component, config) {
  const want = JSON.stringify(config || {});
  let hit = null;
  model.visitNodes((node) => {
    if (hit) return;
    if (node.getType() !== 'tab') return;
    if (node.getComponent() !== component) return;
    if (JSON.stringify(node.getConfig() || {}) !== want) return;
    hit = node;
  });
  return hit;
}

/** 全部 tabset（主布局里的；border 的不算——那是边界栏） */
export function allTabsets(model) {
  const out = [];
  model.visitNodes((node) => {
    if (node.getType() === 'tabset') out.push(node);
  });
  return out;
}

/** 第一个 component 匹配的页签（**不限 config**）——单例面板只有一块。 */
export function findComponentPanel(model, component) {
  let hit = null;
  model.visitNodes((node) => {
    if (hit) return;
    if (node.getType() !== 'tab') return;
    if (node.getComponent() !== component) return;
    hit = node;
  });
  return hit;
}

/** 这个 tabset 里有没有指定 component 的页签 */
function hasComponent(tabset, components) {
  if (!components || !components.length) return false;
  return (tabset.getTabNodes() || []).some((t) => components.includes(t.getComponent()));
}

/**
 * 开面板的落点。
 *
 * **不能落进侧栏自己的 tabset**——侧栏是一个「面板」，它所在的面板组是给它用的；
 * 从侧栏开别的面板，页签应该进**工作区**，否则工作区会开在侧栏旁边，
 * 侧栏那一组还会越攒越多。
 */
export function activeTabsetId(model, exclude = []) {
  const ts = model.getActiveTabset() || model.getFirstTabSet();
  if (ts && !hasComponent(ts, exclude)) return ts.getId();
  const fallback = [...allTabsets(model)].reverse().find((s) => !hasComponent(s, exclude));
  return fallback ? fallback.getId() : (ts ? ts.getId() : undefined);
}

/**
 * 开一个面板。
 * @param {object} model
 * @param {{component:string, name:string, config?:object, location?:string}} spec
 *        location ∈ center | left | right | top | bottom（FlexLayout 的 DockLocation）
 * @returns {{tabId:string, reused:boolean}}
 */
export function openPanel(model, spec) {
  const { component, name, config = {}, location = 'center' } = spec;
  if (!model) return { tabId: null, reused: false };
  const existing = findOpenPanel(model, component, config);
  if (existing) {
    model.doAction(Actions.selectTab(existing.getId()));
    // 复用面板时**同步页签名**：深链给的标题与旧页签不一致时，
    // 页签还挂着旧名字，就会出现「两个面板同名、分不清谁是谁」。
    if (name && existing.getName() !== name) {
      model.doAction(Actions.renameTab(existing.getId(), name));
    }
    return { tabId: existing.getId(), reused: true };
  }

  const target = activeTabsetId(model, ['sidebar']);
  if (!target) return { tabId: null, reused: false };

  const dock = DockLocation.getByName(location);
  model.doAction(Actions.addTab({ type: 'tab', name, component, config }, target, dock, -1, true));
  // addTab 之后按 component+config 找回刚建的 tab（FlexLayout 会分配 id）
  const created = findOpenPanel(model, component, config);
  return { tabId: created ? created.getId() : null, reused: false };
}

/** 把一个面板挪到指定停靠位（换布局用） */
export function dockPanel(model, tabId, location) {
  const target = activeTabsetId(model);
  if (!target) return false;
  model.doAction(Actions.moveNode(tabId, target, DockLocation.getByName(location), -1, true));
  return true;
}

/** 关闭某个面板 */
export function closePanel(model, tabId) {
  if (!tabId) return false;
  model.doAction(Actions.deleteTab(tabId));
  return true;
}

/** 找到承载某个 component 页签的 tabset id（侧栏收起/展开要用它改 weight） */
export function tabsetOfComponent(model, component) {
  if (!model) return null;
  let hit = null;
  model.visitNodes((node) => {
    if (hit) return;
    if (node.getType() !== 'tab') return;
    if (node.getComponent() !== component) return;
    // TabNode 没有 getTabset()：页签的父节点就是它所在的 tabset
    const parent = node.getParent();
    if (parent && parent.getType() === 'tabset') hit = parent;
  });
  return hit ? hit.getId() : null;
}

/** 读某个 tabset 的 weight（布局宽度 = weight 的比例分摊）；找不到返回 null */
export function tabsetWeight(model, tabsetId) {
  if (!model || !tabsetId) return null;
  let w = null;
  model.visitNodes((node) => {
    if (w !== null) return;
    if (node.getType() === 'tabset' && node.getId() === tabsetId) w = node.getWeight();
  });
  return w;
}

/** 改 tabset 属性（weight / enableTabStrip …）；目标不存在时安全 no-op */
export function setTabsetAttrs(model, tabsetId, attrs) {
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

/** 布局统计（状态条用） */
export function layoutStats(model) {
  let tabsets = 0;
  let tabs = 0;
  model.visitNodes((node) => {
    if (node.getType() === 'tabset') tabsets += 1;
    if (node.getType() === 'tab') tabs += 1;
  });
  return { tabsets, tabs };
}

/** 当前选中的 tab（状态条 / 深链同步用） */
export function activeTab(model) {
  const ts = model && model.getActiveTabset();
  const tab = ts && ts.getSelectedNode();
  return tab || null;
}
