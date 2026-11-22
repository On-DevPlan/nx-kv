/** 任务链可视化（#77）：弹窗内展示；history 或 fork 祖先/子任务，点节点旁路查看。 */
// #172：链的真相是**单向树**（task_links 一父约束 + 递归展开）——面板默认按树渲染
// （根在顶、缩进层级、旁支并排），线性列表只留给 history 快照视图。
import { Modal } from '../../popup/index.jsx';
import type { ChainTreeNode } from '../../../page/dir/task-utils.js';
import ChainGraph from './task-chain-graph.js';

const KIND_LAB: Record<string, string> = {
  origin: '起点',
  reopen: '反馈',
  feedback: '反馈',
  comment: '评论',
  fork: '分支',
  current: '当前',
};

/** 链上的一轮任务（useTaskChain 的出站形状里本视图用到的字段）。 */
export interface ChainNode {
  current?: boolean;
  dirKey?: string;
  id?: string | number;
  taskId?: string | number;
  kind?: string;
  excerpt?: string;
  feedback?: string;
  at?: string;
  attachmentCount?: number;
  [k: string]: any;
}

interface ChainListProps {
  nodes?: ChainNode[];
  onOpenNode?: (n: ChainNode) => void;
}

function ChainList({ nodes = [], onOpenNode }: ChainListProps) {
  if (!nodes.length) {
    return <div className="mdw-chain-empty muted">这条任务还没有链（反馈 / 评论派生后会出现）</div>;
  }
  return (
    <ol className="mdw-chain-list" aria-label="任务链节点">
      {nodes.map((n, i) => {
        // T04：节点 = 链上每一轮的任务（seq 做唯一 key）；不再有 history 事件层
        const key = n.current ? 'current' : `t-${n.dirKey || ''}-${n.id ?? n.taskId ?? i}`;
        const lab = KIND_LAB[n.kind || ''] || n.kind || '?';
        const title = n.excerpt || n.feedback || lab;
        const meta = [
          n.taskId != null ? `#${n.taskId}` : null,
          n.at || null,
          n.attachmentCount ? `📎${n.attachmentCount}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <li key={key} className={`mdw-chain-li${n.current ? ' is-current' : ''}`}>
            <div className="mdw-chain-rail" aria-hidden>
              <span className="mdw-chain-dot" />
              {i < nodes.length - 1 ? <span className="mdw-chain-line" /> : null}
            </div>
            <button
              type="button"
              className={`mdw-chain-card${n.kind === 'comment' ? ' is-comment' : ''}`}
              title={n.current ? '当前任务（本页）' : `查看：${title}`}
              disabled={!!n.current}
              onClick={() => {
                if (!n.current) onOpenNode?.(n);
              }}
            >
              <span className="mdw-chain-kind">{lab}</span>
              <span className="mdw-chain-ex">{title || '—'}</span>
              {meta ? <span className="mdw-chain-meta">{meta}</span> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

interface TaskChainModalProps {
  open?: boolean;
  nodes?: ChainNode[];
  /** #172：单向树（后端 taskChain 的 tree 字段）——给出即按树渲染 */
  tree?: ChainTreeNode | null;
  onOpenNode?: (n: ChainNode) => void;
  onClose?: () => void;
}

/** 「更多 → 任务链」弹窗 */
export function TaskChainModal({ open, nodes, tree, onOpenNode, onClose }: TaskChainModalProps) {
  if (!open) return null;
  return (
    <Modal title="任务链" onClose={onClose} size="lg" className="mdw-chain-modal">
      <p className="mdw-chain-hint">
        {tree
          ? '单向树：每条任务至多一个来源（评论 / 反馈 / 分支），后代分叉并列。点任意节点旁路打开。'
          : '从早到晚排列。点非当前节点可在旁路打开内容。'}
        {' '}agent 实收提示词为交付重排版（最新轮在前）；原始意图读正文的 WARNING 块。
      </p>
      {tree ? (
        <ChainGraph
          root={tree}
          onOpen={(n) => {
            onOpenNode?.({ ...n, taskId: n.id, dirKey: n.key, kind: n.forkKind } as ChainNode);
            onClose?.();
          }}
        />
      ) : (
        <ChainList
          nodes={nodes}
          onOpenNode={(n) => {
            onOpenNode?.(n);
            onClose?.();
          }}
        />
      )}
    </Modal>
  );
}

export default ChainList;
