// （#54 自 service.js 拆出）仓库上下文（repos 模块登记的只读投影）。
// 动态 import + 失败即 null——别的模块没装仓库登记也绝不拖垮本地任务。
// ─── 仓库上下文（repos 模块的本地登记）───────────────────────────────
//
// 仓库登记住在**另一个模块的另一个 store**（~/.nx-kv/repos.json）。
// 这里只读它来补上下文，**不让本地任务的核心依赖它**：
//   - 动态 import：不在启动路径上，别的模块没装仓库登记也不影响本地任务；
//   - 失败即"没有上下文"：仓库登记坏了绝不能把本地任务带崩。
let reposMod = null;
export async function repoContextIndex() {
  try {
    if (!reposMod) reposMod = await import('../repos/service.js');
    return { mod: reposMod, map: await reposMod.contextMap() };
  } catch {
    return null;
  }
}

// 按目录路径取仓库上下文（取不到就是 null —— 没登记过的目录很正常）
export function repoCtxOf(index, cwd) {
  if (!index || !index.map || !cwd) return null;
  return index.map.get(index.mod.normalizePathKey(cwd)) || null;
}
