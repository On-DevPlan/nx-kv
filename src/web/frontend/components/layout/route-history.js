// 路由历史（会话内）——「← 返回」按**来处**返回用。
//
// 为什么不用固定父级：从项目组点任务，任务住在 dir 队列里，详情页必然落在 dir
// 作用域；用户预期「返回」是回组，而不是掉进目录。固定父级做不到，记一份历史即可。
// 栈在模块级（会话内共享），超过 30 条丢最旧的。
const stack = [];

/** 记录一次路由变化（同一个 hash 不重复入栈） */
export function pushRoute(hash) {
  if (!hash) return;
  if (stack[stack.length - 1] !== hash) stack.push(hash);
  if (stack.length > 30) stack.shift();
}

/** 弹出一层，返回上一处 hash（没有则空串） */
export function popRoute() {
  if (stack.length > 1) {
    stack.pop();
    return stack[stack.length - 1];
  }
  return '';
}

/** 当前栈深（调试用） */
export function routeDepth() {
  return stack.length;
}
