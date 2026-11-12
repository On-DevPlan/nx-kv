// 底部状态栏（#79）：VSCode 风细条，左信息 / 右状态；窄了先省略中间。
import type { Dispatch, SetStateAction } from 'react';
import { Icon } from '../../components/icons.jsx';
import StatusTag from '../../components/status-tag/index.jsx';
import type { LocalTask } from '../../types.js';
import type { GoalLogState } from './task-utils.js';

interface StatusBarProps {
  dockOpen: boolean;
  dockTab: string;
  showDockTab: (tab: string) => void;
  setDockOpen: Dispatch<SetStateAction<boolean>>;
  canShowGoalLog: boolean;
  goalLog: GoalLogState;
  openGoalLog: () => void;
  isDraft: boolean;
  taskRow: LocalTask | null;
  /** 当前任务挂载的 kind='mdfile' 数量（状态栏入口） */
  mdCount?: number;
}

export function StatusBar({
  dockOpen, dockTab, showDockTab, setDockOpen,
  canShowGoalLog, goalLog, openGoalLog,
  isDraft, taskRow, mdCount = 0,
}: StatusBarProps) {
  return (
    <div className="mdw-sbar">
      <button
        type="button"
        className={`mdw-sbar-item${dockOpen && dockTab === 'attach' ? ' is-on' : ''}`}
        onClick={() => showDockTab('attach')}
        title="附件（点击展开信息面板）"
      >
        {/* icons.tsx 尚未类型化完（title 被推断为必填）：显式传 undefined 与不传等价 */}
        <Icon name="list" title={undefined} />
        <span className="mdw-sbar-lab">附件</span>
      </button>
      <button
        type="button"
        className={`mdw-sbar-item${dockOpen && dockTab === 'md' ? ' is-on' : ''}`}
        onClick={() => showDockTab('md')}
        title="md 附件预览（点击展开信息面板）"
      >
        <Icon name="overview" title={undefined} />
        <span className="mdw-sbar-lab">md</span>
        {/* 没有 md 附件时不显示数字：避免空态出现「md 0」这种噪声 */}
        {mdCount > 0 ? <span className="mdw-sbar-num">{mdCount}</span> : null}
      </button>
      {canShowGoalLog ? (
        <button
          type="button"
          className={`mdw-sbar-item${dockOpen && dockTab === 'check' ? ' is-on' : ''}`}
          onClick={openGoalLog}
          title="时间目标每轮 check（点击展开信息面板）"
        >
          <Icon name="clock" title={undefined} />
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
        <Icon name="edit" title={undefined} />
        <span className="mdw-sbar-lab">反馈</span>
      </button>
      <span className="mdw-sbar-grow" />
      {!isDraft && taskRow ? (
        <span className="mdw-sbar-stat" title="任务状态">
          {/* #121 统一组件：蓝=进行中、绿=已完成、浅灰=待领取、灰虚线=收口 */}
          <StatusTag t={taskRow} title={undefined} />
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
        <Icon name="chevron" title={undefined} />
      </button>
    </div>
  );
}
