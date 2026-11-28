// 底部抽屉面板（#79）：附件 / check / 反馈收在这里，编辑区不再被内容块挤占。
import type { ComponentProps, Dispatch, MouseEvent as ReactMouseEvent, ReactNode, Ref, RefObject, SetStateAction } from 'react';
import type { Model } from 'flexlayout-react';
import { Icon } from '../../components/icons.jsx';
import AttachAreaRaw from '../../components/md/attachments/attach-area.jsx';
import type { AttachAreaHandle } from '../../components/md/attachments/attach-area.jsx';
import { docIdOfLocator } from '../../components/md/attachments/attach-common.js';
import { openPanel } from '../../workspace.js';
import type { LocalTask, LocalTopic } from '../../types.js';
import { fmtSec } from './task-utils.js';
import { TaskPluginDockView, useGetTaskPlugins } from './task-plugin-dock.jsx';
import type { AppSlice, ChainApiItem, GoalLogState } from './task-utils.js';

/**
 * AttachArea 的 props 里还没声明 `ref`（组件自己的句柄走 openRef，兄弟文件尚未
 * 收口 React 19 的 ref-as-prop）——按实际契约补一个 ref 位，运行期不变。
 */
const AttachArea = AttachAreaRaw as unknown as (
  props: ComponentProps<typeof AttachAreaRaw> & { ref?: Ref<AttachAreaHandle> },
) => ReactNode;

interface DockPanelProps {
  dockOpen: boolean;
  dockTab: string;
  dockH: number;
  dockRef: RefObject<HTMLDivElement | null>;
  dockMax: boolean;
  showDockTab: (tab: string) => void;
  onDockDragStart: (e: ReactMouseEvent<HTMLDivElement>) => void;
  toggleDockMax: () => void;
  setDockOpen: Dispatch<SetStateAction<boolean>>;
  canShowGoalLog: boolean;
  goalLog: GoalLogState;
  openGoalLog: () => void;
  task: string;
  topic: LocalTopic | null;
  topicKey: string;
  model: Model | null;
  app: AppSlice;
  refreshLocal?: () => Promise<void>;
  attachAreaRef: RefObject<AttachAreaHandle | null>;
  reviewBarRef: RefObject<HTMLDivElement | null>;
  taskRow: LocalTask | null;
  ackHtml: string;
  isChainTip: boolean;
  latestChild: ChainApiItem | null;
  openFeedback: () => void;
  openLatestRound: () => void;
}

export function DockPanel({
  dockOpen, dockTab, dockH, dockRef, dockMax,
  showDockTab, onDockDragStart, toggleDockMax, setDockOpen,
  canShowGoalLog, goalLog, openGoalLog,
  task, topic, topicKey, model, app,
  refreshLocal,
  attachAreaRef, reviewBarRef,
  taskRow, ackHtml,
  isChainTip, latestChild, openFeedback, openLatestRound,
}: DockPanelProps) {
  // gettask 插件区块（第二生命周期点）：声明 → tab；内容由插件组件自己渲染。
  // 任务页落到这里时已有真实实体，插件拿到的一直是稳定的任务号。此处不再有草稿分支。
  const pluginTabs = useGetTaskPlugins({
    enabled: dockOpen && !!String(task || ''),
    taskId: String(task || ''),
    topicKey,
  });
  const pluginTab = dockTab.startsWith('plugin:')
    ? pluginTabs.entries.find((e) => e.segment === dockTab)
    : undefined;
  if (!dockOpen) return null;

  return (
    <div className="mdw-dock" ref={dockRef} style={{ height: `${dockH}px` }}>
      <div
        className="mdw-dock-drag"
        role="separator"
        aria-orientation="horizontal"
        title="上下拖动调整信息面板高度（双击最大化 / 还原）"
        onMouseDown={onDockDragStart}
        onDoubleClick={toggleDockMax}
      />
      {/* 面板头（#79）：左上功能切换 tab，右上两个控制钮（最大化 / 关闭）——照 VSCode 底部面板 */}
      <div className="mdw-dock-head">
        <div className="mdw-dock-tabs" role="tablist" aria-label="信息面板">
          <button
            type="button"
            role="tab"
            aria-selected={dockTab === 'attach'}
            className={`mdw-dock-tab${dockTab === 'attach' ? ' is-on' : ''}`}
            onClick={() => showDockTab('attach')}
          >
            附件
          </button>
          {canShowGoalLog ? (
            <button
              type="button"
              role="tab"
              aria-selected={dockTab === 'check'}
              className={`mdw-dock-tab${dockTab === 'check' ? ' is-on' : ''}`}
              onClick={openGoalLog}
            >
              check
              <span className="mdw-dock-tab-num">{goalLog.data?.count ?? 0}</span>
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            aria-selected={dockTab === 'feedback'}
            className={`mdw-dock-tab${dockTab === 'feedback' ? ' is-on' : ''}`}
            onClick={() => showDockTab('feedback')}
          >
            反馈
          </button>
          {pluginTabs.entries.map((e) => (
            <button
              type="button"
              role="tab"
              key={e.segment}
              aria-selected={dockTab === e.segment}
              className={`mdw-dock-tab${dockTab === e.segment ? ' is-on' : ''}`}
              title={e.description || `${e.pluginName} · ${e.tag}`}
              onClick={() => showDockTab(e.segment)}
            >
              <Icon name={e.icon || 'gear'} title={undefined} />
              {e.ui?.title || e.label}
            </button>
          ))}
        </div>
        <div className="mdw-dock-acts">
          <button
            type="button"
            className="mdw-dock-act"
            onClick={toggleDockMax}
            title={dockMax ? '还原面板高度' : '最大化面板高度'}
            aria-label={dockMax ? '还原面板高度' : '最大化面板高度'}
          >
            {/* icons.tsx 尚未类型化完（title 被推断为必填）：显式传 undefined 与不传等价 */}
            <Icon name={dockMax ? 'collapse' : 'expand'} title={undefined} />
          </button>
          <button
            type="button"
            className="mdw-dock-act"
            onClick={() => setDockOpen(false)}
            title="关闭面板（底部状态栏仍保留入口）"
            aria-label="关闭面板"
          >
            <Icon name="x" title={undefined} />
          </button>
        </div>
      </div>
      <div className="mdw-dock-body">
        {dockTab === 'attach' ? (
          topic ? (
            <AttachArea
              ref={attachAreaRef}
              host="task"
              hostId={Number(task)}
              hostCwd={topic.cwd}
              allow={{ file: true, url: true, folder: true, task: true, ref: true, repo: true }}
              taskOptions={(topic.tasks || []).map((t: LocalTask) => ({ id: t.id, text: t.text, status: t.status }))}
              onChanged={refreshLocal}
              onOpenTask={(hit: { key?: string; seq?: number | null }) => {
                if (!app.openPage || !hit || hit.seq == null) return;
                app.openPage({
                  dirKey: hit.key || topicKey,
                  task: String(hit.seq),
                  name: `#${hit.seq}`,
                });
              }}
              onOpenDoc={(locator: string) => {
                const docId = docIdOfLocator(locator);
                if (!model || !docId) return;
                openPanel(model, {
                  component: 'doc',
                  name: locator.split('/').pop() || locator,
                  config: { docId },
                  location: 'center',
                });
              }}
            />
          ) : (
            <div className="mdw-dock-empty">没有可挂载附件的上下文。</div>
          )
        ) : null}

        {dockTab === 'check' ? (
          <div className="mdw-dock-check">
            {goalLog.busy && !goalLog.data ? <div className="mdw-dock-empty">读取中…</div> : null}
            {goalLog.error ? <div className="mdw-dock-empty">读取失败：{goalLog.error}</div> : null}
            {goalLog.data ? (
              <>
                <div className="mdw-dock-meta mono">
                  {`时间目标 ${goalLog.data.duration || '—'}`}
                  {goalLog.data.startedAt ? ` · 开始 ${goalLog.data.startedAt}` : ''}
                  {goalLog.data.deadline ? ` · 截止 ${goalLog.data.deadline}` : ' · 尚未开始计时'}
                  {goalLog.data.archived ? ' · 已归档' : ''}
                  {` · ${goalLog.data.count || 0} 轮`}
                </div>
                {(goalLog.data.count || 0) > 0 ? (
                  <div className="mdw-goal-log">
                    {goalLog.data.entries.map((e, i) => (
                      <div key={`${e.checkedAt}-${i}`} className="mdw-goal-log-row">
                        <div className="mdw-goal-log-head mono">
                          R{i + 1} · {e.checkedAt} · {e.reached ? '已到点' : '未到点'} · 已用{' '}
                          {fmtSec(e.elapsedSec)} · 剩余 {fmtSec(e.remainingSec)}
                        </div>
                        {e.summary ? <div className="mdw-goal-log-body">{e.summary}</div> : null}
                        {e.progress ? <div className="mdw-goal-log-prog">{e.progress}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mdw-dock-empty">还没有 check 记录——任务领取后每轮 check 会出现在这里。</div>
                )}
              </>
            ) : null}
          </div>
        ) : null}

        {dockTab.startsWith('plugin:') ? (
          pluginTab ? (
            <TaskPluginDockView
              entry={pluginTab}
              taskId={String(task || '')}
              topicKey={topicKey}
              topic={topic}
              taskRow={taskRow}
              app={app}
            />
          ) : (
            <div className="mdw-dock-empty">
              {pluginTabs.loading
                ? '读取插件区块…'
                : pluginTabs.error
                  ? `插件区块读取失败：${pluginTabs.error}`
                  : '这个插件区块当前不可用（插件未启用或已卸载）。'}
            </div>
          )
        ) : null}

        {dockTab === 'feedback' ? (
          taskRow?.completedAt ? (
            <div className="mdw-review" ref={reviewBarRef}>
              <div className="mdw-review-main">
                <span className="mdw-review-badge">已完成 · 等待验收</span>
                <span className="mdw-review-at mono">{taskRow.completedAt}</span>
                {taskRow.roundSummary ? (
                  <>
                    {/* #283 验收：去掉展开/收起——全文常驻显示（超高时块内滚动，无按钮） */}
                    <div
                      className="mdw-review-sum"
                      title="agent 的完成总结（ack）"
                      dangerouslySetInnerHTML={{ __html: ackHtml }}
                    />
                  </>
                ) : null}
              </div>
              <div className="mdw-review-acts">
                {/* #245：每个任务节点都支持反馈——在旧轮次上反馈不再是「分叉错误」，
                    而是任务链树的正常分叉（链的真相是树，taskChain.tree）。 */}
                <button type="button" className="ghost" onClick={openFeedback} title="新开一条任务携带反馈（原任务不动；链在此分叉成树）">
                  反馈
                </button>
                {(!isChainTip && latestChild) ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={openLatestRound}
                    title={`这条任务已有后续轮次——去最新一轮 #${latestChild.id}（反馈也可以留在这里，会从本节点分叉）`}
                  >
                    去最新一轮 #{latestChild.id}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mdw-dock-empty">任务完成后，agent 的完成总结会显示在这里。</div>
          )
        ) : null}
      </div>
    </div>
  );
}
