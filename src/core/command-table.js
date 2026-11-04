// 命令表快照：runtime 装配后写一次，模块只读。
//
// 为什么需要这个格子：`/api/bootstrap` 要给面板下发「每个操作对应的 CLI 命令」，
// 而这张表由 runtime 装配（cli.js / registry.js）。模块直接 import runtime 会成环
// （registry → modules/system → cli → registry），历史写法是用 `await import(...)`
// 绕开：命令能跑，但分层倒了，且 loader 顺序一变就可能拿到半初始化的模块。
//
// 现在方向是单向的：
//   runtime → core（写快照）    modules → core（读快照）
// 谁都不再反过来依赖谁。没有快照时返回空数组——调用方（bootstrap）允许空表降级，
// 面板仍能打开，只是没有 CLI 提示。
let rows = [];

/** 由 runtime 在装配完成时调用。只保留最后一次写入（CLI 的表是注册表的超集）。 */
export function publishCommandTable(list) {
  rows = Array.isArray(list) ? list : [];
}

/** 当前命令表快照（每行 { id, module, command, usage, http, summary }）。 */
export function commandTable() {
  return rows;
}
