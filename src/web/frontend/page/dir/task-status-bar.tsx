// 底部状态栏（#79）：VSCode 风细条，左信息 / 右状态；窄了先省略中间。
import type { Dispatch, SetStateAction } from 'react';
import { Icon } from '../../components/icons.jsx';
import StatusTag from '../../components/status-tag/index.jsx';
import type { LocalTask } from '../../types.js';
import type { GoalLogState } from './task-utils.js';
import { useGetTaskPlugins } from './task-plugin-dock.jsx';

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
  /** 任务键（库存任务号或草稿键），用于取插件 gettask 区块 tab。 */
  task: string;
  topicKey: string;
}

export function StatusBar({
  dockOpen, dockTab, showDockTab, setDockOpen,
  canShowGoalLog, goalLog, openGoalLog,
  isDraft, taskRow, task, topicKey,
}: StatusBarProps) {
  // 与 DockPanel 同源：插件注册的 gettask 区块也进底部常驻状态栏。
  const pluginTabs = useGetTaskPlugins({ enabled: !!String(task || ''), taskId: String(task || ''), topicKey });
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
      {pluginTabs.entries.map((entry) => (
        <button
          type="button"
          key={entry.segment}
          className={`mdw-sbar-item${dockOpen && dockTab === entry.segment ? ' is-on' : ''}`}
          onClick={() => showDockTab(entry.segment)}
          title={entry.description || `${entry.pluginName} · ${entry.tag}`}
        >
          <Icon name={entry.icon || 'gear'} title={undefined} />
          <span className="mdw-sbar-lab">{entry.ui?.title || entry.label}</span>
        </button>
      ))}
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
