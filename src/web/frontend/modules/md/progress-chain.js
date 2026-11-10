// 进程面板的任务链折叠（#172）：反馈任务链动辄几十轮，进程面板不再把它们**累计**
// 摊开——只留**链尖**（最新一轮），旧轮次去任务页的「更多 → 任务链」里看。
//
// 判据用后端的 childRoundCount（reopen 边数）：>0 = 这件活儿已经在下一轮继续，
// 本条就是旧轮次。comment / feedback 边是**旁支新活**（评论派生 / 反馈里提的新需求），
// 不算「被取代」——父任务照旧该显示。
//
// 纯函数、无 DOM、无 IO，可单测（与 progress-search.js 同层）。

/** 这条任务是不是链尖（最新一轮，没有后续轮次）。 */
export function isChainTip(task) {
  return !(Number(task && task.childRoundCount) || 0);
}

/**
 * 按「链尖 / 旧轮次」切分一批任务。
 * @param {Array<object>} tasks 任务列表（视图形状）
 * @returns {{tips: Array<object>, folded: Array<object>}} 顺序保持原样
 */
export function splitChainTips(tasks) {
  const tips = [];
  const folded = [];
  for (const t of tasks || []) {
    (isChainTip(t) ? tips : folded).push(t);
  }
  return { tips, folded };
}

export default isChainTip;
