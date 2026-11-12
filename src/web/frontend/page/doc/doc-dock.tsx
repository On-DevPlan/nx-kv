// 文档页底部「信息面板 + 状态栏」（#183 收口）。
//
// 形态与任务页（page/dir/task-dock-panel.tsx + task-status-bar.tsx）逐项同构：
//   · 上沿可拖高（双击最大化/还原），右上最大化 / 关闭，右下角常驻状态栏留入口；
//   · 面板里的内容按 tab 切：附件 / 归属。
//
// 为什么改：此前文档页是「正文下面常驻一个附件块 + 正文上方一条归属头部」——
// 附件块把编辑器往下挤，归属头又白吃一行，两处都跟任务页的同一个编辑器不像。
// 现在正文只留编辑器本体，附件与归属都收进这个面板，入口在状态栏按钮上。
//
// host 必须是 'doc'（AttachHostKind 只有 task / doc）。历史上页面传的是 'ref'
// 强转，落进 endpointOf / attachBodyOf 的 else 分支：「挂文档」发任务侧的 `ref`
// 键（docs.attach 只认 `doc`）、「改说明」打任务端点，文档侧两个动作全废。
import type { ReactNode } from 'react';
import { Icon } from '../../components/icons.jsx';
import AttachArea from '../../components/md/attach-area.jsx';
import type { DockState } from '../dir/task-dock.js';

/** 附件 tab 的内容（AttachArea 常用参数收在这里，页面只传业务回调）。 */
export function DocAttachBody({ refId, writable, onChanged, onOpenDoc }: {
  refId?: string;
  writable?: boolean;
  onChanged?: () => void;
  onOpenDoc?: (locator: unknown) => void;
}) {
  return (
    <AttachArea
      host="doc"
      refId={refId}
      allow={{ file: true, url: true, task: false, ref: true }}
      disabled={!writable}
      disabledText="只读文档不能添加附件。"
      onChanged={onChanged}
      onOpenDoc={onOpenDoc}
    />
  );
}

export interface DocDockPanelProps {
  dock: DockState;
  /** 附件条数（tab 徽标） */
  attCount?: number;
  /** 归属条数（tab 徽标） */
  bindCount?: number;
  attachNode?: ReactNode;
  bindNode?: ReactNode;
}

export function DocDockPanel({ dock, attCount = 0, bindCount = 0, attachNode, bindNode }: DocDockPanelProps) {
  const { dockOpen, dockTab, dockH, dockRef, dockMax, showDockTab, onDockDragStart, toggleDockMax, setDockOpen } = dock;
  if (!dockOpen) return null;
  const tab = dockTab === 'bind' ? 'bind' : 'attach';

  return (
    <div className="mdw-dock docp-dock" ref={dockRef} style={{ height: `${dockH}px` }}>
      <div
        className="mdw-dock-drag"
        role="separator"
        aria-orientation="horizontal"
        title="上下拖动调整信息面板高度（双击最大化 / 还原）"
        onMouseDown={onDockDragStart}
        onDoubleClick={toggleDockMax}
      />
      <div className="mdw-dock-head">
        <div className="mdw-dock-tabs" role="tablist" aria-label="信息面板">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'attach'}
            className={`mdw-dock-tab${tab === 'attach' ? ' is-on' : ''}`}
            onClick={() => showDockTab('attach')}
          >
            附件{attCount ? <span className="mdw-dock-tab-num">{attCount}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'bind'}
            className={`mdw-dock-tab${tab === 'bind' ? ' is-on' : ''}`}
            onClick={() => showDockTab('bind')}
          >
            归属{bindCount ? <span className="mdw-dock-tab-num">{bindCount}</span> : null}
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
        {/* 两个 tab 的内容留在同一棵树上（display 切换而不是卸载）：
            归属的 tag 行由 hook 持有，卸载不会丢数据，但切回来会重排一次宽度。 */}
        <div className="docp-dock-pane" hidden={tab !== 'attach'}>{attachNode}</div>
        <div className="docp-dock-pane" hidden={tab !== 'bind'}>{bindNode}</div>
      </div>
    </div>
  );
}

export function DocStatusBar({ dock, attCount = 0, bindCount = 0 }: {
  dock: DockState;
  attCount?: number;
  bindCount?: number;
}) {
  const { dockOpen, dockTab, showDockTab, setDockOpen } = dock;
  return (
    <div className="mdw-sbar">
      <button
        type="button"
        className={`mdw-sbar-item${dockOpen && dockTab === 'attach' ? ' is-on' : ''}`}
        onClick={() => showDockTab('attach')}
        title="附件（点击展开信息面板）"
      >
        <Icon name="list" title={undefined} />
        <span className="mdw-sbar-lab">附件</span>
        {attCount ? <span className="mdw-sbar-num">{attCount}</span> : null}
      </button>
      <button
        type="button"
        className={`mdw-sbar-item${dockOpen && dockTab === 'bind' ? ' is-on' : ''}`}
        onClick={() => showDockTab('bind')}
        title="归属：这篇文档被哪些仓库 / 项目组引用（点击展开信息面板）"
      >
        <Icon name="repo" title={undefined} />
        <span className="mdw-sbar-lab">归属</span>
        {bindCount ? <span className="mdw-sbar-num">{bindCount}</span> : null}
      </button>
      <span className="mdw-sbar-grow" />
      <span className="docp-sbar-hint">双链 [[]] 点击跳转 · Ctrl+S 保存 · 文档即磁盘文件</span>
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
