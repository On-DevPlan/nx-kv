// 本地任务（localtask）service —— 按「工作目录（cwd）」划分的主题（topic）+ 主题任务队列 +
// 领取（含阻塞等待子功能）+ 内嵌弹窗。
//
// 解决的问题：agent 在一个对话里需要用户继续给任务时，不必结束本轮、等用户去
// 原始输入框打字，而是把 `nx-kv localtask wait --cwd "<工作目录>" --summary "<当前现状>"`
// 当作 **本轮最后一个动作**调用——命令阻塞、自动打开浏览器弹窗；用户在弹窗/面板回填，
// 命令解除阻塞、把新任务作为结果返回给 agent，agent 接着干。
//
// 关键设计：
//   1. **工作目录即主题，主题拥有队列。** wait 传入工作目录（默认进程 cwd），归一化后
//      作为主题 key；同一目录的多次 wait（即便现状措辞不同）共用同一个任务队列，
//      不同目录 → 不同主题 → 队列互不串。任务可在一个主题队列里逐条堆积，agent 按序领取。
//   2. **全局主题兜底（工作窃取）。** 除按目录划分的本地队列外，还有一个跨目录共享的
//      「全局主题」（key '__GLOBAL__'）：本地队列取不到 pending 时，任何 wait 都自动去
//      全局领（显式传 --cwd 也不例外）；全局也没有才阻塞。任务用 addTask({global:true})
//      （CLI --global）发布进池子，谁闲谁领——类似 Go 调度器的 local runq + global runq。
//   3. **现状总结只作状态展示。** --summary 是 agent 当前状态（人读），每次 wait 刷新，
//      不再参与队列分桶；用户据此一眼看清 agent 做到哪、卡在哪。
//   4. **纯本地协调，不依赖 KV 后端登录态。** 数据落本机文件，弹窗由本进程临时起的
//      http 服务器直出，未登录也能用。
//   5. **排队语义。** 用户可提前回填：主题已有 pending 时 wait 立即取走、不开窗；
//      没有 pending 才开窗阻塞。
//   6. **超时是业务结果不是错误。** 默认阻塞 3 分钟（页面可调，上限 10 分钟）；超时返回 {status:'timeout'}、
//      exit 0，agent 据此安静收尾结束本轮，绝不抛异常。
//
// 跨进程：弹窗与 wait 同进程时靠内存 waiter 即时唤醒；任务由别的进程写入（如常驻
// serve 的面板页）时，wait 用轮询兜底（见 POLL_MS）。
// ─── 拆分说明（任务 #54）───────────────────────────────────────
// 本文件曾是 2400+ 行的 god-file，已按分节拆成本目录的兄弟文件；这里只做
// **门面再导出**——对外 API 路径（'./service.js' 静态引用与动态 import）全部
// 不变；模块内部依赖方向（单向无环）见各文件头注释。
export * from './task-templates.js';
export * from './paths.js';
export * from './store-io.js';
// 存储仓储（T03）：reset 仅测试用（清空库）；repo 是窄方法的命名空间聚合。
export { resetLocaltaskStore, closeDb, default as repo } from './repo/index.js';

/**
 * 只读快照：把库投成旧 JSON store 的形状（{ version, settings, topics: {key: topic} }）。
 * 仅供测试与只读消费者（attribution/revision-bump 的对账读）使用 ——
 * **没有 saveStore**：写路径必须走 repo 窄方法，「读全表→改→整表重写」被禁止。
 */
export async function loadStore(): Promise<Record<string, any>> {
  const repo = await import('./repo/index.js');
  repo.openLocaltaskStore();
  const map: Record<string, any> = {};
  for (const t of repo.topics.listTopics()) map[t.key] = t;
  return { version: 4, settings: repo.settings.getLtSettings(), topics: map };
}
export * from './repo-ctx.js';
export * from './task-view.js';
export * from './waiters.js';
export * from './waiting.js';
export * from './deletion.js';
export * from './task-lifecycle.js';
export * from './topics.js';
export * from './task-ops.js';
export * from './task-remove.js';
export * from './move-prims.js';
export * from './remote-import.js';
export * from './panel-presence.js';
export * from './events.js';
