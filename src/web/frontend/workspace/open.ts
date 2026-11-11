// 工作区开面板流程：openPanel（策略表分发落点）、openFloatingPanel（浮窗）、
// openBesideMain（主区右侧并排）。
//
// 这一层只调 Actions.*（model.doAction），**不直接改节点属性**；
// 找落点 / 清场的工具函数在 ./panels.js，面板 → 区域的策略表在 ./areas.js。
import { Actions, DockLocation, Rect } from 'flexlayout-react';
import type { Model, ModelLayout } from 'flexlayout-react';
import type { PanelSpec } from '../types.js';
import { AREA, areaOf, isSingleton } from './areas.js';
import {
  activeTabsetId,
  clearMainPanels,
  clearRightPanels,
  closeBesidePanels,
  findComponentPanel,
  findOpenPanel,
  mainTabsetId,
  rightTabsetId,
  setRightSidebarVisible,
  syncProgressPanel,
} from './panels.js';

/** 开面板的返回：新页签 id（失败/无落点时为 null）与是否复用了已有页签。 */
export interface OpenPanelResult {
  tabId: string | null;
  reused: boolean;
}

/**
 * openPanel 的入参：PanelSpec + 策略表/内部流路用的开关。
 *
 * location 放宽成 string：DockLocation 按名字取停靠位，调用方常直接把路由里
 * 的字符串透传进来（'center' / 'left' …）。
 */
export interface OpenPanelSpec extends Omit<PanelSpec, 'location' | 'name'> {
  /** 允许 null：调用方常直接把可能缺失的条目名/路由参数透传进来 */
  name?: string | null;
  location?: string;
  /** 显式指定落点区域（覆盖策略表）：openFloatingPanel 借道主区时必须给 */
  area?: string;
  /** 浮窗流路内部标记：借道主区但不清场（见 openFloatingPanel 的注释） */
  _float?: boolean;
}

/** flexlayout 0.11 的 .d.ts 漏声明了这两个运行时方法（App.tsx 里同样打补丁）。 */
type ModelRuntime = Model & {
  getLayouts(): Map<string, ModelLayout>;
  nextUniqueId(): string;
};

/** flexlayout 0.11 的 .d.ts 没声明 DockLocation.getByName（运行时按名字取停靠位）。 */
const dockOf = (name: string): DockLocation =>
  (DockLocation as unknown as { getByName(n: string): DockLocation }).getByName(name);

/**
 * 在当前主内容区**右侧并排**开一块面板（不清主区现有内容）。
 * 评论任务看原文用：左评论、右原文；原文可单独关掉。
 * config 会带 beside:true——选中时不改路由，避免抢主区焦点。
 */
export function openBesideMain(model: Model | null | undefined, spec: PanelSpec): OpenPanelResult {
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
    dockOf('right'),
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
export function openPanel(model: Model | null | undefined, spec: OpenPanelSpec): OpenPanelResult {
  const { component, config = {} } = spec;
  // FlexLayout 的页签名只接受 string：null 归一成 undefined（行为同旧代码的缺省）
  const name = spec.name ?? undefined;
  if (!model) return { tabId: null, reused: false };
  // 落点由**策略表**决定（./areas.js）：sidebar / maincontent /
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
      syncProgressPanel(model, { dirKey: config.dirKey, groupId: config.groupId, task: config.task });
    }
    return { tabId: existing.getId(), reused: true };
  }

  // 右侧单例（进程 / 文档列表）：config 变了（换目录）也要复用同一块，并改 config——
  // 否则会堆多份，或一直钉着上一个目录的进程（#33）。
  if (area === AREA.RIGHT && isSingleton(component)) {
    // 单面板位：同款复用聚焦前，先把别的右栏面板清掉（没有页签条，共存=互相挡死）
    clearRightPanels(model, component);
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
    // 顺序不能反：先把新页签落进**还没清**的 tabset，再清旧内容（keepId 留住新页签）。
    // 先清后落会把唯一 tabset 清空——FlexLayout 自动删空 tabset，addTab 没地方落、
    // 静默丢失，主区一片空白（#86 探针实测）。
    // 浮窗流路（_float，openFloatingPanel 借道主区再 popout）不清场：设置这类面板
    // 浮在内容上，主区清空了 popout 一走 tabset 就空、被自动删，主区从此打不开面板。
    const mainTs = mainTabsetId(model);
    if (!mainTs) return { tabId: null, reused: false };
    model.doAction(Actions.addTab(
      { type: 'tab', name, component, config },
      mainTs,
      dockOf('center'),
      -1,
      true
    ));
    const created = findOpenPanel(model, component, config);
    if (created && !spec._float) clearMainPanels(model, created.getId());
    // 切主区目录/任务时，已打开的进程面板跟着换目录（组锚定页跟组，#86）
    if (created && !spec._float && (component === 'page' || component === 'dir')) {
      syncProgressPanel(model, { dirKey: config.dirKey, groupId: config.groupId, task: config.task });
    }
    return { tabId: created ? created.getId() : null, reused: false };
  }

  // 右侧栏：并发进程面板（单面板位——先清别的右栏面板再落新页签）
  if (area === AREA.RIGHT) {
    const rightTs = rightTabsetId(model);
    if (rightTs) {
      clearRightPanels(model, component);
      setRightSidebarVisible(model, true);
      model.doAction(Actions.addTab(
        { type: 'tab', name, component, config },
        rightTs,
        dockOf('center'),
        -1,
        true
      ));
      const created = findOpenPanel(model, component, config);
      return { tabId: created ? created.getId() : null, reused: false };
    }
    // ts_right 缺失（fromJson 丢空 tabset，见 rightTabsetId 注）：
    // 把第一块右栏面板 dock 到**根行右缘**——FlexLayout 会为它现建 tabset，
    // 随后 rightTabsetId 按内容认回它；setRightSidebarVisible 把落点归一成
    // 16% 宽并压掉页签条（enableTabStrip:false）。
    // 根行要用 getRootRow()——flexlayout 0.11 的 Model 没有 getRoot()，
    // 以前写 `model.getRoot ? model.getRoot() : null` 恒为 null，这个分支
    // 整段死代码，首次开右栏永远掉进下面的兜底：dock 进 ts_main 右缘，
    // 页签条和乱宽度全冒出来（2026-11-07 #91 探针实锤）。
    const root = model.getRootRow ? model.getRootRow() : null;
    if (root) {
      model.doAction(Actions.addTab(
        { type: 'tab', name, component, config },
        root.getId(),
        dockOf('right'),
        -1,
        true
      ));
      const created = findOpenPanel(model, component, config);
      setRightSidebarVisible(model, true);
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
  const dock = dockOf(spec.location || 'center');
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
 *
 * ⚠️ 内层 openPanel 必须**显式给 area**（AREA.MAIN）：否则 areaOf(component) 又判成
 * FLOAT → 又调回 openFloatingPanel → 无限递归（首次打开设置面板直接爆栈，
 * 2026-11-04 #41 实测发现；老布局因为已存着设置浮窗、走 existing 早退而侥幸没踩到）。
 */
export function openFloatingPanel(model: Model | null | undefined, spec: OpenPanelSpec): OpenPanelResult {
  if (!model) return { tabId: null, reused: false };
  const rt = model as ModelRuntime;
  // 整条链（落页签 → 弹出成浮窗 → 挪矩形）**一个 group**，撤销只回退一步（#93）。
  //
  // 为什么自己拼而不复用 openPanel：openPanel 内部 model.doAction(addTab) 是
  // **独立一次** doAction——撤销栈会记两步，用户连点几次撤销才把浮窗关掉
  // （实测：点一次撤销浮窗还在，第二次才消失）。库的 applyGroup 内部走
  // applyAction、不触发 change 监听器上的 onBeforeAction，所以整段只占一步。
  //
  // popoutTab 需要 tabId，而 tabId 是 addTab 执行后才有的——所以**先自己发一个
  // tab id**（tab 的 id 是普通属性，可自带），三个 action 就能一次性排好。
  const existing = findOpenPanel(model, spec.component, spec.config || {});
  if (existing) {
    model.doAction(Actions.selectTab(existing.getId()));
    return { tabId: existing.getId(), reused: true };
  }
  const mainTs = mainTabsetId(model);
  if (!mainTs) return { tabId: null, reused: false };
  const tabId = rt.nextUniqueId();
  const actions = [
    Actions.addTab(
      { type: 'tab', id: tabId, name: spec.name || spec.component, component: spec.component, config: spec.config || {} },
      mainTs,
      dockOf('center'),
      -1,
      true
    ),
    Actions.popoutTab(tabId, 'float'),
  ];
  model.doAction(Actions.group(actions));
  // 浮窗的默认矩形会铺满主区（不像「浮动面板」），这里收成面板尺寸并居中。
  // 挪矩形**不进 group**：它要等浮窗 layout 已存在才知道 layoutId 与宿主矩形，
  // 且挪位置不该单独占一步撤销（用户撤销的是「开浮窗」这件事）。
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const width = Math.min(760, Math.max(560, vw - 160)); // 设置面板：左侧分区导航 + 右侧内容
  const height = Math.min(700, Math.max(460, vh - 160));
  for (const [, layout] of rt.getLayouts()) {
    if (layout.getType() !== 'float') continue;
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
  return { tabId, reused: false };
}
