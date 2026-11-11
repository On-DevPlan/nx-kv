// 路由 ↔ 面板的纯映射（面板是「看得见的东西」，hash 是「能分享的地址」）。
//
// 与 panels 的分工：那边管「工作区里能开哪些面板」（要引 React 与各视图组件），
// 这边只管两种身份的互译——**纯函数、不引 React**，单测直接 import（node --test
// 解析不了 JSX）。
//
//   路由变化 → 打开/聚焦对应面板；选中面板变化 → 地址跟着走（replaceState，不触发 hashchange）。
//   深链因此永远能复现同一屏：地址决定开哪块面板。
//
// 具体规则**不在这里**：每个视图一份声明放在 routes/<名>.ts（模板的 definePage 约定），
// 本文件只做两件事——把 node/route 归一成查表入参，以及把结果拼成 PanelSpec。
// 这样「加一个页面」不会再来改这个文件；而恒等式（两个方向必须逐字互逆）由
// tests/unit/route-table.test.mjs 用基线夹具钉住。
import type { TabNode } from 'flexlayout-react';
import { pageOfView, reversesOf } from './routes/index.js';
import type { AppRoute, PanelSpec, SpecCtx } from './types.js';

// 视图声明的私有常量与文档 ref 编解码在 routes/ 下（各自只有一处真源），
// 这里只转出口——既有引用面（App.tsx、panels.tsx、单测）不用改。
export { GLOBAL_KEY } from './routes/keys.js';
export { decodeDocRef, encodeDocRef } from './routes/doc-ref.js';

/** 面板 → 路由（选中的面板变了，地址跟着变） */
export function routeOfPanel(node: TabNode | null | undefined): string | null {
  if (!node) return null;
  const component = node.getComponent();
  if (!component) return null;
  // 面板 config 是 FlexLayout 节点里的 JSON（形状按 component 而变）：外部边界，按索引放行
  const cfg: Record<string, any> = node.getConfig() || {};
  for (const rule of reversesOf(component)) {
    const out = rule.format(cfg);
    // undefined = 这条规则不认；null = 认了但有意不改地址（如旁路原文）
    if (out === undefined) continue;
    return out;
  }
  return null; // 侧栏 / 开始页 / 进程面板不是路由目标
}

/** 路由 → 面板规格（路由变了，打开/聚焦对应面板） */
export function panelSpecOfRoute(route: AppRoute | null | undefined, ctx: SpecCtx = {}): PanelSpec | null {
  if (!route) return null;
  const page = pageOfView(route.view);
  if (!page) return null;
  const hit = page.panelOf(route, ctx);
  if (!hit) return null;
  return { component: hit.panel.component, name: hit.name, config: hit.panel.config };
}
