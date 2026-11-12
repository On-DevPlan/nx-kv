// 文档变更广播（#183）：文档页保存/重命名/删除/补充之后，其它「文档列表」类
// 视图（右侧 refs 面板、查看详情弹窗、本页右轨）要跟着刷新。
//
// 为什么用 window 事件而不是 store：这三处用的是各自的一次性 fetch（数据面分别
// 是 /api/repos/docs、/api/boards/:id、/api/docs/index），没有共享缓存层；
// 事件总线是这里改动面最小、也最贴近「磁盘是权威」的做法。事件名带 nx-kv 前缀，
// 避免与宿主页面的自定义事件撞名。
export const DOCS_CHANGED = 'nx-kv:docs-changed';

/** 广播一次文档变更（保存 / 重命名 / 删除 / 补充之后调用）。 */
export function notifyDocsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DOCS_CHANGED));
}

/** 订阅文档变更，返回退订函数（useEffect 直接用）。 */
export function onDocsChanged(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => fn();
  window.addEventListener(DOCS_CHANGED, handler);
  return () => window.removeEventListener(DOCS_CHANGED, handler);
}
