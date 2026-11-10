// 时间目标 UI（#78）：设置收进「更多」菜单，外部只以勋章回显。
export function goalSection({ goal, setGoalDraft, goalEditable, declaredGoal, openGoalLog, markDirty, task }) {
  const goalDur = (goal.duration || '').trim();
  const goalPrompt = (goal.prompt || '').trim();
  const goalBadge = (goalDur || goalPrompt)
    ? {
      label: `⏱ ${goalDur || '目标'}`,
      title: goalPrompt
        || (goalEditable ? '任务级时间目标（在「更多」里设置；领取即计时）' : '已领取计时，声明不可改'),
    }
    : null;
  const goalMenu = (goalEditable || declaredGoal) ? (
    <div className="mdw-goal-menu">
      <div className="mdw-goal-menu-lab">时间目标</div>
      {goalEditable ? (
        <>
          <input
            className="mdw-goal-dur mono"
            value={goal.duration}
            placeholder="2h / 90m / 30分钟，留空不带"
            onChange={(e) => {
              setGoalDraft({ ...goal, duration: e.target.value });
              markDirty();
            }}
          />
          <input
            className="mdw-goal-prompt"
            value={goal.prompt}
            placeholder="附加要求（可选，随 check 指令一起固化）"
            onChange={(e) => {
              setGoalDraft({ ...goal, prompt: e.target.value });
              markDirty();
            }}
          />
        </>
      ) : (
        <span className="mdw-goal-ro mono" title={declaredGoal?.prompt || '已领取计时，声明不可改'}>
          {declaredGoal?.duration || '—'} · 已领取计时
        </span>
      )}
      {declaredGoal && task != null ? (
        <button type="button" className="ghost" onClick={openGoalLog} title="查看时间目标的每轮 check 记录">
          查看每轮 check 日志
        </button>
      ) : null}
    </div>
  ) : null;

  return { goalBadge, goalMenu };
}
