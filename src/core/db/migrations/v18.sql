-- v18（#200 续）：修复「活任务挂在软删队列上」的存量幽灵队列。
--
-- 背景：历史版本里 prune（旧模型分支）/ 直接删除曾把带待领任务的队列软删
-- （tasks 保留），任务变成「任何 cwd 都领不到」的幽灵。#197 起队列必须绑
-- 真实仓库、任务必须可寻址——这类存量与口径冲突。
--
-- 处理口径：**恢复队列，不删任务**（数据最安全——任务内容自包含，目录虽然
-- 可能已不存在，agent 仍可按 cwd 显式领取；UI 的 cwdExists=false 幽灵标志
-- 本来就有，用户可以自行决定清掉或留着）。
--   · 待领（status='pending'）→ 必须恢复：这是没跑完的活。
--   · done / cancelled → 不动：已完成的任务挂在死队列里只是历史记录，恢复
--     反而让幽灵队列重新出现在侧栏。
-- @decision docs/decisions/versions/2026-11-25-v18.md
UPDATE topics
   SET deleted_at = NULL,
       updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
 WHERE deleted_at IS NOT NULL
   AND cwd <> ''   -- 组队列（cwd 空）不恢复：组任务走 group_topic_id 关联寻址，不依赖目录队列可见性
   AND EXISTS (
     SELECT 1 FROM tasks
      WHERE tasks.repo_topic_id = topics.id
        AND tasks.deleted_at IS NULL
        AND tasks.status = 'pending'
   );
