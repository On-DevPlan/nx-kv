// 组合 localtask 主题与独立 timegoal 的显示模型。
//
// 只为视图准备一行一个目录；存储仍各自独立。保留 localtask 的原有顺序（全局池
// 永远最前）；只有 timegoal 的目录按 goal 的接口顺序追加，且同一 key 只出现一次。
export function mergeDirectoryRows(topics = [], goals = []) {
  const rows = [];
  const byKey = new Map();

  for (const topic of topics) {
    const goal = goals.find((item) => item.key === topic.key) || null;
    const row = {
      key: topic.key,
      cwd: topic.cwd || goal?.cwd || '',
      name: topic.name || goal?.name || topic.cwd || goal?.cwd || '（未命名）',
      topic,
      goal,
      isGlobal: !!topic.isGlobal,
    };
    rows.push(row);
    byKey.set(row.key, row);
  }

  for (const goal of goals) {
    if (byKey.has(goal.key)) {
      byKey.get(goal.key).goal = goal;
      continue;
    }
    const row = {
      key: goal.key,
      cwd: goal.cwd || '',
      name: goal.name || goal.cwd || '（未命名）',
      topic: null,
      goal,
      isGlobal: false,
    };
    rows.push(row);
    byKey.set(row.key, row);
  }

  // 注册表的 topics 顺序本来就把全局主题置顶；保留该约定，同时为直接调用的
  // 使用方兜底（例如单测或以后复用 board selector 的其它视图）。
  rows.sort((a, b) => Number(b.isGlobal) - Number(a.isGlobal));
  return rows;
}
