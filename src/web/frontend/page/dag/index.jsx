// 编排面板（可视化 DAG）——目录与项目组共用。
//
// 顺序语义：
//   - 只有有向连线表达先后（blockBy：A→B = B 等 A）
//   - 未连线 = 无编排序，走各队列默认序
//   - 拖节点只改摆位，不 reorder
//
// 组模式（groupId）：一次展示组内全部任务；跨项目边落盘为 "topicKey:id"，对 get 生效。
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useApp } from '../../app-context.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { PopMenu, useDialog } from '../../components/popup/index.jsx';
import { Icon } from '../../components/icons.jsx';
import { parseFrontmatter, titleFromMd } from '../../modules/md/md-parse.js';
import { isGroupTask } from '../../modules/board/board-view.js';
import { taskLabel } from '../../components/sidebar/model.js';
import { reaches } from '../../../../shared/graph.js';

const NODE_W = 280;
const NODE_GAP_Y = 22;
const PAD_X = 56;
const PAD_Y = 28;
const COL_GAP = 320;
const DRAG_THRESH = 6;
const FILTER_ALL = '';

function isAlive(t) {
  return t && !t.deletedAt && !t.migratedTo;
}
function isPending(t) {
  return isAlive(t) && t.status !== 'consumed';
}
function labelOf(t) {
  return titleFromMd(t.text) || taskLabel(t) || `#${t.id}`;
}
function nodeKeyOf(topicKey, id) {
  return `${topicKey}:${Number(id)}`;
}
/** @returns {{ kind:'local', id:number } | { kind:'foreign', key:string, id:number } | null} */
function parseDep(x) {
  if (typeof x === 'number' && Number.isFinite(x) && x > 0) return { kind: 'local', id: Math.trunc(x) };
  const s = String(x ?? '').trim();
  if (!s) return null;
  const m = /^([A-Za-z0-9_-]+):(\d+)$/.exec(s);
  if (m) return { kind: 'foreign', key: m[1], id: Number(m[2]) };
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n > 0) return { kind: 'local', id: n };
  }
  return null;
}
function depToNodeKey(dep, ownerTopicKey) {
  const ref = parseDep(dep);
  if (!ref) return null;
  if (ref.kind === 'foreign') return nodeKeyOf(ref.key, ref.id);
  return nodeKeyOf(ownerTopicKey, ref.id);
}
function formatDepForTarget(sourceNode, targetTopicKey) {
  if (sourceNode.topicKey === targetTopicKey) return Number(sourceNode.id);
  return nodeKeyOf(sourceNode.topicKey, sourceNode.id);
}

function defaultLayout(nodes) {
  // 按 topic 分列，列内按原序纵向
  const byTopic = new Map();
  for (const n of nodes) {
    if (!byTopic.has(n.topicKey)) byTopic.set(n.topicKey, []);
    byTopic.get(n.topicKey).push(n);
  }
  const pos = new Map();
  let col = 0;
  for (const [, list] of byTopic) {
    list.forEach((n, i) => {
      pos.set(n.nodeKey, {
        x: PAD_X + col * COL_GAP,
        y: PAD_Y + i * (72 + NODE_GAP_Y),
      });
    });
    col += 1;
  }
  return pos;
}

function cubic(x1, y1, x2, y2) {
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function canvasPoint(canvas, clientX, clientY) {
  const base = canvas.getBoundingClientRect();
  return {
    x: clientX - base.left + canvas.scrollLeft,
    y: clientY - base.top + canvas.scrollTop,
  };
}

export default function DagPanel({ dirKey, groupId }) {
  const app = useApp() || {};
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

  const queues = useMemo(() => {
    if (!board) return [];
    const out = [];
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
  const nodes = useMemo(() => {
    if (groupMode) {
      const boardIds = [board.id, board.key, board.name].filter(Boolean);
      const out = [];
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
    return (dirTopic.tasks || []).filter((task) => isPending(task) && !isGroupTask(task)).map((task) => ({
      ...task,
      topicKey: dirTopic.key,
      topicCwd: dirTopic.cwd,
      topicIsGlobal: !!dirTopic.isGlobal,
      projectName: dirTopic.name || dirTopic.key,
      nodeKey: nodeKeyOf(dirTopic.key, task.id),
    }));
  }, [groupMode, board, rows, filterKey, dirTopic]);

  const byNodeKey = useMemo(() => new Map(nodes.map((n) => [n.nodeKey, n])), [nodes]);
  const byNodeKeyRef = useRef(byNodeKey);
  byNodeKeyRef.current = byNodeKey;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const canvasRef = useRef(null);
  const [pos, setPos] = useState(() => new Map());
  const posRef = useRef(pos);
  posRef.current = pos;
  const layoutSigRef = useRef('');

  useEffect(() => {
    const sig = nodes.map((n) => n.nodeKey).join('|') + '#' + (groupMode ? filterKey || 'ALL' : dirKey || '');
    const switched = layoutSigRef.current.split('#')[0] !== sig.split('#')[0]
      || layoutSigRef.current.split('#')[1] !== sig.split('#')[1];
    layoutSigRef.current = sig;
    setPos((prev) => {
      const next = new Map();
      const fresh = defaultLayout(nodes);
      for (const n of nodes) {
        next.set(
          n.nodeKey,
          !switched && prev.has(n.nodeKey) ? prev.get(n.nodeKey) : (fresh.get(n.nodeKey) || { x: PAD_X, y: PAD_Y }),
        );
      }
      return next;
    });
  }, [nodes, groupMode, filterKey, dirKey]);

  const modeRef = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [linking, setLinking] = useState(null);
  const [opsMenu, setOpsMenu] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const commitRef = useRef(async () => false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const patchNode = async (node, body, okMsg) => {
    setBusy(true);
    try {
      const payload = { ...body };
      if (Array.isArray(payload.blockBy)) payload.blockBy = payload.blockBy.join(',');
      const scope = node.topicIsGlobal ? { key: node.topicKey } : { cwd: node.topicCwd };
      await api('/api/localtasks/item', {
        method: 'PATCH',
        body: { ...scope, id: Number(node.id), ...payload },
      });
      if (okMsg) toast(okMsg);
      refreshLocal && (await refreshLocal());
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const hitNodeAt = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const { x, y } = canvasPoint(canvas, clientX, clientY);
    const list = nodesRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const nk = list[i].nodeKey;
      const p = posRef.current.get(nk);
      if (!p) continue;
      const el = canvas.querySelector(`[data-node-id="${CSS.escape(nk)}"]`);
      const h = el ? el.offsetHeight : 64;
      if (x >= p.x - 10 && x <= p.x + NODE_W + 28 && y >= p.y - 6 && y <= p.y + h + 6) return nk;
    }
    return null;
  };

  const portOrigin = (nk) => {
    const canvas = canvasRef.current;
    const p = posRef.current.get(nk) || { x: 0, y: 0 };
    const el = canvas?.querySelector(`[data-node-id="${CSS.escape(nk)}"]`);
    const h = el ? el.offsetHeight : 64;
    return { x: p.x + NODE_W, y: p.y + h / 2 };
  };

  const publishLink = (m) => {
    if (!m || m.kind !== 'link') {
      setLinking(null);
      return;
    }
    setLinking({
      sourceId: m.sourceId,
      x: m.x1,
      y: m.y1,
      cx: m.cx,
      cy: m.cy,
      overId: m.overId,
      dragged: !!m.dragged,
    });
  };

  const clearMode = () => {
    modeRef.current = null;
    setDragId(null);
    setLinking(null);
  };

  const tryCommitLink = async (srcKey, dstKey) => {
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
    const already = cur.some((d) => {
      const a = parseDep(d);
      const b = parseDep(edgeToken);
      if (!a || !b) return false;
      if (a.kind !== b.kind) return false;
      if (a.kind === 'local') return a.id === b.id;
      return a.key === b.key && a.id === b.id;
    });
    if (already) {
      toastRef.current(`已有该有向边`);
      return false;
    }
    // 环检测：在可见节点图上沿 blockBy（含跨队列）走——实现下沉 src/shared/graph.js，
    // 与 mutator.addEdge（wouldCycleAfterLink）同一份 DFS。
    const depsOf = (nk) => {
      const n = byNodeKeyRef.current.get(nk);
      if (!n) return [];
      const out = [];
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

  useEffect(() => {
    const onMove = (e) => {
      const m = modeRef.current;
      if (!m) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const pt = canvasPoint(canvas, e.clientX, e.clientY);
      if (m.kind === 'drag') {
        const x = Math.max(8, pt.x - m.ox);
        const y = Math.max(8, pt.y - m.oy);
        setPos((prev) => {
          const next = new Map(prev);
          next.set(m.id, { x, y });
          return next;
        });
        return;
      }
      if (m.kind === 'link') {
        const over = hitNodeAt(e.clientX, e.clientY);
        const overId = over && over !== m.sourceId ? over : null;
        const dist = Math.hypot(pt.x - m.sx, pt.y - m.sy);
        const dragged = m.dragged || dist >= DRAG_THRESH;
        const next = { ...m, cx: pt.x, cy: pt.y, overId, dragged };
        modeRef.current = next;
        publishLink(next);
      }
    };
    const onUp = async (e) => {
      const m = modeRef.current;
      if (!m) return;
      if (m.kind === 'drag') {
        clearMode();
        return;
      }
      if (m.kind === 'link') {
        const dst = m.overId || hitNodeAt(e.clientX, e.clientY);
        const src = m.sourceId;
        if (dst && dst !== src) {
          clearMode();
          await commitRef.current(src, dst);
          return;
        }
        if (m.dragged) {
          clearMode();
          return;
        }
        const srcNode = byNodeKeyRef.current.get(src);
        toastRef.current(`已选 #${srcNode?.id ?? src}，再点目标画出有向边`);
      }
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') clearMode();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('pointercancel', clearMode);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointercancel', clearMode);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const startDrag = (e, n) => {
    if (busyRef.current) return;
    if (e.button !== 0) return;
    if (e.target.closest('.dagp-port, .dagp-ops, .dagp-chip, button, a')) return;
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

  const startLink = (e, n) => {
    if (busyRef.current || !isPending(n)) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (modeRef.current?.kind === 'link' && modeRef.current.sourceId === n.nodeKey) {
      clearMode();
      return;
    }
    const o = portOrigin(n.nodeKey);
    const canvas = canvasRef.current;
    const pt = canvas ? canvasPoint(canvas, e.clientX, e.clientY) : { x: o.x, y: o.y };
    const state = {
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

  const onCanvasPointerDown = (e) => {
    if (!modeRef.current || modeRef.current.kind !== 'link') return;
    if (e.target.closest('.dagp-node')) return;
    clearMode();
  };

  const removeDep = async (n, depToken) => {
    const cur = [...(n.blockBy || [])];
    const next = cur.filter((d) => {
      const a = parseDep(d);
      const b = parseDep(depToken);
      if (!a || !b) return String(d) !== String(depToken);
      if (a.kind !== b.kind) return true;
      if (a.kind === 'local') return a.id !== b.id;
      return !(a.key === b.key && a.id === b.id);
    });
    await patchNode(n, { blockBy: next }, `已解除依赖 → #${n.id}`);
  };

  const toggleGate = (n) =>
    patchNode(n, { gate: !n.blocksFollowing }, !n.blocksFollowing ? `#${n.id} 设为闸门` : `#${n.id} 取消闸门`);

  const addTimegoal = async (n) => {
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

  const openTask = (n) => {
    if (app.openPage) app.openPage({ dirKey: n.topicKey, task: String(n.id), name: `#${n.id}` });
  };

  const edges = useMemo(() => {
    const out = [];
    for (const n of nodes) {
      const b = pos.get(n.nodeKey);
      if (!b) continue;
      const elTo = canvasRef.current?.querySelector(`[data-node-id="${CSS.escape(n.nodeKey)}"]`);
      const hTo = elTo ? elTo.offsetHeight : 64;
      for (const d of n.blockBy || []) {
        const fromKey = depToNodeKey(d, n.topicKey);
        if (!fromKey || !byNodeKey.has(fromKey)) continue;
        const a = pos.get(fromKey);
        if (!a) continue;
        const elFrom = canvasRef.current?.querySelector(`[data-node-id="${CSS.escape(fromKey)}"]`);
        const hFrom = elFrom ? elFrom.offsetHeight : 64;
        out.push({
          from: fromKey,
          to: n.nodeKey,
          x1: a.x + NODE_W,
          y1: a.y + hFrom / 2,
          x2: b.x,
          y2: b.y + hTo / 2,
        });
      }
    }
    return out;
  }, [nodes, pos, byNodeKey, dragId, linking]);

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

  const linkArmed = !!linking;
  const srcLabel = linking
    ? (byNodeKey.get(linking.sourceId)?.id ?? linking.sourceId)
    : '';

  return (
    <div className={'dagp' + (linkArmed ? ' is-linking' : '') + (dragId != null ? ' is-dragging' : '')}>
      <div className="dagp-head">
        <span className="dagp-title">{title}</span>
        <span className="dagp-count">{nodes.length} 个待领取节点</span>
        <span className="dagp-hint">
          {linkArmed
            ? `连线中：再点目标完成 #${srcLabel} → 目标（Esc 取消）`
            : groupMode
              ? '组内全量任务；跨项目连线对 get 生效；未连线走各队列默认序'
              : '点右侧 ● 再点目标 = 有向顺序；未连线 = 无先后、走默认序'}
        </span>
        {groupMode && queues.length > 0 && (
          <span className="dagp-queues">
            <button
              type="button"
              className={'dagp-queue' + (filterKey === FILTER_ALL ? ' on' : '')}
              onClick={() => setFilterKey(FILTER_ALL)}
            >
              全部
              <i>{queues.reduce((s, q) => s + q.total, 0)}</i>
            </button>
            {queues.map((q) => (
              <button
                key={q.key}
                type="button"
                className={'dagp-queue' + (q.key === filterKey ? ' on' : '')}
                title={`${q.name} · ${q.count}/${q.total}`}
                onClick={() => setFilterKey(q.key)}
              >
                {q.name}
                <i>{q.count}</i>
              </button>
            ))}
          </span>
        )}
      </div>

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
          {nodes.map((n) => {
            const p = pos.get(n.nodeKey) || { x: PAD_X, y: PAD_Y };
            const depEntries = (n.blockBy || [])
              .map((d) => ({ token: d, key: depToNodeKey(d, n.topicKey) }))
              .filter((x) => x.key && byNodeKey.has(x.key));
            const isOver = linking && linking.overId === n.nodeKey;
            const isSrc = linking && linking.sourceId === n.nodeKey;
            return (
              <div
                key={n.nodeKey}
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
                onPointerDown={(e) => startDrag(e, n)}
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
                          { label: '打开任务', onClick: () => openTask(n) },
                          {
                            label: n.blocksFollowing ? '取消闸门' : '设为闸门（挡住后续）',
                            onClick: () => toggleGate(n),
                          },
                          {
                            label: n.timegoal?.duration ? '改时间目标' : '加时间目标（timegoal）',
                            onClick: () => addTimegoal(n),
                          },
                        ];
                        const r = e.currentTarget.getBoundingClientRect();
                        setOpsMenu({ x: r.left, y: r.bottom, items });
                      }}
                    >
                      <Icon name="dots" size={13} />
                    </button>
                  </div>
                  <div
                    className="dagp-name"
                    title={n.text}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openTask(n);
                    }}
                  >
                    {labelOf(n)}
                  </div>
                  {depEntries.length > 0 && (
                    <div className="dagp-deps">
                      {depEntries.map(({ token, key }) => {
                        const src = byNodeKey.get(key);
                        const cross = src && src.topicKey !== n.topicKey;
                        return (
                          <span
                            key={String(token)}
                            className="dagp-chip dep"
                            title={cross ? `跨项目 #${src.id}@${src.projectName} → #${n.id}` : `#${src?.id} → #${n.id}`}
                          >
                            ← #{src?.id}{cross ? `@${src.projectName}` : ''}
                            <i
                              role="button"
                              aria-label="解除依赖"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeDep(n, token);
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
                  onPointerDown={(e) => startLink(e, n)}
                />
              </div>
            );
          })}
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
