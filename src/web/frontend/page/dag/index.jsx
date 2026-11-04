// 编排面板（可视化 DAG）——目录与项目组**共用**同一块面板（任务 #40 验收反馈）。
//
// 形态：画布式节点流。队列序 = 节点纵向位置；依赖边用曲线连出来（SVG 叠加层）。
// 能做的编排动作（全部落到既有 API，语义仍由 DAG 引擎定）：
//   - 拖拽节点 → 改队列顺序（PATCH /api/localtasks/reorder）
//   - 从节点左侧把手拉一条线到另一个节点 → 建立有向依赖（后者等前者，
//     PATCH /api/localtasks/item 的 blockBy）
//   - 节点设闸门（挡住后续）/ 加时间目标（timegoal）/ 打开任务
//   - 没编排过的节点保持原队列序——编排只改被碰过的那几项
//
// 面板按 config.dirKey 定位一个**队列**（topic）：DAG 的排序/依赖/闸门都按队列表达，
// 项目组里的任务分属不同队列，点哪条就编哪条。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useApp } from '../../app-context.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { PopMenu, useDialog } from '../../components/popup/index.jsx';
import { Icon } from '../../components/icons.jsx';
import { titleFromMd } from '../../modules/md/md-parse.js';
import { taskLabel } from '../../components/sidebar/model.js';

const GUTTER = 30; // 左侧走线槽（边画在这里，节点卡片从它右侧开始）

export default function DagPanel({ dirKey, groupId }) {
  const app = useApp() || {};
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const rows = app.rows || [];
  const refreshLocal = app.refreshLocal;

  // 组模式：编排面板按**队列**表达（DAG 的排序/依赖/闸门都是队列内的），
  // 所以组视图进来给一条队列切换带——点哪条队列就编哪条。
  const boards = (app.repoData && app.repoData.boards) || [];
  const board = useMemo(
    () => boards.find((b) => b.id === groupId || b.key === groupId) || null,
    [boards, groupId]
  );
  const queues = useMemo(() => {
    if (!board) return [];
    const out = [];
    for (const m of board.repos || []) {
      const t = rows.find((r) => r.repo && r.repo.key === m.key);
      if (!t) continue;
      const pend = (t.tasks || []).filter((x) => x && !x.deletedAt && !x.migratedTo && x.status !== 'consumed');
      if (!pend.length) continue;
      out.push({ key: t.key, name: m.name || m.key, count: pend.length });
    }
    return out;
  }, [board, rows]);

  const [queueKey, setQueueKey] = useState(dirKey || '');
  const activeKey = queues.some((q) => q.key === queueKey) ? queueKey : (queues[0] && queues[0].key) || dirKey;
  const topic = useMemo(() => rows.find((r) => r.key === activeKey) || null, [rows, activeKey]);
  const pending = useMemo(
    () => (topic?.tasks || []).filter((t) => t && !t.deletedAt && !t.migratedTo && t.status !== 'consumed'),
    [topic]
  );
  const doneCount = useMemo(
    () => (topic?.tasks || []).filter((t) => t && !t.deletedAt && !t.migratedTo && t.status === 'consumed').length,
    [topic]
  );

  // 拖拽排序（HTML5 DnD）：拖拽态走 ref——dragstart/dragover 只隔几毫秒，
  // state 那一拍渲染延迟会让 onDragOver 读到旧值（与目录任务表同一教训）。
  const dragRef = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [dropAt, setDropAt] = useState(null); // { id, zone }

  // 连线（指针事件，与上面的 HTML5 拖拽互不干扰）
  const [linking, setLinking] = useState(null); // { sourceId, overId }
  const [opsMenu, setOpsMenu] = useState(null); // { x, y, items }

  const canvasRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const [edges, setEdges] = useState([]); // [{from,to,x1,y1,x2,y2}]
  const edgeSigRef = useRef(''); // 边集合指纹——没变就不 setState（否则无限渲染）

  // 节点位置 → 边路径（DOM 量出来的，节点一动就重算）
  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const base = canvas.getBoundingClientRect();
    const out = [];
    const pos = new Map();
    for (const [id, el] of nodeRefs.current) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      pos.set(Number(id), {
        left: r.left - base.left,
        midY: r.top - base.top + r.height / 2,
        h: r.height,
      });
    }
    for (const t of pending) {
      const deps = (t.blockBy || []).map(Number);
      for (const d of deps) {
        const a = pos.get(d);
        const b = pos.get(Number(t.id));
        if (!a || !b) continue;
        out.push({ from: d, to: Number(t.id), x1: a.left, y1: a.midY, x2: b.left, y2: b.midY });
      }
    }
    // 边集合没变就别 setState：setEdges 会触发重渲染 → layout effect 再跑 → 再 setEdges，
    // 无限循环（React #185）。指纹相同即视为无变化。
    const sig = out.map((e) => `${e.from}>${e.to}:${Math.round(e.x1)},${Math.round(e.y1)},${Math.round(e.x2)},${Math.round(e.y2)}`).join('|');
    if (sig === edgeSigRef.current) return;
    edgeSigRef.current = sig;
    setEdges(out);
  }, [pending]);

  useLayoutEffect(() => { measure(); });
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const patchTask = async (id, body, okMsg) => {
    try {
      await api('/api/localtasks/item', {
        method: 'PATCH',
        body: { ...(topic?.isGlobal ? { key: topic.key } : { cwd: topic.cwd }), id, ...body },
      });
      toast(okMsg);
      refreshLocal && (await refreshLocal());
    } catch (e) {
      toast(String(e.message || e));
    }
  };

  // ── 拖拽排序 ──
  const movable = (t) => t.status !== 'consumed' && !t.migratedTo && !t.deletedAt;
  const zoneOf = (e, el) => {
    const r = el.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };
  const onDragStart = (e, t) => {
    dragRef.current = { id: Number(t.id) };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'task:' + t.id);
    setDragId(Number(t.id));
  };
  const onDragOver = (e, t) => {
    if (!dragRef.current || !movable(t) || Number(t.id) === dragRef.current.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropAt({ id: Number(t.id), zone: zoneOf(e, e.currentTarget) });
  };
  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropAt(null);
  };
  const onDrop = async (e, t) => {
    e.preventDefault();
    const zone = zoneOf(e, e.currentTarget);
    const drag = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    setDropAt(null);
    if (!drag || !movable(t) || Number(t.id) === drag.id) return;
    try {
      await api('/api/localtasks/reorder', {
        method: 'PATCH',
        body: {
          ...(topic?.isGlobal ? { key: topic.key } : { cwd: topic.cwd }),
          id: drag.id,
          ...(zone === 'before' ? { beforeId: Number(t.id) } : { afterId: Number(t.id) }),
        },
      });
      refreshLocal && (await refreshLocal());
    } catch (err) {
      toast(String(err.message || err));
    }
  };

  // ── 连线：source → target（target 等 source）──
  const startLink = (e, t) => {
    e.preventDefault();
    e.stopPropagation();
    setLinking({ sourceId: Number(t.id), overId: null });
  };
  const hoverNode = (t) => {
    if (!linking) return;
    setLinking((l) => (l ? { ...l, overId: Number(t.id) } : l));
  };
  const finishLink = async (t) => {
    if (!linking) return;
    const src = linking.sourceId;
    const dst = Number(t.id);
    setLinking(null);
    if (!src || src === dst) return;
    const target = pending.find((x) => Number(x.id) === dst);
    const cur = (target?.blockBy || []).map(Number);
    if (cur.includes(src)) {
      toast(`#${dst} 已经等 #${src}`);
      return;
    }
    await patchTask(dst, { blockBy: [...cur, src] }, `#${dst} 现在等 #${src}`);
  };
  const removeDep = async (t, depId) => {
    const cur = (t.blockBy || []).map(Number);
    await patchTask(
      Number(t.id),
      { blockBy: cur.filter((x) => x !== Number(depId)) },
      `#${t.id} 不再等 #${depId}`
    );
  };

  // ── 节点操作 ──
  const toggleGate = (t) =>
    patchTask(
      Number(t.id),
      { gate: !t.blocksFollowing },
      !t.blocksFollowing ? `#${t.id} 设为闸门` : `#${t.id} 取消闸门`
    );

  const addTimegoal = async (t) => {
    const v = await dialog({
      title: `时间目标 · #${t.id}`,
      input: true,
      placeholder: '如 2h / 90m（领取即计时，未到点不许标完成）',
      value: t.timegoal?.duration || '',
    });
    if (v === null || v === undefined) return;
    const duration = String(v).trim();
    if (!duration) {
      await patchTask(Number(t.id), { clearGoal: true }, `#${t.id} 已清除时间目标`);
      return;
    }
    await patchTask(Number(t.id), { duration }, `#${t.id} 时间目标 ${duration}`);
  };

  const openTask = (t) => {
    if (app.openPage) app.openPage({ dirKey, task: String(t.id), name: `#${t.id}` });
  };

  const byId = useMemo(() => new Map(pending.map((t) => [Number(t.id), t])), [pending]);

  return (
    <div className="dagp">
      <div className="dagp-head">
        <span className="dagp-title">{topic?.name || activeKey || '编排'}</span>
        <span className="dagp-count">{pending.length} 个待领取节点{doneCount ? ` · 已领取 ${doneCount}` : ''}</span>
        {queues.length > 1 && (
          <span className="dagp-queues">
            {queues.map((q) => (
              <button
                key={q.key}
                type="button"
                className={'dagp-queue' + (q.key === activeKey ? ' on' : '')}
                title={`${q.name} · ${q.count} 个待领取`}
                onClick={() => setQueueKey(q.key)}
              >
                {q.name}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="dagp-canvas" ref={canvasRef}>
        <svg className="dagp-edges" aria-hidden="true">
          <defs>
            <marker id="dagp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--mdw-accent, #2F6F5E)" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            return (
              <path
                key={`${e.from}-${e.to}-${i}`}
                className={'dagp-edge' + (linking && linking.overId === e.to ? ' hot' : '')}
                d={`M ${e.x1 - 6} ${e.y1} C ${GUTTER - 14} ${e.y1}, ${GUTTER - 14} ${e.y2}, ${e.x2 - 6} ${e.y2}`}
                markerEnd="url(#dagp-arrow)"
              />
            );
          })}
        </svg>

        {pending.map((t) => {
          const id = Number(t.id);
          const deps = (t.blockBy || []).map(Number).filter((d) => byId.has(d));
          const isOver = linking && linking.overId === id;
          return (
            <div
              key={t.id}
              ref={(el) => { if (el) nodeRefs.current.set(id, el); else nodeRefs.current.delete(id); }}
              className={
                'dagp-node'
                + (dragId === id ? ' dragging' : '')
                + (dropAt && dropAt.id === id ? ' drop-' + dropAt.zone : '')
                + (isOver ? ' over' : '')
                + (t.blocksFollowing ? ' gate' : '')
              }
              draggable={movable(t)}
              onDragStart={(e) => onDragStart(e, t)}
              onDragOver={(e) => onDragOver(e, t)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, t)}
              onDragEnd={() => { dragRef.current = null; setDragId(null); setDropAt(null); }}
              onPointerEnter={() => hoverNode(t)}
              onPointerUp={() => finishLink(t)}
            >
              <span
                className="dagp-handle"
                title="从这里拉一条线到另一个节点 = 让它等那个节点"
                onPointerDown={(e) => startLink(e, t)}
              />
              <span className="dagp-no mono">#{t.id}</span>
              <span className="dagp-name" title={t.text} onClick={() => openTask(t)}>
                {titleFromMd(t.text) || taskLabel(t)}
              </span>
              {t.blocksFollowing && <span className="dagp-chip gate">闸门</span>}
              {t.ready === false && <span className="dagp-chip lock">锁定</span>}
              {t.timegoal?.duration && <span className="dagp-chip goal">⏱ {t.timegoal.duration}</span>}
              {deps.map((d) => (
                <span key={d} className="dagp-chip dep" title={`等 #${d} 完成`}>
                  等 #{d}
                  <i role="button" aria-label={`解除对 #${d} 的依赖`} onClick={(e) => { e.stopPropagation(); removeDep(t, d); }}>×</i>
                </span>
              ))}
              <button
                type="button"
                className="dagp-ops"
                title="节点操作"
                aria-label="节点操作"
                onClick={(e) => {
                  e.stopPropagation();
                  // PopMenu 的条目回调是 **onClick**（RowMenu 才是 onPick——写错会静默无反应）
                  const items = [
                    { label: '打开任务', onClick: () => openTask(t) },
                    {
                      label: t.blocksFollowing ? '取消闸门' : '设为闸门（挡住后续）',
                      onClick: () => toggleGate(t),
                    },
                    { label: t.timegoal?.duration ? '改时间目标' : '加时间目标（timegoal）', onClick: () => addTimegoal(t) },
                  ];
                  const r = e.currentTarget.getBoundingClientRect();
                  setOpsMenu({ x: r.left, y: r.bottom, items });
                }}
              >
                <Icon name="dots" size={13} />
              </button>
            </div>
          );
        })}

        {!pending.length && <div className="dagp-empty">这个队列没有待领取任务。</div>}
      </div>

      {opsMenu && <PopMenu x={opsMenu.x} y={opsMenu.y} items={opsMenu.items} onClose={() => setOpsMenu(null)} />}
      {dialogNode}
    </div>
  );
}
