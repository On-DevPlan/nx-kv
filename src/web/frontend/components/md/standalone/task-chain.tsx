/** 任务链可视化（#77）：弹窗内展示；history 或 fork 祖先/子任务，点节点旁路查看。 */
// #172：链的真相是**单向树**（task_links 一父约束 + 递归展开）——面板默认按树渲染
// （根在顶、缩进层级、旁支并排），线性列表只留给 history 快照视图。
import { Modal } from '../../popup/index.jsx';
import type { ChainTreeNode } from '../../../page/dir/task-utils.js';

const KIND_LAB: Record<string, string> = {
  origin: '起点',
  reopen: '反馈',
  comment: '评论',
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

/** #172：树视图的递归节点（缩进层级 + 分支并排；点击旁路打开）。 */
function ChainTreeList({
  node, depth = 0, onOpenNode,
}: {
  node: ChainTreeNode;
  depth?: number;
  onOpenNode?: (n: ChainNode) => void;
}) {
  const lab = KIND_LAB[node.forkKind || ''] || node.forkKind || (depth === 0 ? '起点' : '?');
  const title = node.excerpt || lab;
  const meta = [node.id != null ? `#${node.id}` : null, node.createdAt || null, node.status ? STATUS_LAB[node.status] || node.status : null]
    .filter(Boolean)
    .join(' · ');
  const kids = node.children || [];
  return (
    <li className={`mdw-chain-li${node.current ? ' is-current' : ''}${node.missing ? ' is-missing' : ''}`}>
      <div className="mdw-chain-rail" aria-hidden>
        <span className="mdw-chain-dot" />
        {kids.length ? <span className="mdw-chain-line" /> : null}
      </div>
      <button
        type="button"
        className={`mdw-chain-card${node.forkKind === 'comment' ? ' is-comment' : ''}`}
        title={node.current ? '当前任务（本页）' : node.missing ? '来源任务已删除/迁出' : `查看：${title}`}
        disabled={!!node.current}
        onClick={() => {
          if (!node.current && !node.missing) onOpenNode?.({ ...node, taskId: node.id, dirKey: node.key });
        }}
      >
        <span className="mdw-chain-kind">{lab}</span>
        <span className="mdw-chain-ex">{title || '—'}</span>
        {meta ? <span className="mdw-chain-meta">{meta}</span> : null}
        {kids.length > 1 ? <span className="mdw-chain-meta">{kids.length} 条旁支</span> : null}
      </button>
      {kids.length ? (
        <ol className="mdw-chain-tree-kids">
          {kids.map((k, i) => (
            <ChainTreeList key={`${node.id}:${k.id}:${i}`} node={k} depth={depth + 1} onOpenNode={onOpenNode} />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

const STATUS_LAB: Record<string, string> = {
  pending: '待领取',
  claimed: '已领取',
  done: '已完成',
  cancelled: '已取消',
};

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
    <Modal title="任务链" onClose={onClose} size="md" className="mdw-chain-modal">
      <p className="mdw-chain-hint">
        {tree
          ? '单向树：每条任务至多一个来源（反馈/评论派生），后代随时分叉。点非当前节点可在旁路打开内容。'
          : '从早到晚排列。点非当前节点可在旁路打开内容。'}
        {' '}提示词口径：库中正文 = 旧正文 + 程序生成的总结/反馈 callout（用户原文在 WARNING 块内）；
        agent 实际收到的是交付时重排后的版本（最新轮在前，历史轮压缩）。
      </p>
      {tree ? (
        <ol className="mdw-chain-list mdw-chain-tree" aria-label="任务链树">
          <ChainTreeList
            node={tree}
            onOpenNode={(n) => {
              onOpenNode?.(n);
              onClose?.();
            }}
          />
        </ol>
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
