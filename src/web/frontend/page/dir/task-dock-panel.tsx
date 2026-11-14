// 底部抽屉面板（#79）：附件 / md / check / 反馈收在这里，编辑区不再被内容块挤占。
import { useState } from 'react';
import type { ComponentProps, Dispatch, MouseEvent as ReactMouseEvent, ReactNode, Ref, RefObject, SetStateAction } from 'react';
import type { Model } from 'flexlayout-react';
import { Icon } from '../../components/icons.jsx';
import AttachBar from '../../components/md/attach-bar.jsx';
import AttachAreaRaw from '../../components/md/attach-area.jsx';
import type { AttachAreaHandle } from '../../components/md/attach-area.jsx';
import type { Attachment } from '../../components/md/attach-common.js';
import { docIdOfLocator } from '../../components/md/attach-common.js';
import { openPanel } from '../../workspace.js';
import { getMdfileContent } from './api.js';
import { renderMarkdownHtml } from '../../modules/md/md-render.js';
import { GLOBAL_KEY } from '../../modules/board/board-view.js';
import type { LocalTask, LocalTopic } from '../../types.js';
import { fmtSec } from './task-utils.js';
import type { AppSlice, ChainApiItem, DocState, GoalLogState } from './task-utils.js';

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
  isDraft: boolean;
  task: string;
  topic: LocalTopic | null;
  topicKey: string;
  isGlobal: boolean;
  doc: DocState;
  id: string;
  model: Model | null;
  app: AppSlice;
  refreshLocal?: () => Promise<void>;
  markDirty: () => void;
  saveDoc: (id: string, patch: Partial<DocState>) => void;
  persistAtt: (id: string | number, attachments: Attachment[]) => void;
  attachAreaRef: RefObject<AttachAreaHandle | null>;
  reviewBarRef: RefObject<HTMLDivElement | null>;
  reviewSumRef: RefObject<HTMLDivElement | null>;
  taskRow: LocalTask | null;
  ackOpen: boolean;
  setAckOpen: Dispatch<SetStateAction<boolean>>;
  ackOverflow: boolean;
  ackLong: boolean;
  ackHtml: string;
  isChainTip: boolean;
  latestChild: ChainApiItem | null;
  openFeedback: () => void;
  openLatestRound: () => void;
  /** 任务当前挂载的附件（md 栏按 kind='mdfile' 过滤，不另建模型） */
  attachments: Attachment[];
}

/** md 栏：附件里 kind='mdfile' 的那部分，按 md 渲染（底层仍是 attachments）。 */
function MdDockTab({ attachments }: { attachments: Attachment[] }) {
  const list = attachments.filter((a) => a.kind === 'mdfile');
  const [openId, setOpenId] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, { html: string; path: string; stale: boolean; missing: boolean; loading?: boolean; error?: string }>>({});

  const open = async (id: string) => {
    setOpenId(id);
    if (docs[id] && !docs[id].error) return;
    setDocs((m) => ({ ...m, [id]: { html: '', path: '', stale: false, missing: false, loading: true } }));
    try {
      const r = await getMdfileContent(id);
      setDocs((m) => ({
        ...m,
        [id]: {
          html: renderMarkdownHtml(String(r.body || '')),
          path: String(r.absPath || ''),
          stale: !!r.stale,
          missing: !!r.missing,
        },
      }));
    } catch (e) {
      setDocs((m) => ({ ...m, [id]: { html: '', path: '', stale: false, missing: false, error: (e as Error).message || String(e) } }));
    }
  };

  if (!list.length) {
    return <div className="mdw-dock-empty">没有 md 附件——用 `nx-kv localtask attach --mdfile &lt;本地 md 路径&gt;` 挂一个外部 md 文件。</div>;
  }
  const cur = openId ? docs[openId] : null;
  return (
    <div className="mdw-md-tab">
      <div className="mdw-md-list" role="list">
        {list.map((a) => (
          <button
            type="button"
            role="listitem"
            key={String(a.id)}
            className={`mdw-md-item${openId === String(a.id) ? ' is-on' : ''}`}
            onClick={() => open(String(a.id))}
            title={a.absPath || ''}
          >
            <span className="mdw-md-item-name">{a.name || 'md'}</span>
            <span className="mdw-md-item-path mono">{a.absPath || '（路径为空）'}{a.missing ? ' · 文件已不在' : ''}</span>
          </button>
        ))}
      </div>
      <div className="mdw-md-view">
        {!openId ? <div className="mdw-dock-empty">选一条 md 看预览。</div> : null}
        {cur?.loading ? <div className="mdw-dock-empty">读取中…</div> : null}
        {cur?.error ? <div className="mdw-dock-empty">读取失败：{cur.error}</div> : null}
        {cur && !cur.loading && !cur.error ? (
          cur.missing ? (
            <div className="mdw-dock-empty">源文件已不在：{cur.path || '（路径为空）'}</div>
          ) : (
            <div className="mdw-md-render">
              {cur.stale ? <div className="att-md-warn">内容已变化（与登记指纹不一致），以下为磁盘当前内容。</div> : null}
              <article dangerouslySetInnerHTML={{ __html: cur.html }} />
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

export function DockPanel({
  dockOpen, dockTab, dockH, dockRef, dockMax,
  showDockTab, onDockDragStart, toggleDockMax, setDockOpen,
  canShowGoalLog, goalLog, openGoalLog,
  isDraft, task, topic, topicKey, isGlobal, doc, id, model, app,
  refreshLocal, markDirty, saveDoc, persistAtt,
  attachAreaRef, reviewBarRef, reviewSumRef,
  taskRow, ackOpen, setAckOpen, ackOverflow, ackLong, ackHtml,
  isChainTip, latestChild, openFeedback, openLatestRound, attachments,
}: DockPanelProps) {
  if (!dockOpen) return null;
  const mdCount = attachments.filter((a) => a.kind === 'mdfile').length;

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
          <button
            type="button"
            role="tab"
            aria-selected={dockTab === 'md'}
            className={`mdw-dock-tab${dockTab === 'md' ? ' is-on' : ''}`}
            onClick={() => showDockTab('md')}
            title="只聚合 kind='mdfile' 的附件（md 预览）"
          >
            md
            {mdCount ? <span className="mdw-dock-tab-num">{mdCount}</span> : null}
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
              allow={{ file: true, url: true, folder: true, task: true, ref: true }}
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

        {dockTab === 'md' ? <MdDockTab attachments={attachments} /> : null}

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
