// shared/graph —— 有向图可达性纯函数（Node 与浏览器两端共用；零依赖）。
//
// 环检测的唯一实现：加边 u→v 成环 ⟺ v ⇝ u（沿 next 给出的方向）。
// 三个历史拷贝（mutator/validate、面板 page/dag、目录 dag-editor）全部改走这里——
// dag-editor 曾因方向写反漏判 2 节点环（见其注释），这正是「一份实现」的证据。
// 方向由调用方的 next 决定：传后继函数即正向，传 blockBy 解析即依赖方向，
// 本函数不关心语义。

/** 邻接函数：给定节点返回其后继集合（方向由调用方定）。 */
export type NextFn = (node: string | number) => Iterable<string | number>;

/**
 * 从 start 出发沿 next 可达 target（含 start===target 的平凡情形）。
 */
export function reaches(next: NextFn, start: string | number, target: string | number): boolean {
  const stack: (string | number)[] = [start];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === undefined) continue;
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
 * 与 mutator.addEdge 的口径一致；mutator/validate 的 wouldCreateCycle 是它的快照特化。
 */
export function wouldCycleAfterLink(next: NextFn, from: string | number, to: string | number): boolean {
  return reaches(next, to, from);
}
