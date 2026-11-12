// 文档页底部附件 dock（#183）。
//
// 为什么单独一个文件：文档页此前把 AttachArea 直接铺在正文下面、页脚再吊一条
// hint——没有标题栏、没有分隔，看上去像正文的一部分；而任务页的附件是在
// `.mdw-dock` 里带 tab 头的。这里把外壳抽出来复用同一套样式与交互语言，
// 同时把 DocPanel 压回行数门禁以内（页面只留「状态 + props」）。
//
// host 必须是 'doc'（AttachHostKind 只有 task / doc）。历史上页面传的是 'ref'
// 强转，落进 endpointOf / attachBodyOf 的 else 分支：「挂文档」发任务侧的 `ref`
// 键（docs.attach 只认 `doc`）、「改说明」打任务端点，文档侧两个动作全废。
import AttachArea from '../../components/md/attach-area.jsx';

export interface DocAttachDockProps {
  /** 当前文档的 docId（rel: / path:） */
  refId?: string;
  /** 附件条数（tab 上的计数徽标） */
  count?: number;
  /** 可写=false 时附件区禁用（只读文档） */
  writable?: boolean;
  /** 展开态 */
  open?: boolean;
  onToggle?: () => void;
  /** 挂 / 摘之后通知页面重拉清单（tab 计数与正文 ref 标题都靠它） */
  onChanged?: () => void;
  /** 点 ref 条目打开文档 */
  onOpenDoc?: (locator: unknown) => void;
}

export default function DocAttachDock({
  refId,
  count = 0,
  writable = false,
  open = true,
  onToggle,
  onChanged,
  onOpenDoc,
}: DocAttachDockProps) {
  return (
    <div className="mdw-dock docp-dock">
      <div className="mdw-dock-head">
        <div className="mdw-dock-tabs">
          <button
            type="button"
            className={'mdw-dock-tab' + (open ? ' is-on' : '')}
            aria-expanded={open}
            onClick={onToggle}
          >
            附件{count ? <span className="mdw-dock-tab-num">{count}</span> : null}
          </button>
        </div>
        <span className="docp-hint">双链 [[]] 点击跳转 · Ctrl+S 保存 · 文档即磁盘文件（~/.nx-kv/docs/）</span>
        <div className="mdw-dock-acts">
          <button
            type="button"
            className="mdw-dock-act"
            title={open ? '收起附件' : '展开附件'}
            aria-label={open ? '收起附件' : '展开附件'}
            onClick={onToggle}
          >
            {open ? '▾' : '▴'}
          </button>
        </div>
      </div>
      {open ? (
        <div className="mdw-dock-body">
          <AttachArea
            host="doc"
            refId={refId}
            allow={{ file: true, url: true, task: false, ref: true }}
            disabled={!writable}
            disabledText="只读文档不能添加附件。"
            onChanged={onChanged}
            onOpenDoc={onOpenDoc}
          />
        </div>
      ) : null}
    </div>
  );
}
