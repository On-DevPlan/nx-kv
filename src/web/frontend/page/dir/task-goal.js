// 时间目标（任务级 timegoal 声明）状态与日志查询。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';

export function useGoal({ id, isDraft, topicKey, task, taskRow }) {
  // goalDraft 为 null 表示「还没动过」——此时跟随服务端值（taskRow 可能晚于首轮渲染到）。
  const [goalDraft, setGoalDraft] = useState(null);
  useEffect(() => {
    setGoalDraft(null);
  }, [id]);

  const declaredGoal = taskRow?.timegoal || null;
  const goal = goalDraft || { duration: declaredGoal?.duration || '', prompt: declaredGoal?.prompt || '' };
  // 只有「待领取」能改时间目标声明（已领取在计时、已交付是终态；要改先 reopen）
  const goalEditable = isDraft || (!!taskRow && taskRow.status === 'pending');
  // 任务 #87：**附加要求**支持动态编辑——领取后仍可改（下一轮 check 即生效），
  // 只有已交付 / 已取消这种终态才锁死；时长仍由 goalEditable 把关。
  const goalPromptEditable = isDraft
    || (!!taskRow && taskRow.status !== 'done' && taskRow.status !== 'cancelled'
      && (taskRow.status === 'pending' || !!declaredGoal));

  // 时间目标 check 流水（#74）：已声明目标的任务才可查，逐轮读 goal_checks。
  const canShowGoalLog = !isDraft && !!declaredGoal && task != null;
  const [goalLog, setGoalLog] = useState({ busy: false, error: '', data: null });
  const loadGoalLog = useCallback(() => {
    if (isDraft || !topicKey || task == null) return;
    setGoalLog((s) => ({ ...s, busy: true, error: '' }));
    const q = new URLSearchParams({ id: String(task), key: String(topicKey) });
    api(`/api/localtasks/timegoal-log?${q.toString()}`)
      .then((d) => setGoalLog((s) => ({ ...s, data: d, busy: false })))
      .catch((e) => setGoalLog((s) => ({ ...s, busy: false, error: String(e.message || e) })));
  }, [isDraft, topicKey, task]);
  useEffect(() => {
    if (canShowGoalLog) loadGoalLog();
  }, [canShowGoalLog, loadGoalLog]);

  return {
    goalDraft, setGoalDraft, goal, goalEditable, goalPromptEditable, declaredGoal,
    goalLog, loadGoalLog, canShowGoalLog,
  };
}
