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
import { Actions, DockLocation, Model, Rect } from 'flexlayout-react';
import { normalizeSidebarWeight, sideStateAttrs } from './components/sidebar/side-state.js';
import { AREA, areaOf, isSingleton } from './workspace/areas.js';

/** 布局的落点。与 prefs 的 LS_KEY 分开存：布局大、单独读写不易互相踩。 */
export const WORKSPACE_KEY = 'nx-kv-ui.workspace';

/** 全局属性：属性继承的根（global.tabXxx ← 每个 tab 的默认值） */
const GLOBAL_ATTRS = {
  tabEnableClose: true,
  tabEnableDrag: true,
  tabEnableRename: false, // 页签只读：双击不出改名输入框
  // 「弹出 / 浮窗」**按钮**一律不要（2026-11-04 #33）：面板的落点由策略表决定，
  // 用户不需要在标题栏上挑「这块面板开成什么样」。能力留着——设置面板就是
  // float 面板（openFloatingPanel 走 popoutTab，与按钮无关）。
  tabEnablePopout: true,
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

/**
 * 读盘时愈合侧栏：补回缺失的目录页签、钉死 enableClose、归一病态 weight。
 *
 * 关键路径：目录 tab 被拖进主内容 tabset 后，收起/关闭会把整个主面板的
 * enableTabStrip 关掉、weight 压到 2.5——页签条消失，目录也选不中，界面卡死。
 * 只要目录和别的组件共处同一 tabset，就拆回「左目录 / 右内容」。
 *
 * 返回是否改过 json（调用方决定要不要立刻回写）。
 */
export function healSidebarLayout(json) {
  if (!json || !json.layout) return false;
  let changed = false;
  let sidebarTab = null;
  let sidebarTs = null;
  const walk = (node, parent) => {
    if (!node) return;
    if (node.type === 'tab' && node.component === 'sidebar') {
      sidebarTab = node;
      if (parent && parent.type === 'tabset') sidebarTs = parent;
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c, node);
    }
  };
  walk(json.layout, null);

  const row = json.layout;
  const canUnshift = row && row.type === 'row' && Array.isArray(row.children);

  if (!sidebarTab) {
    // 目录被关掉了：塞回主布局左侧一个专用 tabset
    if (canUnshift) {
      row.children.unshift({
        type: 'tabset',
        id: 'ts_sidebar',
        weight: sideStateAttrs('expanded').weight,
        enableTabStrip: true,
        children: [{ type: 'tab', id: 't_sidebar', name: '目录', component: 'sidebar', enableClose: false }],
      });
      changed = true;
    }
    return changed;
  }

  if (sidebarTab.enableClose !== false) {
    sidebarTab.enableClose = false;
    changed = true;
  }

  // 目录与其它页签混在同一 tabset → 拆开（否则收起侧栏会误伤主编辑区）
  const mixed = sidebarTs
    && Array.isArray(sidebarTs.children)
    && sidebarTs.children.some((c) => c && c.component !== 'sidebar');
  if (mixed && canUnshift) {
    const kids = sidebarTs.children;
    const idx = kids.indexOf(sidebarTab);
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

    row.children.unshift({
      type: 'tabset',
      id: 'ts_sidebar',
      weight: sideStateAttrs('expanded').weight,
      enableTabStrip: true,
      children: [sidebarTab],
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
export function healNoTabs(json) {
  if (!json || !json.layout) return false;
  let changed = false;
  const walk = (node) => {
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
    healSidebarLayout(json);
    healNoTabs(json); // 新面板模型：没有页签条、补右侧栏
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


// ─── 区域定位（2026-11-04 #33 统一命名：sidebar / maincontent / rightSidebar / float）───

/** 主内容区的 tabset（主内容区**同时只显示一个面板**——没有页签） */
export function mainTabsetId(model) {
  if (!model) return null;
  let hit = null;
  model.visitNodes((node) => {
    if (hit) return;
    if (node.getType() !== 'tabset') return;
    const id = node.getId();
    if (id === 'ts_main') { hit = id; return; }
    // 老布局里主区的 id 可能不是 ts_main：取「不是侧栏、不是右侧栏」的那组
    if (id !== 'ts_sidebar' && id !== 'ts_right' && !hasComponent(node, ['sidebar'])) hit = id;
  });
  return hit;
}

/** 右侧栏（并发进程面板）的 tabset */
export function rightTabsetId(model) {
  if (!model) return null;
  let hit = null;
  model.visitNodes((node) => {
    if (hit) return;
    if (node.getType() === 'tabset' && node.getId() === 'ts_right') hit = node.getId();
  });
  return hit;
}

const RIGHT_WEIGHT_OPEN = 16;
const RIGHT_WEIGHT_CLOSED = 0;

/** 展开 / 收起右侧栏（关掉进程面板后重量归零，再开进程时拉回来） */
export function setRightSidebarVisible(model, visible) {
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
export function closeRightSidebar(model) {
  if (!model) return;
  const victims = [];
  model.visitNodes((node) => {
    if (node.getType() !== 'tab') return;
    if (node.getComponent() === 'progress') victims.push(node.getId());
  });
  for (const id of victims) model.doAction(Actions.deleteTab(id));
  setRightSidebarVisible(model, false);
}

/**
 * 主内容区切到某目录/任务时，若右侧进程面板已开，同步它的 dirKey/task——
 * 否则会一直显示「上一个任务」所属目录的进程（#33 验收反馈）。
 */
export function syncProgressPanel(model, { dirKey, task } = {}) {
  if (!model) return;
  const tab = findComponentPanel(model, 'progress');
  if (!tab) return;
  const prev = tab.getConfig() || {};
  const next = { dirKey: dirKey || '' };
  if (task != null && String(task) !== '') next.task = String(task);
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  model.doAction(Actions.updateNodeAttributes(tab.getId(), { config: next }));
  if (dirKey) setRightSidebarVisible(model, true);
}

/**
 * 主内容区只留一个面板：开新面板前把主区里**别的**内容面板关掉。
 *
 * 为什么：工作区没有页签了（#33），多个面板并存但用户看不见页签条 →
 * 「点了没反应」。所以主区是**单面板位**：新的进来，旧的出去。
 * 侧栏与右侧栏不动。
 */
/**
 * 清掉主内容区里的面板（含并排的「旁路原文」）。
 * 侧栏 / 右侧进程栏不动；浮窗也不动。
 */
export function clearMainPanels(model) {
  if (!model) return 0;
  const rightTs = rightTabsetId(model);
  const victims = [];
  model.visitNodes((node) => {
    if (node.getType() !== 'tab') return;
    const c = node.getComponent();
    if (c === 'sidebar' || c === 'progress') return;
    const parent = node.getParent && node.getParent();
    if (!parent || parent.getType() !== 'tabset') return;
    const tsId = parent.getId();
    if (tsId === 'ts_sidebar' || (rightTs && tsId === rightTs)) return;
    // 浮窗在 subLayout 里，父 tabset 不在主布局——用 getWindowId / floating 判断
    if (typeof node.getWindowId === 'function' && node.getWindowId()) return;
    victims.push(node.getId());
  });
  for (const id of victims) model.doAction(Actions.deleteTab(id));
  return victims.length;
}

/** 关掉主区里所有「旁路」面板（config.beside） */
export function closeBesidePanels(model) {
  if (!model) return 0;
  const victims = [];
  model.visitNodes((node) => {
    if (node.getType() !== 'tab') return;
    const cfg = node.getConfig() || {};
    if (cfg.beside) victims.push(node.getId());
  });
  for (const id of victims) model.doAction(Actions.deleteTab(id));
  return victims.length;
}

/**
 * 在当前主内容区**右侧并排**开一块面板（不清主区现有内容）。
 * 评论任务看原文用：左评论、右原文；原文可单独关掉。
 * config 会带 beside:true——选中时不改路由，避免抢主区焦点。
 */
export function openBesideMain(model, spec) {
  const { component, name, config = {} } = spec || {};
  if (!model || !component) return { tabId: null, reused: false };
  const mainTs = mainTabsetId(model);
  if (!mainTs) return { tabId: null, reused: false };
  const besideCfg = { ...config, beside: true };

  // 同款旁路面板已开 → 聚焦
  const existing = findOpenPanel(model, component, besideCfg);
  if (existing) {
    model.doAction(Actions.selectTab(existing.getId()));
    if (name && existing.getName() !== name) {
      model.doAction(Actions.renameTab(existing.getId(), name));
    }
    return { tabId: existing.getId(), reused: true };
  }

  // 同时只留一块旁路原文
  closeBesidePanels(model);

  model.doAction(Actions.addTab(
    { type: 'tab', name: name || component, component, config: besideCfg, enableClose: true },
    mainTs,
    DockLocation.getByName('right'),
    -1,
    true
  ));
  const created = findOpenPanel(model, component, besideCfg);
  return { tabId: created ? created.getId() : null, reused: false };
}

/**
 * 开一个面板。
 * @param {object} model
 * @param {{component:string, name:string, config?:object, location?:string}} spec
 *        location ∈ center | left | right | top | bottom（FlexLayout 的 DockLocation）
 * @returns {{tabId:string, reused:boolean}}
 */
export function openPanel(model, spec) {
  const { component, name, config = {} } = spec;
  if (!model) return { tabId: null, reused: false };
  // 落点由**策略表**决定（workspace/areas.js）：sidebar / maincontent /
  // rightSidebar / float —— 以前散在调用点各处特判。
  const area = spec.area || areaOf(component);

  const existing = findOpenPanel(model, component, config);
  if (existing) {
    // 同款已开：主内容区（只有一个位）与单例面板都是「聚焦即可」，不重复开。
    model.doAction(Actions.selectTab(existing.getId()));
    // 复用面板时**同步页签名**：深链给的标题与旧页签不一致时，
    // 页签还挂着旧名字，就会出现「两个面板同名、分不清谁是谁」。
    if (name && existing.getName() !== name) {
      model.doAction(Actions.renameTab(existing.getId(), name));
    }
    if (area === AREA.RIGHT) setRightSidebarVisible(model, true);
    if (area === AREA.MAIN && (component === 'page' || component === 'dir')) {
      syncProgressPanel(model, { dirKey: config.dirKey, task: config.task });
    }
    return { tabId: existing.getId(), reused: true };
  }

  // 右侧单例（进程）：config 变了（换目录）也要复用同一块，并改 config——
  // 否则会堆多份，或一直钉着上一个目录的进程（#33）。
  if (area === AREA.RIGHT && isSingleton(component)) {
    const any = findComponentPanel(model, component);
    if (any) {
      model.doAction(Actions.updateNodeAttributes(any.getId(), { config }));
      model.doAction(Actions.selectTab(any.getId()));
      if (name && any.getName() !== name) {
        model.doAction(Actions.renameTab(any.getId(), name));
      }
      setRightSidebarVisible(model, true);
      return { tabId: any.getId(), reused: true };
    }
  }

  // 主内容区：**单面板位**——没有页签了，新的进来旧的出去（#33）。
  if (area === AREA.MAIN) {
    clearMainPanels(model);
    const mainTs = mainTabsetId(model);
    if (!mainTs) return { tabId: null, reused: false };
    model.doAction(Actions.addTab(
      { type: 'tab', name, component, config },
      mainTs,
      DockLocation.getByName('center'),
      -1,
      true
    ));
    const created = findOpenPanel(model, component, config);
    // 切主区目录/任务时，已打开的进程面板跟着换目录
    if (created && (component === 'page' || component === 'dir')) {
      syncProgressPanel(model, { dirKey: config.dirKey, task: config.task });
    }
    return { tabId: created ? created.getId() : null, reused: false };
  }

  // 右侧栏：并发进程面板
  if (area === AREA.RIGHT) {
    const rightTs = rightTabsetId(model);
    if (rightTs) {
      setRightSidebarVisible(model, true);
      model.doAction(Actions.addTab(
        { type: 'tab', name, component, config },
        rightTs,
        DockLocation.getByName('center'),
        -1,
        true
      ));
      const created = findOpenPanel(model, component, config);
      return { tabId: created ? created.getId() : null, reused: false };
    }
    // 没有右侧栏（旧布局）→ 退回主区
  }

  // 浮窗面板：先按普通面板加进主区，再 popoutTab 成浮动窗
  if (area === AREA.FLOAT) {
    return openFloatingPanel(model, { ...spec, component, name, config });
  }

  // 兜底（未登记的面板）：按老逻辑进当前面板组
  const target = activeTabsetId(model, ['sidebar']);
  if (!target) return { tabId: null, reused: false };
  const dock = DockLocation.getByName(spec.location || 'center');
  model.doAction(Actions.addTab({ type: 'tab', name, component, config }, target, dock, -1, true));
  const created = findOpenPanel(model, component, config);
  return { tabId: created ? created.getId() : null, reused: false };
}

/**
 * 开一个**浮动面板**（float）：先按普通面板加进工作区，再 popoutTab 成浮动窗。
 *
 * 设置面板用这个形态：设置是「临时开一块、看完就关」的东西，
 * 长期挤在工作区里占位不合适；浮动窗可拖走、可叠放、关掉不带走布局。
 * 已开着同一个面板时不重复开，只把它选中（findOpenPanel 遍历所有布局，浮窗也算）。
 */
export function openFloatingPanel(model, spec) {
  const r = openPanel(model, { ...spec, location: spec.location || 'center' });
  if (!r || !r.tabId || r.reused) return r;
  const before = new Set([...model.getLayouts().keys()]);
  model.doAction(Actions.popoutTab(r.tabId, 'float'));
  // 新浮窗的默认矩形会铺满主区（不像「浮动面板」），这里收成面板尺寸并居中。
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const width = Math.min(760, Math.max(560, vw - 160)); // 设置面板：左侧分区导航 + 右侧内容
  const height = Math.min(700, Math.max(460, vh - 160));
  for (const [id, layout] of model.getLayouts()) {
    if (before.has(id) || layout.getType() !== 'float') continue;
    // 用库自己的 moveFloat 动作改矩形：直接 setRect 不会被浮窗组件读到
    // （浮窗样式在渲染时读 layout.getRect()，但只有 moveFloat 会触发重绘）。
    // 初始矩形 = 页签所在容器的内容区（≈主工作区，不含侧栏）——在它里面居中，
    // 浮窗就不会盖住侧栏。
    const host = layout.getRect();
    const rect = new Rect(
      Math.round(host.x + (host.width - width) / 2),
      Math.round(host.y + (host.height - height) / 2),
      width,
      height
    );
    model.doAction(Actions.moveFloat(layout.getLayoutId(), rect));
  }
  return r;
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

// ─── 清空当前面板组 ─────────────────────────────────────────────
//
// 页签条右端的「清空」按钮：一次关掉**本组**的全部可关页签。
// 只作用于按钮所在的 tabset——别的组、浮窗、边界栏一概不碰；
// 目录这类钉死页签（enableClose:false）天然不在「可关」之列，侧栏组
// 因为没有可关页签，连按钮都不出现。

/** 本组里实际会关掉的页签数（按钮角标/确认框口径，与 clearTabset 一致） */
export function countClearable(model, tabset) {
  if (!model || !tabset) return 0;
  return (tabset.getTabNodes() || []).filter((t) => t.isEnableClose()).length;
}

/** 节点是否在**主布局**里（浮窗/弹出窗是 subLayout，根不是主布局的根行） */
function inMainLayout(model, node) {
  let p = node;
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
export function clearTabset(model, tabset) {
  if (!model || !tabset) return 0;
  const deletable = (tabset.getTabNodes() || []).filter((t) => t.isEnableClose());
  if (!deletable.length) return 0;

  // 主布局清完还有没有别的**内容**页签（侧栏钉死页签不算数）
  const deletableIds = new Set(deletable.map((t) => t.getId()));
  let survivor = false;
  model.visitNodes((node) => {
    if (survivor || node.getType() !== 'tab') return;
    if (deletableIds.has(node.getId())) return;
    if (node.getComponent() === 'sidebar') return;
    if (inMainLayout(model, node)) survivor = true;
  });
  if (!survivor) {
    model.doAction(Actions.addTab(
      { type: 'tab', name: '开始', component: 'welcome' },
      tabset.getId(),
      DockLocation.getByName('center'),
      -1,
      true
    ));
  }
  for (const t of deletable) model.doAction(Actions.deleteTab(t.getId()));
  return deletable.length;
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

/**
 * 运行时补回被关掉的目录页签（停靠到主布局最左侧）。
 * 返回新 tabset id；已存在则直接返回现有 tabset id。
 */
export function restoreSidebarTab(model) {
  if (!model) return null;
  const existing = tabsetOfComponent(model, 'sidebar');
  if (existing) return existing;
  const first = model.getFirstTabSet && model.getFirstTabSet();
  const target = first ? first.getId() : null;
  if (!target) return null;
  model.doAction(Actions.addTab(
    { type: 'tab', id: 't_sidebar', name: '目录', component: 'sidebar', enableClose: false },
    target,
    DockLocation.getByName('left'),
    -1,
    true
  ));
  const tsId = tabsetOfComponent(model, 'sidebar');
  if (tsId) setTabsetAttrs(model, tsId, sideStateAttrs('expanded'));
  return tsId;
}

/** 当前选中的 tab（深链同步用） */
export function activeTab(model) {
  const ts = model && model.getActiveTabset();
  const tab = ts && ts.getSelectedNode();
  return tab || null;
}
