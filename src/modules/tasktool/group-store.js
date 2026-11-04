// tasktool/group-store.js —— 仓库/看板登记的**归一化视图**（board + repos）。
//
// 派任务（add.js）与改任务（update.js）共用一份落点判定：`--project/--board` 要
// 解析成「项目登记的路径」才能定落点，而 repos 模块在**模块互依禁列**里
//（localtask/tasktool 不能静态引它）→ 动态 import（add.js 既有惯例）。
//
// 输入是 raw repos store，输出喂给 board-target.js 的 resolveGroupTarget：
//   boards[i] = { id, name, key, memberKeys: string[] }   ← 成员键（不是 repoIds）
//   repos[i]  = { key, name, path }
let reposMod = null;
async function reposStore() {
  if (!reposMod) reposMod = await import('../repos/service.js');
  return reposMod;
}

/** raw store → 归一化形状（看板成员是 repoKeys、仓库 key 是派生的——归一后喂纯解析器） */
export async function normalizedGroupStore() {
  const repos = await reposStore();
  const store = await repos.loadStore();
  const boards = (store.boards || []).map((b) => ({
    ...b,
    memberKeys: repos.boardRepoKeys(b, store),
  }));
  return {
    boards,
    repos: (store.repos || []).map((r) => ({ ...r, key: r.key || repos.deriveKey(r) })),
  };
}
