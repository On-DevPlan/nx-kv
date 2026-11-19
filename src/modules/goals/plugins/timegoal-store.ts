// timegoal 模块 service 门面——固化"持续运行 N 小时"任务的时间运算与全局提示词回显。
//
// 设计要点（与 localtask 严格分离）：
//   1. **存储进库（T06）**，两套作用域两个落点：
//      · **任务级** goal（`localtask add --duration` → 领取起算）→ `goals` +
//        `goal_checks` 表（task_id 外键；删任务连 goal 与流水级联消失）。
//        实现：timegoal-task-store.js（仓储叶子在 localtask/repo/goals.js）。
//      · **队列级** goal（`timegoal set --cwd`）→ `settings` 表 `tg.cwd.<topicKey>`
//        一键一目标（value 是 JSON：目标字段 + checks 流水）。队列是容器、没有
//        可挂的 task_id（goals.task_id NOT NULL 是 schema 定稿），而 goal 恰是
//        「按键取值、不做关系查询」的运行时状态 —— settings 表的硬规则
//        （WHERE 里的东西不进 settings）对它恰好不构成约束。
//        实现：timegoal-cwd-store.js。
//   2. **每 cwd 一对一**：topicKeyOf(完整 cwd) 派生，set 时已有则覆盖并标 replaced。
//   3. **不可变 prompt**：set 写进库之后，prompt 字段变成只读事实。
//      后续 `check` 永远从库原文回显，不让 agent 改 prompt 或从对话历史里
//      重新拼接——这是"避免偏移"的物理保证。
//   4. **纯函数时间运算**：`evalTimegoal(goal, nowMs)` 不读时钟，单测钉各种边界
//      （到点前/临门/到点整/过线）；`checkTimegoal` 调它前才 `Date.now()`。
//      实现：timegoal-core-store.js（常量 / 时长解析 / 时间戳 / eval）。
//   5. **check 流水只增不改**：elapsed / remaining / overtime 存**当日快照**
//      （deadline 会被延期，查时重算会把历史改写）。行级追加没有
//      logTruncated 的概念（那是 JSON 整份重写时代的产物）——总量用 count。
//
// 模块边界：
//   - 本族只 import core（db / errors / topic-key）与 localtask/repo/goals.js
//     （叶子仓储，不构成环）；localtask 反向引用本模块的出口在 taskgoal.js。
//   - 与 localtask wait 互不感知：timegoal 不阻塞、不依赖面板是否存在，
//     agent 按 `reached` 自行决定下一轮动作。
//
// 本文件是**对外入口**：实现按职责拆进同目录三个 *-store 文件，这里 re-export
// 全集（import 路径不变），只保留横跨两套作用域的 pruneExpired。
import { tx } from '../../../core/db/index.js';
import { deleteSettingRaw, listSettingsByPrefix } from '../../../core/db/settings.js';
import { nowMs } from '../../../core/db/time.js';
import { db as ltDb } from '../../localtask/repo/open.js';
import * as goalsRepo from '../../localtask/repo/goals.js';
import { evalTimegoal } from './timegoal-core-store.js';
import { CWD_GOAL_PREFIX, blobToGoalView } from './timegoal-cwd-store.js';
import { goalRowToGoal, goalRowToView } from './timegoal-task-store.js';

export * from './timegoal-core-store.js';
export * from './timegoal-cwd-store.js';
export * from './timegoal-task-store.js';

/**
 * 彻底删除已到点 / 已归档的时间目标（硬删，不是归档）。
 *
 * 用途：面板「彻底清除」按钮 / 手动清理。**只删到点的或已归档的**——还在跑的不动。
 * 注意：正常的"到点回收"是**自动归档**，不需要人来点这个；
 * 保留期过后系统会自动丢掉旧日志（提示词仍留着）；本命令用于把整个目标连提示词一起清掉。
 *
 * @returns removed 是删除前的快照（供 UI 汇报）
 */
export async function pruneExpired(): Promise<{ count: number; removed: any[] }> {
  const at = nowMs();
  const removed: any[] = [];
  return tx(
    (conn) => {
      for (const { key, value } of listSettingsByPrefix(conn, CWD_GOAL_PREFIX)) {
        if (!value || typeof value !== 'object') continue;
        const view = blobToGoalView(value) as any;
        if (view.archived || evalTimegoal(view, at).reached) {
          removed.push(view);
          deleteSettingRaw(conn, key);
        }
      }
      // 任务级：到点/已归档的 goals 一并回收（与队列级同一条「彻底清除」语义）
      for (const row of goalsRepo.listGoalRows(conn)) {
        const goal = goalRowToGoal(row);
        const archived = String(row.state || '') === 'archived';
        if (archived || evalTimegoal(goal, at).reached) {
          removed.push(goalRowToView(row));
          goalsRepo.purgeGoal(conn, Number(row.id));
        }
      }
      return { count: removed.length, removed };
    },
    { db: ltDb(), mode: 'IMMEDIATE' }
  );
}
