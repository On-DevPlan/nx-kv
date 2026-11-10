// 底部状态栏（#79）：VSCode 风细条，左信息 / 右状态；窄了先省略中间。
import { Icon } from '../../components/icons.jsx';
import StatusTag from '../../components/status-tag/index.jsx';

export function StatusBar({
  dockOpen, dockTab, showDockTab, setDockOpen,
  canShowGoalLog, goalLog, openGoalLog,
  isDraft, taskRow,
}) {
  return (
    <div className="mdw-sbar">
      <button
        type="button"
        className={`mdw-sbar-item${dockOpen && dockTab === 'attach' ? ' is-on' : ''}`}
        onClick={() => showDockTab('attach')}
        title="附件（点击展开信息面板）"
      >
        <Icon name="list" />
        <span className="mdw-sbar-lab">附件</span>
      </button>
      {canShowGoalLog ? (
        <button
          type="button"
          className={`mdw-sbar-item${dockOpen && dockTab === 'check' ? ' is-on' : ''}`}
          onClick={openGoalLog}
          title="时间目标每轮 check（点击展开信息面板）"
        >
          <Icon name="clock" />
          <span className="mdw-sbar-lab">check</span>
          <span className="mdw-sbar-num">{goalLog.data?.count ?? 0}</span>
        </button>
      ) : null}
      <button
        type="button"
        className={`mdw-sbar-item${dockOpen && dockTab === 'feedback' ? ' is-on' : ''}`}
        onClick={() => showDockTab('feedback')}
        title="完成总结 / 反馈（点击展开信息面板）"
      >
        <Icon name="edit" />
        <span className="mdw-sbar-lab">反馈</span>
      </button>
      <span className="mdw-sbar-grow" />
      {!isDraft && taskRow ? (
        <span className="mdw-sbar-stat" title="任务状态">
          {/* #121 统一组件：蓝=进行中、绿=已完成、浅灰=待领取、灰虚线=收口 */}
          <StatusTag t={taskRow} />
        </span>
      ) : null}
      <button
        type="button"
        className={`mdw-sbar-chev${dockOpen ? ' is-open' : ''}`}
        onClick={() => setDockOpen((v) => !v)}
        title={dockOpen ? '收起信息面板' : '展开信息面板'}
        aria-expanded={dockOpen}
        aria-label={dockOpen ? '收起信息面板' : '展开信息面板'}
      >
        <Icon name="chevron" />
      </button>
    </div>
  );
}
