// 链节点旁路：只读展示 history 快照（不占编辑文档）。
import { renderMarkdownHtml } from './task-utils.js';
import type { HistorySnapshot } from './task-utils.js';

/** 快照类型 → 中文标签。 */
const KIND_LAB: Record<string, string> = { origin: '起点', reopen: '反馈', comment: '评论' };

interface HistoryViewProps {
  historyId: number;
  historyNode: HistorySnapshot | null;
  closeBesideSelf: () => void;
}

export function HistoryView({ historyId, historyNode, closeBesideSelf }: HistoryViewProps) {
  const kindLab = KIND_LAB[String(historyNode?.kind ?? '')] || '节点';
  const html = historyNode
    ? renderMarkdownHtml(historyNode.text || '', historyNode.attachments || [])
    : '';
  return (
    <div className="mdw is-beside">
      <div className="mdw-beside-h">
        <span className="mdw-beside-lab">链节点 · {kindLab} #{historyId}</span>
        <span className="grow" />
        <button
          type="button"
          className="iconbtn"
          title="关闭"
          aria-label="关闭"
          onClick={closeBesideSelf}
        >
          ×
        </button>
      </div>
      <div className="mdw-hist-ro">
        {!historyNode ? (
          <div className="muted">找不到链节点 #{historyId}</div>
        ) : (
          <>
            <div className="mdw-hist-meta">
              <span>{historyNode.at || '—'}</span>
              {historyNode.quote ? <span>锚定：{historyNode.quote.slice(0, 80)}</span> : null}
              {historyNode.feedback ? <span>反馈：{historyNode.feedback.slice(0, 80)}</span> : null}
              {historyNode.summary ? <span>上轮总结：{historyNode.summary.slice(0, 80)}</span> : null}
            </div>
            <article
              className="md-body"
              dangerouslySetInnerHTML={{ __html: html || '<p class="muted">（空）</p>' }}
            />
          </>
        )}
      </div>
    </div>
  );
}
