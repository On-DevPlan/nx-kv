// 编排画布的单个任务节点：编号与徽章、标题、上游依赖 chips、出入栈口。
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../../components/icons.jsx';
import { depToNodeKey, labelOf } from './model.js';
import type { DagNode, DagPoint, DepToken, LinkPreview } from './model.js';
import { NODE_W } from './layout.js';

/** 节点「⋯」菜单的一项（PopMenu 的 items 元素）。 */
export interface DagOpsItem {
  label: string;
  onClick: () => void;
}

/** 节点「⋯」菜单的坐标与内容。 */
export interface DagOpsMenu {
  x: number;
  y: number;
  items: DagOpsItem[];
}

interface DagNodeProps {
  n: DagNode;
  p: DagPoint;
  byNodeKey: Map<string, DagNode>;
  groupMode: boolean;
  dragId: string | null;
  linking: LinkPreview | null;
  linkArmed: boolean;
  onStartDrag: (e: ReactPointerEvent<HTMLDivElement>, n: DagNode) => void;
  onStartLink: (e: ReactPointerEvent<HTMLButtonElement>, n: DagNode) => void;
  onOpenTask: (n: DagNode) => void;
  onToggleGate: (n: DagNode) => void;
  onAddTimegoal: (n: DagNode) => void;
  onRemoveDep: (n: DagNode, token: DepToken) => void;
  onOpsMenu: (menu: DagOpsMenu) => void;
}

export default function DagNode({
  n,
  p,
  byNodeKey,
  groupMode,
  dragId,
  linking,
  linkArmed,
  onStartDrag,
  onStartLink,
  onOpenTask,
  onToggleGate,
  onAddTimegoal,
  onRemoveDep,
  onOpsMenu,
}: DagNodeProps) {
  const depEntries = (n.blockBy || [])
    .map((d) => ({ token: d, key: depToNodeKey(d, n.topicKey) }))
    .filter((x) => x.key && byNodeKey.has(x.key));
  const isOver = linking && linking.overId === n.nodeKey;
  const isSrc = linking && linking.sourceId === n.nodeKey;
  return (
    <div
      data-node-id={n.nodeKey}
      className={
        'dagp-node'
        + (dragId === n.nodeKey ? ' dragging' : '')
        + (isOver ? ' over' : '')
        + (isSrc ? ' linking-src' : '')
        + (n.blocksFollowing ? ' gate' : '')
        + (linkArmed && !isSrc ? ' link-target' : '')
      }
      style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: NODE_W }}
      onPointerDown={(e) => onStartDrag(e, n)}
    >
      <span className="dagp-port in" title="入：箭头指向我 = 我等对方" aria-hidden="true" />
      <div className="dagp-body">
        <div className="dagp-top">
          <span className="dagp-no mono">#{n.id}</span>
          {groupMode && <span className="dagp-chip proj">{n.projectName}</span>}
          {n.blocksFollowing && <span className="dagp-chip gate">闸门</span>}
          {n.ready === false && <span className="dagp-chip lock">锁定</span>}
          {n.timegoal?.duration && (
            <span className="dagp-chip goal">⏱ {n.timegoal.duration}</span>
          )}
          <button
            type="button"
            className="dagp-ops"
            title="节点操作"
            aria-label="节点操作"
            onClick={(e) => {
              e.stopPropagation();
              const items = [
                { label: '打开任务', onClick: () => onOpenTask(n) },
                {
                  label: n.blocksFollowing ? '取消闸门' : '设为闸门（挡住后续）',
                  onClick: () => onToggleGate(n),
                },
                {
                  label: n.timegoal?.duration ? '改时间目标' : '加时间目标（timegoal）',
                  onClick: () => onAddTimegoal(n),
                },
              ];
              const r = e.currentTarget.getBoundingClientRect();
              onOpsMenu({ x: r.left, y: r.bottom, items });
            }}
          >
            {/* icons.tsx 尚未类型化完（title 被推断为必填）：显式传 undefined 与不传等价 */}
            <Icon name="dots" size={13} title={undefined} />
          </button>
        </div>
        <div
          className="dagp-name"
          title={n.text}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onOpenTask(n);
          }}
        >
          {labelOf(n)}
        </div>
        {depEntries.length > 0 && (
          <div className="dagp-deps">
            {depEntries.map(({ token, key }) => {
              const src = key ? byNodeKey.get(key) : undefined;
              const cross = !!src && src.topicKey !== n.topicKey;
              return (
                <span
                  key={String(token)}
                  className="dagp-chip dep"
                  title={cross && src ? `跨项目 #${src.id}@${src.projectName} → #${n.id}` : `#${src?.id} → #${n.id}`}
                >
                  ← #{src?.id}{cross ? `@${src.projectName}` : ''}
                  <i
                    role="button"
                    aria-label="解除依赖"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveDep(n, token);
                    }}
                  >
                    ×
                  </i>
                </span>
              );
            })}
          </div>
        )}
      </div>
      <button
        type="button"
        className="dagp-port out"
        title="点一下再点目标，或按住拖到目标 = 有向顺序（可跨项目）"
        aria-label={`从 #${n.id} 开始连线`}
        onPointerDown={(e) => onStartLink(e, n)}
      />
    </div>
  );
}
