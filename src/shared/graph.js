// shared/graph.js —— 有向图可达性纯函数（Node 与浏览器两端共用；零依赖）。
//
// 环检测的唯一实现：加边 u→v 成环 ⟺ v ⇝ u（沿 next 给出的方向）。
// 三个历史拷贝（mutator/validate.js、面板 page/dag、目录 dag-editor）全部改走这里——
// dag-editor 曾因方向写反漏判 2 节点环（见其注释），这正是「一份实现」的证据。
// 方向由调用方的 next 决定：传后继函数即正向，传 blockBy 解析即依赖方向，
// 本函数不关心语义。

/**
 * 从 start 出发沿 next 可达 target（含 start===target 的平凡情形）。
 * @param {(node: string|number) => Iterable<string|number>} next 邻接函数（方向由调用方定）
 * @param {string|number} start
 * @param {string|number} target
 * @returns {boolean}
 */
export function reaches(next, start, target) {
  const stack = [start];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === target) return true;
    const key = String(cur);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const n of next(cur) || []) stack.push(n);
  }
  return false;
}

/**
 * 「加上 u→v 这条边会不会成环」⟺ v ⇝ u（沿 next 正向）。
 * 与 mutator.addEdge 的口径一致；mutator/validate.js 的 wouldCreateCycle 是它的快照特化。
 * @param {(node: string|number) => Iterable<string|number>} next 正向后继函数
 * @param {string|number} from 新边的起点 u
 * @param {string|number} to 新边的终点 v
 * @returns {boolean}
 */
export function wouldCycleAfterLink(next, from, to) {
  return reaches(next, to, from);
}
