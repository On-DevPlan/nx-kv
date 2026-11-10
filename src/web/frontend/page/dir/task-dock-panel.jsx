// 底部抽屉面板（#79）：附件 / check / 反馈收在这里，编辑区不再被内容块挤占。
import { Icon } from '../../components/icons.jsx';
import AttachBar from '../../components/md/attach-bar.jsx';
import AttachArea from '../../components/md/attach-area.jsx';
import { docIdOfLocator } from '../../components/md/attach-common.js';
import { openPanel } from '../../workspace.js';
import { GLOBAL_KEY } from '../../modules/board/board-view.js';
import { fmtSec } from './task-utils.js';

export function DockPanel({
  dockOpen, dockTab, dockH, dockRef, dockMax,
  showDockTab, onDockDragStart, toggleDockMax, setDockOpen,
  canShowGoalLog, goalLog, openGoalLog,
  isDraft, task, topic, topicKey, isGlobal, doc, id, model, app,
  refreshLocal, markDirty, saveDoc, persistAtt,
  attachAreaRef, reviewBarRef, reviewSumRef,
  taskRow, ackOpen, setAckOpen, ackOverflow, ackLong, ackHtml,
  isChainTip, latestChild, openFeedback, openLatestRound,
}) {
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
        </div>
        <div className="mdw-dock-acts">
          <button
            type="button"
            className="mdw-dock-act"
            onClick={toggleDockMax}
            title={dockMax ? '还原面板高度' : '最大化面板高度'}
            aria-label={dockMax ? '还原面板高度' : '最大化面板高度'}
          >
            <Icon name={dockMax ? 'collapse' : 'expand'} />
          </button>
          <button
            type="button"
            className="mdw-dock-act"
            onClick={() => setDockOpen(false)}
            title="关闭面板（底部状态栏仍保留入口）"
            aria-label="关闭面板"
          >
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div className="mdw-dock-body">
        {dockTab === 'attach' ? (
          isDraft ? (
            <AttachBar
              attachments={doc.attachments}
              onRemove={(aid) => {
                const next = (doc.attachments || []).filter((x) => x.id !== aid);
                markDirty();
                saveDoc(id, { attachments: next });
                if (!isDraft) persistAtt(task, next);
              }}
            />
          ) : topic ? (
            <AttachArea
              ref={attachAreaRef}
              host="task"
              hostId={Number(task)}
              hostKey={isGlobal ? GLOBAL_KEY : undefined}
              hostCwd={isGlobal ? undefined : topic.cwd}
              allow={{ file: true, url: true, task: true, ref: true }}
              taskOptions={(topic.tasks || []).map((t) => ({ id: t.id, text: t.text, status: t.status }))}
              onChanged={refreshLocal}
              onOpenTask={(hit) => {
                if (!app.openPage || !hit || hit.seq == null) return;
                app.openPage({
                  dirKey: hit.key || topicKey,
                  task: String(hit.seq),
                  name: `#${hit.seq}`,
                });
              }}
              onOpenDoc={(locator) => {
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

        {dockTab === 'feedback' ? (
          !isDraft && taskRow?.completedAt ? (
            <div className="mdw-review" ref={reviewBarRef}>
              <div className="mdw-review-main">
                <span className="mdw-review-badge">已完成 · 等待验收</span>
                <span className="mdw-review-at mono">{taskRow.completedAt}</span>
                {taskRow.roundSummary ? (
                  <>
                    <div
                      ref={reviewSumRef}
                      className={`mdw-review-sum${ackOpen ? ' is-open' : ''}`}
                      title={ackOpen || !(ackOverflow || ackLong) ? 'agent 的完成总结（ack）' : '点击下方展开全文'}
                      dangerouslySetInnerHTML={{ __html: ackHtml }}
                    />
                    {(ackOverflow || ackLong || ackOpen) && (
                      <button
                        type="button"
                        className="mdw-review-more"
                        onClick={() => setAckOpen((o) => !o)}
                      >
                        {ackOpen ? '收起' : '展开全文'}
                      </button>
                    )}
                  </>
                ) : null}
              </div>
              <div className="mdw-review-acts">
                {isChainTip ? (
                  <button type="button" className="ghost" onClick={openFeedback} title="新开一条任务携带反馈（原任务不动）">
                    反馈
                  </button>
                ) : (
                  <>
                    <span
                      className="mdw-review-later"
                      title="这条任务已有后续轮次——在旧轮次上反馈会把链分叉，请到最新一轮反馈"
                    >
                      已进入后续轮次
                    </span>
                    {latestChild ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={openLatestRound}
                        title={`到最新一轮 #${latestChild.id} 反馈`}
                      >
                        去最新一轮 #{latestChild.id}
                      </button>
                    ) : null}
                  </>
                )}
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
