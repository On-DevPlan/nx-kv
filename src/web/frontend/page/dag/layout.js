// 编排画布的布局几何：节点尺寸/间距常量、默认分栏布局、摆位持久化。
export const NODE_W = 280;
export const NODE_GAP_Y = 22;
export const ROW_H = 72 + NODE_GAP_Y; // 一行节点占位高（节点 72 + 行距）
export const PAD_X = 56;
export const PAD_Y = 28;
export const COL_GAP = 320;
export const DRAG_THRESH = 6;
export const FILTER_ALL = '';

/**
 * 默认布局：**按 topic 分块 + 块内分栏换行**（#153）。
 *
 * 旧版是「一列到底」的竖排（列 = topic，列内纵排）——单目录时只有一列，
 * 任务一多就出纵向滚动条，而右边大片空着。现在每块按可视高度算容量，
 * 装不下就换到右边一列，横向铺开把中右区用满。
 *
 * @param {Array<object>} nodes
 * @param {{perCol?:number}} [opts] perCol = 每列最多几个节点
 */
export function defaultLayout(nodes, opts = {}) {
  const perCol = Math.max(3, Number(opts.perCol) || 8);
  // 按 topic 分列，列内按原序纵向
  const byTopic = new Map();
  for (const n of nodes) {
    if (!byTopic.has(n.topicKey)) byTopic.set(n.topicKey, []);
    byTopic.get(n.topicKey).push(n);
  }
  const pos = new Map();
  let col = 0;
  for (const [, list] of byTopic) {
    list.forEach((n, i) => {
      const c = col + Math.floor(i / perCol);
      const r = i % perCol;
      pos.set(n.nodeKey, {
        x: PAD_X + c * COL_GAP,
        y: PAD_Y + r * ROW_H,
      });
    });
    col += Math.ceil(list.length / perCol);
  }
  return pos;
}

/** 节点位置持久化（#153）：拖过的位置记住，重开还原——连线也跟着节点走。 */
const POS_KEY = (scope) => `nx-kv-dag-pos:${scope}`;

/** 读已存位置：{ "topicKey:id": [x, y] } → Map<nodeKey, {x,y}> */
export function loadPos(scope) {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY(scope)) || '{}');
    const out = new Map();
    for (const [k, v] of Object.entries(raw || {})) {
      if (Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1])) out.set(k, { x: v[0], y: v[1] });
    }
    return out;
  } catch {
    return new Map();
  }
}

/** 清掉已存位置（「恢复默认布局」用） */
export function clearPos(scope) {
  try {
    localStorage.removeItem(POS_KEY(scope));
  } catch {
    /* 隐私模式 */
  }
}

/** 写回已存位置（只写有值的节点，键值对 [x,y]） */
export function savePos(scope, pos) {
  try {
    const out = {};
    for (const [k, p] of pos) {
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[k] = [Math.round(p.x), Math.round(p.y)];
    }
    localStorage.setItem(POS_KEY(scope), JSON.stringify(out));
    return true;
  } catch {
    return false;
  }
}
