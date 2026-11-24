// 仓库/组的**编排后收口**（#199）：编排动作（登记 / 改路径 / 建组 / 成员变更 / 删组）
// 执行成功后，补齐仓库与组各自的队列 topic。
//
// 为什么收在这一个文件：repos→localtask 是模块域间依赖，分层棘轮按文件数计数——
// 跨域通知只许从这一个文件过，新增编排动作必须复用 orchestrateQuiet()，
// 不许各自 `import('../localtask/service.js')`。
//
// 口径：队列是编排的**配套资源**，补建失败绝不拦主操作（syncQueuesQuiet 内部吞错）。
// 「仓库管理」页的「刷新队列」按钮是同一份逻辑的手动出口，兜历史数据缺口。

/** 编排完成后自动刷新队列（幂等只补不删；失败不拦主操作）。 */
export function orchestrateQuiet(): Promise<{ repos: number; groups: number }> {
  return import('../localtask/service.js').then(
    (lt: any) => lt.syncQueuesQuiet(),
    () => ({ repos: 0, groups: 0 }),
  );
}
