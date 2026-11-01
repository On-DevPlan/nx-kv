// 侧栏三态（展开 / 收起窄轨 / 关闭）——纯函数，供 panel.jsx 与单测共用。
//
// 状态落在 FlexLayout tabset 的 weight 上（布局存 localStorage，刷新后保持）：
//   expanded  W_EXPANDED  = 16   正常宽度（约 229px @1440）
//   collapsed W_COLLAPSED = 2.5  窄轨（约 41px @1440，整条可点展开）
//   closed    W_CLOSED    = 1.2  完全隐藏，左缘只剩半圆弧悬浮把手（约 20px @1440）
//
// 判定阈值（读回存量布局时按 weight 分档）：
//   < 2 → closed；2 ~ 8 → collapsed；≥ 8 → expanded。
// W_CLOSED=1.2 与 W_COLLAPSED=2.5 分别落在两档里，互不越界；
// 用户手拖出来的中间宽度（拖拽落盘值）也会被归进最近的档。

export const W_CLOSED = 1.2;
export const W_COLLAPSED = 2.5;
export const W_EXPANDED = 16;

/** weight 过小（手拖到近 0）时 FlexLayout 不再渲染 tab 内容 → 关闭态把手跟着消失。 */
export const W_CLOSED_MIN = 0.5;

/** weight → 状态名；weight ≤ 0 / 非数（找不到 tabset / 异常）按展开处理 */
export function classifySideState(weight) {
  const w = Number(weight);
  if (!Number.isFinite(w) || w <= 0) return 'expanded';
  if (w < 2) return 'closed';
  if (w < 8) return 'collapsed';
  return 'expanded';
}

/**
 * 读盘 / 拖拽落盘后的 weight 归一：病态小值拉回可渲染档，避免「无侧栏也无把手」。
 *   ≤0 / 非数 → 展开；开着但 < W_CLOSED_MIN → 收到 W_CLOSED；其余按分档吸附。
 */
export function normalizeSidebarWeight(weight) {
  const w = Number(weight);
  if (!Number.isFinite(w) || w <= 0) return W_EXPANDED;
  if (w < W_CLOSED_MIN) return W_CLOSED;
  const state = classifySideState(w);
  return sideStateAttrs(state).weight;
}

/** 状态 → 落模型的 tabset 属性（weight + 是否显示页签条）；未知状态按展开兜底 */
export function sideStateAttrs(state) {
  const expanded = state === 'expanded' || (state !== 'collapsed' && state !== 'closed');
  return {
    weight: state === 'closed' ? W_CLOSED : state === 'collapsed' ? W_COLLAPSED : W_EXPANDED,
    enableTabStrip: expanded,
  };
}
