// 编排面板（可视化 DAG）——目录与项目组共用。
//
// 顺序语义：
//   - 只有有向连线表达先后（blockBy：A→B = B 等 A）
//   - 未连线 = 无编排序，走各队列默认序
//   - 拖节点只改摆位，不 reorder
//
// 组模式（groupId）：一次展示组内全部任务；跨项目边落盘为 "topicKey:id"，对 get 生效。
//
// 画布各件按职责拆在同目录：model.js（任务/依赖纯逻辑）、layout.js（几何常量、
// 默认分栏、摆位持久化）、edges.js（连线端点计算）、node-card.jsx / head-bar.jsx
// （视图）、use-interactions.js（拖拽/连线的全局指针监听）。
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useApp } from '../../app-context.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { PopMenu, useDialog } from '../../components/popup/index.jsx';
import { parseFrontmatter } from '../../modules/md/md-parse.js';
import { isGroupTask } from '../../modules/board/board-view.js';
import { reaches } from '../../../../shared/graph.js';
import { depToNodeKey, formatDepForTarget, isPending, nodeKeyOf, parseDep } from './model.js';
import type { DagLinkMode, DagMode, DagNode, DagPosMap, DepToken, LinkPreview } from './model.js';
import { patchTaskItem } from './api.js';
import { FILTER_ALL, NODE_W, PAD_X, PAD_Y, ROW_H, clearPos, defaultLayout, loadPos } from './layout.js';
import { canvasPoint, computeEdges, cubic, portOriginOf } from './edges.js';
import { useDagInteractions } from './use-interactions.js';
import DagHead from './head-bar.jsx';
import type { DagQueue } from './head-bar.jsx';
import DagNodeView from './node-card.jsx';
import type { DagOpsMenu } from './node-card.jsx';

interface DagPanelProps {
  dirKey?: string;
  groupId?: string;
}

/** PATCH /api/localtasks/item 里本面板会带的字段（其余字段由后端契约兜住）。 */
interface DagPatchBody {
  blockBy?: DepToken[];
  gate?: boolean;
  duration?: string;
  clearGoal?: boolean;
}

export default function DagPanel({ dirKey, groupId }: DagPanelProps) {
  const app = useApp();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const rows = app.rows || [];
  const refreshLocal = app.refreshLocal;
  const markerId = useId().replace(/:/g, '');

  const boards = (app.repoData && app.repoData.boards) || [];
  const board = useMemo(
    () => boards.find((b) => b.id === groupId || b.key === groupId) || null,
    [boards, groupId]
  );
  const groupMode = !!board;

  const queues = useMemo<DagQueue[]>(() => {
    if (!board) return [];
    const out: DagQueue[] = [];
    for (const m of board.repos || []) {
      const t = rows.find((r) => r.repo && r.repo.key === m.key);
      if (!t) continue;
      const boardIds = [board.id, board.key, board.name].filter(Boolean);
      const pendingTasks = (t.tasks || []).filter((task) => {
        if (!isPending(task)) return false;
        const fm = parseFrontmatter(task.text);
        return fm.board && boardIds.includes(fm.board);
      });
      if (!pendingTasks.length) continue;
      out.push({
        key: t.key,
        name: m.name || m.key,
        cwd: t.cwd,
        isGlobal: !!t.isGlobal,
        count: pendingTasks.length,
        total: pendingTasks.length,
      });
    }
    return out;
  }, [board, rows]);

  // 滤镜：组模式默认「全部」；目录模式钉死本目录
  const [filterKey, setFilterKey] = useState(FILTER_ALL);
  useEffect(() => {
    if (!groupMode) setFilterKey(FILTER_ALL);
  }, [groupMode, groupId]);

  const dirTopic = useMemo(
    () => (!groupMode ? rows.find((r) => r.key === dirKey) || null : null),
    [groupMode, rows, dirKey]
  );

  /** @type {Array<object>} 画布节点：只含待领取；task 字段 + topicKey/cwd/projectName/nodeKey */
  const nodes = useMemo<DagNode[]>(() => {
    if (groupMode && board) {
      const boardIds = [board.id, board.key, board.name].filter(Boolean);
      const out: DagNode[] = [];
      for (const m of board.repos || []) {
        const t = rows.find((r) => r.repo && r.repo.key === m.key);
        if (!t) continue;
        if (filterKey && t.key !== filterKey) continue;
        for (const task of t.tasks || []) {
          if (!isPending(task)) continue;
          const fm = parseFrontmatter(task.text);
          if (!fm.board || !boardIds.includes(fm.board)) continue;
          out.push({
            ...task,
            topicKey: t.key,
            topicCwd: t.cwd,
            topicIsGlobal: !!t.isGlobal,
            projectName: m.name || m.key,
            nodeKey: nodeKeyOf(t.key, task.id),
          });
        }
      }
      return out;
    }
    if (!dirTopic) return [];
    // #85 两种走向：目录模式是项目走向的画布——组任务归组页（组模式分支不受影响）
    return (dirTopic.tasks || []).filter((task) => isPending(task) && !isGroupTask(task)).map((task): DagNode => ({
      ...task,
      topicKey: dirTopic.key,
      topicCwd: dirTopic.cwd,
      topicIsGlobal: !!dirTopic.isGlobal,
      projectName: dirTopic.name || dirTopic.key,
      nodeKey: nodeKeyOf(dirTopic.key, task.id),
    }));
  }, [groupMode, board, rows, filterKey, dirTopic]);

  const byNodeKey = useMemo(
    () => new Map<string, DagNode>(nodes.map((n) => [n.nodeKey, n] as [string, DagNode])),
    [nodes]
  );
  const byNodeKeyRef = useRef(byNodeKey);
  byNodeKeyRef.current = byNodeKey;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<DagPosMap>(() => new Map());
  const posRef = useRef(pos);
  posRef.current = pos;
  // 画布可视高度 → 每列容量（#153：布局分栏换行，别再一列到底竖着排）
  const [canvasH, setCanvasH] = useState(0);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const read = () => setCanvasH(el.clientHeight || 0);
    read();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    window.addEventListener('resize', read);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', read);
    };
  }, []);
  const perCol = Math.max(3, Math.floor(((canvasH || 720) - PAD_Y * 2) / ROW_H) || 8);

  // 位置持久化（#153）：scope = 组 id 或目录 key；拖过的位置记在 localStorage
  const scopeKey = groupMode ? `g:${board?.id || groupId || ''}` : `d:${dirKey || ''}`;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey; // 拖动写盘用（全局监听是空依赖闭包，得读最新）
  const storedPos = useMemo(() => loadPos(scopeKey), [scopeKey]);
  const scopeRef = useRef(scopeKey);
  const userMovedRef = useRef(new Set<string>());

  useEffect(() => {
    const scopeChanged = scopeRef.current !== scopeKey;
    scopeRef.current = scopeKey;
    setPos((prev) => {
      const next: DagPosMap = new Map();
      const fresh = defaultLayout(nodes, { perCol });
      for (const n of nodes) {
        // 优先级：已存位置（用户拖过）> 本会话拖过的位置 > 默认布局
        const saved = storedPos.get(n.nodeKey);
        const kept = saved
          || (!scopeChanged && userMovedRef.current.has(n.nodeKey) ? prev.get(n.nodeKey) : null)
          || fresh.get(n.nodeKey)
          || { x: PAD_X, y: PAD_Y };
        next.set(n.nodeKey, kept);
      }
      return next;
    });
  }, [nodes, perCol, storedPos, scopeKey]);

  const modeRef = useRef<DagMode>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [linking, setLinking] = useState<LinkPreview | null>(null);
  const [opsMenu, setOpsMenu] = useState<DagOpsMenu | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const commitRef = useRef<(srcKey: string, dstKey: string) => Promise<boolean>>(async () => false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const patchNode = async (node: DagNode, body: DagPatchBody, okMsg?: string): Promise<void> => {
    setBusy(true);
    try {
      const payload: { blockBy?: DepToken[] | string; gate?: boolean; duration?: string; clearGoal?: boolean } = { ...body };
      if (Array.isArray(payload.blockBy)) payload.blockBy = payload.blockBy.join(',');
      const scope = node.topicIsGlobal ? { key: node.topicKey } : { cwd: node.topicCwd };
      await patchTaskItem({ ...scope, id: Number(node.id), ...payload });
      if (okMsg) toast(okMsg);
      if (refreshLocal) await refreshLocal();
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const { publishLink, clearMode } = useDagInteractions({
    canvasRef, modeRef, posRef, nodesRef, byNodeKeyRef, scopeKeyRef,
    userMovedRef, commitRef, toastRef, setPos, setDragId, setLinking,
  });

  const tryCommitLink = async (srcKey: string, dstKey: string): Promise<boolean> => {
    if (!dstKey || dstKey === srcKey) return false;
    const source = byNodeKeyRef.current.get(srcKey);
    const target = byNodeKeyRef.current.get(dstKey);
    if (!source || !target || !isPending(target)) {
      toastRef.current('只能连到待领取任务');
      return false;
    }
    if (target.blocksFollowing) {
      toastRef.current(`#${target.id} 是闸门，不能声明上游`);
      return false;
    }
    const edgeToken = formatDepForTarget(source, target.topicKey);
    const cur = [...(target.blockBy || [])];
    const already = cur.some((d: DepToken) => {
      const a = parseDep(d);
      const b = parseDep(edgeToken);
      if (!a || !b) return false;
      if (a.kind !== b.kind) return false;
      if (a.kind === 'local' && b.kind === 'local') return a.id === b.id;
      if (a.kind === 'foreign' && b.kind === 'foreign') return a.key === b.key && a.id === b.id;
      return false;
    });
    if (already) {
      toastRef.current(`已有该有向边`);
      return false;
    }
    // 环检测：在可见节点图上沿 blockBy（含跨队列）走——实现下沉 src/shared/graph.js，
    // 与 mutator.addEdge（wouldCycleAfterLink）同一份 DFS。
    const depsOf = (nk: string | number): string[] => {
      const n = byNodeKeyRef.current.get(String(nk));
      if (!n) return [];
      const out: string[] = [];
      for (const d of n.blockBy || []) {
        const k = depToNodeKey(d, n.topicKey);
        if (k && byNodeKeyRef.current.has(k)) out.push(k);
      }
      return out;
    };
    if (reaches(depsOf, srcKey, dstKey)) {
      toastRef.current('会形成环，已取消');
      return false;
    }
    const cross = source.topicKey !== target.topicKey;
    await patchNode(
      target,
      { blockBy: [...cur, edgeToken] },
      cross
        ? `#${source.id}@${source.projectName} → #${target.id}@${target.projectName}`
        : `#${source.id} → #${target.id}`,
    );
    return true;
  };
  commitRef.current = tryCommitLink;

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, n: DagNode) => {
    if (busyRef.current) return;
    if (e.button !== 0) return;
    // DOM 事件目标是外部边界：pointerdown 的 target 是具体元素，按 Element 取 closest
    if (e.target instanceof Element && e.target.closest('.dagp-port, .dagp-ops, .dagp-chip, button, a')) return;
    const m = modeRef.current;
    if (m && m.kind === 'link') {
      e.preventDefault();
      e.stopPropagation();
      if (n.nodeKey === m.sourceId) {
        clearMode();
        return;
      }
      if (!isPending(n)) {
        toastRef.current('只能连到待领取任务');
        return;
      }
      const src = m.sourceId;
      clearMode();
      commitRef.current(src, n.nodeKey);
      return;
    }
    if (modeRef.current || !isPending(n)) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = posRef.current.get(n.nodeKey) || { x: 0, y: 0 };
    const pt = canvasPoint(canvas, e.clientX, e.clientY);
    modeRef.current = { kind: 'drag', id: n.nodeKey, ox: pt.x - p.x, oy: pt.y - p.y };
    setDragId(n.nodeKey);
  };

  const startLink = (e: ReactPointerEvent<HTMLButtonElement>, n: DagNode) => {
    if (busyRef.current || !isPending(n)) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (modeRef.current?.kind === 'link' && modeRef.current.sourceId === n.nodeKey) {
      clearMode();
      return;
    }
    const o = portOriginOf(canvasRef.current, posRef.current, n.nodeKey, heightOf);
    const canvas = canvasRef.current;
    const pt = canvas ? canvasPoint(canvas, e.clientX, e.clientY) : { x: o.x, y: o.y };
    const state: DagLinkMode = {
      kind: 'link',
      sourceId: n.nodeKey,
      x1: o.x,
      y1: o.y,
      cx: pt.x,
      cy: pt.y,
      overId: null,
      dragged: false,
      sx: pt.x,
      sy: pt.y,
    };
    modeRef.current = state;
    publishLink(state);
  };

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!modeRef.current || modeRef.current.kind !== 'link') return;
    if (e.target instanceof Element && e.target.closest('.dagp-node')) return;
    clearMode();
  };

  const removeDep = async (n: DagNode, depToken: DepToken): Promise<void> => {
    const cur = [...(n.blockBy || [])];
    const next = cur.filter((d: DepToken) => {
      const a = parseDep(d);
      const b = parseDep(depToken);
      if (!a || !b) return String(d) !== String(depToken);
      if (a.kind !== b.kind) return true;
      if (a.kind === 'local' && b.kind === 'local') return a.id !== b.id;
      if (a.kind === 'foreign' && b.kind === 'foreign') return !(a.key === b.key && a.id === b.id);
      return true;
    });
    await patchNode(n, { blockBy: next }, `已解除依赖 → #${n.id}`);
  };

  const toggleGate = (n: DagNode) =>
    patchNode(n, { gate: !n.blocksFollowing }, !n.blocksFollowing ? `#${n.id} 设为闸门` : `#${n.id} 取消闸门`);

  const addTimegoal = async (n: DagNode): Promise<void> => {
    const v = await dialog({
      title: `时间目标 · #${n.id}`,
      input: true,
      placeholder: '如 2h / 90m',
      value: n.timegoal?.duration || '',
    });
    if (v === null || v === undefined) return;
    const duration = String(v).trim();
    if (!duration) {
      await patchNode(n, { clearGoal: true }, `#${n.id} 已清除时间目标`);
      return;
    }
    await patchNode(n, { duration }, `#${n.id} 时间目标 ${duration}`);
  };

  const openTask = (n: DagNode) => {
    if (!app.openPage) return;
    // 组模式（groupId 在场，#86）：节点散在成员队列里，页签锚在**组路由**上，
    // 不跳进单个项目——成员队列由任务页内部解析。
    if (groupId) app.openPage({ groupId, task: String(n.id), name: `#${n.id}` });
    else app.openPage({ dirKey: n.topicKey, task: String(n.id), name: `#${n.id}` });
  };

  // 节点实际高度（连线端点与命中检测共用）：已渲染读 DOM，未知按 64
  const heightOf = (nk: string): number => {
    const el = canvasRef.current?.querySelector(`[data-node-id="${CSS.escape(nk)}"]`);
    return el instanceof HTMLElement ? el.offsetHeight : 64;
  };

  const edges = useMemo(
    () => computeEdges(nodes, pos, byNodeKey, heightOf),
    [nodes, pos, byNodeKey, dragId, linking]
  );

  const extent = useMemo(() => {
    let maxX = 480;
    let maxY = 240;
    for (const n of nodes) {
      const p = pos.get(n.nodeKey);
      if (!p) continue;
      maxX = Math.max(maxX, p.x + NODE_W + 100);
      maxY = Math.max(maxY, p.y + 140);
    }
    if (linking) {
      maxX = Math.max(maxX, linking.cx + 40);
      maxY = Math.max(maxY, linking.cy + 40);
    }
    return { w: maxX, h: maxY };
  }, [nodes, pos, linking]);

  const title = groupMode
    ? (board?.name || '组编排')
    : (dirTopic?.name || dirKey || '编排');

  /** 恢复默认布局（#153）：清掉记住的摆位，按当前分栏规则重排 */
  const resetLayout = () => {
    clearPos(scopeKeyRef.current);
    userMovedRef.current.clear();
    setPos(defaultLayout(nodes, { perCol }));
    toast('已恢复默认布局');
  };

  const linkArmed = !!linking;
  const srcLabel = linking
    ? (byNodeKey.get(linking.sourceId)?.id ?? linking.sourceId)
    : '';

  return (
    <div className={'dagp' + (linkArmed ? ' is-linking' : '') + (dragId != null ? ' is-dragging' : '')}>
      <DagHead
        title={title}
        count={nodes.length}
        linkArmed={linkArmed}
        srcLabel={srcLabel}
        groupMode={groupMode}
        queues={queues}
        filterKey={filterKey}
        onFilter={setFilterKey}
        onReset={resetLayout}
      />

      <div className="dagp-canvas" ref={canvasRef} onPointerDown={onCanvasPointerDown}>
        <svg
          className="dagp-edges"
          width={extent.w}
          height={extent.h}
          style={{ width: extent.w, height: extent.h }}
          aria-hidden="true"
        >
          <defs>
            <marker
              id={`dagp-arrow-${markerId}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0 0 L10 5 L0 10 z" fill="var(--mdw-accent, #2F6F5E)" />
            </marker>
          </defs>
          {edges.map((e) => (
            <path
              key={`${e.from}->${e.to}`}
              className="dagp-edge"
              d={cubic(e.x1, e.y1, e.x2, e.y2)}
              markerEnd={`url(#dagp-arrow-${markerId})`}
            />
          ))}
          {linking && (
            <path
              className="dagp-edge preview"
              d={cubic(linking.x, linking.y, linking.cx, linking.cy)}
              markerEnd={`url(#dagp-arrow-${markerId})`}
            />
          )}
        </svg>

        <div className="dagp-nodes" style={{ width: extent.w, height: extent.h }}>
          {nodes.map((n) => (
            <DagNodeView
              key={n.nodeKey}
              n={n}
              p={pos.get(n.nodeKey) || { x: PAD_X, y: PAD_Y }}
              byNodeKey={byNodeKey}
              groupMode={groupMode}
              dragId={dragId}
              linking={linking}
              linkArmed={linkArmed}
              onStartDrag={startDrag}
              onStartLink={startLink}
              onOpenTask={openTask}
              onToggleGate={toggleGate}
              onAddTimegoal={addTimegoal}
              onRemoveDep={removeDep}
              onOpsMenu={setOpsMenu}
            />
          ))}
        </div>

        {!nodes.length && (
          <div className="dagp-empty">
            {groupMode
              ? '本组还没有带 board 归属的任务。连线可跨项目，对 get 生效。'
              : '这个队列没有任务。连线是编排里唯一的顺序关系；不连就保持默认序。'}
          </div>
        )}
      </div>

      {opsMenu && (
        <PopMenu x={opsMenu.x} y={opsMenu.y} items={opsMenu.items} onClose={() => setOpsMenu(null)} />
      )}
      {dialogNode}
    </div>
  );
}
