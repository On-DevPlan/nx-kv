// 跨模块桥（动态 import）：docs 需要 repos 的 store 事务与 key 派生，
// 但模块之间不得静态互依（eslint 分层规则，见 eslint.config.js）。
//
// 与 localtask→timegoal 同一模式：按需加载、memoized、不给启动路径加负担。
// 纯字符串口径（normalizeKey / localKeyOf）已下沉 core/keys.js，走静态引入。
type ReposService = typeof import('../repos/service.js');

let bridge: ReposService | null = null;

export async function reposBridge(): Promise<ReposService> {
  if (!bridge) bridge = await import('../repos/service.js');
  return bridge;
}
