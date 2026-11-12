// ack 定位轨的拖动落点（任务 #55）：坐标钳制 + localStorage 持久化。
//
// 轨默认钉在任务正文区右上（.mdw > .ack-rail 的 CSS 顶/底）；用户按住汉堡钮可把
// 整条轨拖到容器内任意位置，落点存 localStorage，重开面板还在。纯函数与存取都在
// 这一层，不依赖 DOM——指针事件编排在组件（components/md/ack-rail.jsx）里，
// 这层保持 node 单测可直接覆盖（localStorage 缺席时存取静默降级）。

const POS_KEY = 'nx-kv-ack-rail-pos';
/** 任务页 ack 轨的落点键（默认值，等价于不传 key） */
export const ACK_RAIL_POS_KEY = POS_KEY;
/** 文档 / 简介页右侧目录轨的落点键（同一套拖拽语义，落点各记各的） */
export const DOC_RAIL_POS_KEY = 'nx-kv-doc-rail-pos';
export const RAIL_MARGIN = 8; // 落点距容器边缘的最小间距

/** 轨的落点（容器坐标系）。 */
export interface RailPos {
  x: number;
  y: number;
}

/** 钳制入参：落点 + 容器/轨尺寸（railW/railH/margin 可省）。 */
export interface RailClampInput {
  x?: number;
  y?: number;
  parentW?: number;
  parentH?: number;
  railW?: number;
  railH?: number;
  margin?: number;
}

/**
 * 把落点钳回容器内（四边各留 margin）。容器比轨还窄/矮时，钳到 margin 为下限
 * （宁可贴边也不出界）。任何输入非法 → 返回 null（调用方放弃本次更新）。
 * @param p 落点 + 容器/轨尺寸
 * @returns 钳制后的落点
 */
export function clampRailPos(p: RailClampInput = {}): RailPos | null {
  const { x, y, parentW, parentH, railW = 0, railH = 0, margin = RAIL_MARGIN } = p || {};
  if (![x, y, parentW, parentH].every((n) => Number.isFinite(n))) return null;
  // 守卫后这四个值都是有限数（Number.isFinite 只对 number 返回 true）
  const px = Number(x);
  const py = Number(y);
  const pw = Number(parentW);
  const ph = Number(parentH);
  const maxX = Math.max(margin, pw - railW - margin);
  const maxY = Math.max(margin, ph - railH - margin);
  return {
    x: Math.min(maxX, Math.max(margin, px)),
    y: Math.min(maxY, Math.max(margin, py)),
  };
}

/**
 * 读取持久化落点；无记录 / 脏数据 / localStorage 不可用 → null（回落到 CSS 默认位）
 * @param key 存储键（不同轨各记各的；缺省 = 任务页 ack 轨）
 */
export function loadRailPos(key: string = POS_KEY): RailPos | null {
  try {
    // localStorage 是外部数据边界：解析结果按索引读，逐字段校验后才收窄
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

/**
 * 持久化落点；传 null 清掉（回到 CSS 默认位）。localStorage 不可用时静默跳过。
 * @param key 存储键（与 loadRailPos 成对）
 */
export function saveRailPos(pos: RailPos | null | undefined, key: string = POS_KEY) {
  try {
    if (!pos) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }));
  } catch {
    /* 隐私模式等存不了就算了 */
  }
}
