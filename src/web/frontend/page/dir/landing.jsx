// 目录落地页 = 简介 + 任务面板。
// 简介由统一组件 Introduction 负责（与项目组同构：显示 / 编辑 / 补 ref）。
//
// 任务面板（#164）：外壳与行组件与项目组页共用（components/task-panel，
// 以组面板行结构为准）——待领取行拖动排序（拖把手）、行尾操作（编排菜单 /
// 反馈 / 删除）、多选批量条、状态统一为 StatusTag 全称药丸（原单字徽标
// 等/跑/完/档 收口）。分页与计数由容器（page/dir/index.jsx）算好传进来。
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/icons.jsx';
import Introduction from '../../components/Introduction/index.jsx';
import Pager from '../../components/pager.jsx';
import { RowMenu } from '../../components/popup/index.jsx';
import ToolActsBar from '../../components/tool-acts/bar.jsx';
import TaskPanel from '../../components/task-panel/index.jsx';
import TaskRow from '../../components/task-panel/task-row.jsx';
import { taskLabel } from '../../components/sidebar/model.js';

export default function Landing({
  isGlobal,
  topic,
  repo = null,
  model = null,
  tasks = [],
  taskCount = 0,
  pendingCount = 0,
  page = 0,
  pageCount = 1,
  onPage,
  onNew,
  onOpenTask,
  onDeleteTask,
  onDeleteTasks,     // (ids) 批量删除选中任务
  onCancelTasks,     // (ids) 批量取消选中待领取任务
  onCompleteTasks,   // (ids) 批量把选中待领取任务标为完成
  onReopenTask,
  onTplMenu,
  onImport,
  onProg,
  onMoveTask,      // (t, targetId, 'before'|'after') 拖动排序落盘
  onOpenDag,       // (t) 打开编排编辑器
  onOpenFlow,      // () 打开可视化编排面板
  onToggleGate,    // (t) 闸门快捷开关
  downstreamOf,    // { [gateTaskId]: number[] } 闸门挡住的后续任务 id
  onDeleted,       // () 打开已删除任务面板（#139 工具编排）
  onRefs,          // () 打开文档列表右侧栏
  deletedCount = 0 // 已软删任务数（「更多」角标提示）
}) {
  const name = isGlobal ? '全局池' : (topic?.name || '目录');
  const path = isGlobal ? '共享池（无固定目录）' : (topic?.cwd || '—');
  const status = String(topic?.summary || '').trim();

  // 拖动排序（HTML5 DnD）：只在待领取行之间换位，落点 = 上半行之前 / 下半行之后。
  // 拖拽态走 **ref**（同步可读）——dragstart/dragover 在真实拖拽里也只隔几毫秒，
  // state 那一拍渲染延迟会让 onDragOver 读到旧值直接 return（与侧栏 drag.js 同一教训）。
  const dragRef = useRef(null);               // { id }
  const [dragId, setDragId] = useState(null); // 仅视觉：正在拖的行
  const [dropAt, setDropAt] = useState(null); // 仅视觉：{ id, zone }
  const [picked, setPicked] = useState(() => new Set()); // 多选：任务 id 集合

  // 翻页后清空选择，避免批量操作跨页误伤看不到的行
  useEffect(() => {
    setPicked(new Set());
  }, [page]);

  const pageIds = tasks.map((t) => Number(t.id));
  const allPicked = pageIds.length > 0 && pageIds.every((id) => picked.has(id));
  const pickedTasks = tasks.filter((t) => picked.has(Number(t.id)));
  // 取消/标为完成只对待领取生效；已领取/已交付/已取消由后端跳过
  const closableTasks = pickedTasks.filter(
    (t) => t.status === 'pending' && !t.migratedTo && !t.deletedAt
  );
  const togglePick = (id) => {
    const want = Number(id);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(want)) next.delete(want);
      else next.add(want);
      return next;
    });
  };
  const togglePickAll = () => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allPicked) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const runBatch = async (kind) => {
    const ids = [...picked];
    const fn =
      kind === 'cancel' ? onCancelTasks : kind === 'complete' ? onCompleteTasks : onDeleteTasks;
    if (!ids.length || !fn) return;
    const ok = await fn(ids);
    if (ok) setPicked(new Set());
  };
  // 只有待领取行能拖动调序（已领取/已交付/已取消都是固定历史）
  const movable = (t) => t.status === 'pending' && !t.migratedTo && !t.deletedAt;
  const zoneOf = (e, tr) => {
    const r = tr.getBoundingClientRect();
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
    // 行内 td 之间移动也会触发 dragleave：只有真正离开整行才清指示
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropAt(null);
  };
  const onDrop = (e, t) => {
    e.preventDefault();
    const zone = zoneOf(e, e.currentTarget);
    const drag = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    setDropAt(null);
    if (!drag || !movable(t) || Number(t.id) === drag.id) return;
    onMoveTask && onMoveTask({ id: drag.id }, t.id, zone);
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setDragId(null);
    setDropAt(null);
  };

  return (
    // 根容器与项目组页同款（rp-page：无底色差、同内距、flex gap）——#164 验收反馈
    // 「两种 ui 仍然不一，比如工具区、背景等」：外壳向 group 页看齐。
    <div className="rp-page">
      <RouteBreadcrumb />
      {/* 头部 = group 同构：h2（图标 + 名字 + 计数 chips）+ 右对齐工具区 */}
      <div className="rp-group-head">
        <h2>
          <Icon name="folder" size={15} /> {name}
          <span className="rp-chip-count">{taskCount} 个任务</span>
          {pendingCount > 0 ? <span className="rp-chip-count">{pendingCount} 待领取</span> : null}
        </h2>
        <div className="rp-group-acts">
          {/* #139：工具区可编排（顺序 / 显隐；隐藏收入「更多」） */}
          <ToolActsBar
            kind="dir"
            labels={{
              more: deletedCount > 0 ? `更多 (${deletedCount})` : '更多',
              deleted: deletedCount > 0 ? `已删除任务（${deletedCount}）` : '已删除任务',
            }}
            titles={{
              new: '按默认模板新建一页（▾ 选模板）',
              import: '把一个 .md 文件导入成任务',
              progress: '打开这个目录的进程面板',
              more: deletedCount > 0 ? `更多操作（含 ${deletedCount} 条已删除任务）` : '更多操作',
              deleted: '查看并恢复已删除任务',
              refs: '查看文档 / reference 列表',
            }}
            renderers={{
              // #161 新建按钮拆两级（视觉一颗按钮、命中区两层）：
              //   主区点击 = 按默认模板直接新建；内嵌箭头 = 模板下拉（tplMenuItems）
              new: () => (
                <span className="rp-newtask">
                  <button
                    type="button"
                    className="btn small primary"
                    title="按默认模板新建一页（▾ 选模板）"
                    onClick={() => onNew()}
                  >
                    ＋ 新建页
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="选择模板新建一页"
                      aria-haspopup="menu"
                      className="rp-newtask-caret"
                      title="选择模板新建一页"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTplMenu?.(e);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          onTplMenu?.(e);
                        }
                      }}
                    >
                      <Icon name="chevron" size={11} />
                    </span>
                  </button>
                </span>
              ),
            }}
            actions={{
              new: onNew,
              import: onImport,
              progress: onProg,
              orch: onOpenFlow,
              deleted: onDeleted,
              refs: onRefs,
            }}
          />
        </div>
        {/* 路径与现状：group 页没有的目录特有信息，弱化成一行小字放头部末尾 */}
        <div className="mdw-land-meta">
          <span className="mdw-land-path mono" title={path}>{path}</span>
          {status ? (
            <span className="mdw-land-status mono" title={status}>现状：{status}</span>
          ) : null}
        </div>
      </div>

      {!isGlobal && repo ? <Introduction kind="repo" owner={repo} model={model} /> : null}

      {pickedTasks.length > 0 && (
        <div className="mdw-land-batch">
          <span className="mdw-land-batch-count">已选 {pickedTasks.length} 条</span>
          {onCompleteTasks && (
            <button
              type="button"
              className="btn ghost sm"
              disabled={!closableTasks.length}
              title={
                closableTasks.length
                  ? '把选中的待领取任务标为已完成（补一条完成记录，原文留档）'
                  : '只有待领取任务可以直接标为完成'
              }
              onClick={() => runBatch('complete')}
            >
              标为完成选中{closableTasks.length ? ` (${closableTasks.length})` : ''}
            </button>
          )}
          {onCancelTasks && (
            <button
              type="button"
              className="btn ghost sm"
              disabled={!closableTasks.length}
              title={
                closableTasks.length
                  ? '把选中的待领取任务标为已取消（终态，原文留档）'
                  : '只有待领取任务可以取消'
              }
              onClick={() => runBatch('cancel')}
            >
              取消选中{closableTasks.length ? ` (${closableTasks.length})` : ''}
            </button>
          )}
          {onDeleteTasks && (
            <button type="button" className="btn ghost sm danger" onClick={() => runBatch('delete')}>
              删除选中 ({pickedTasks.length})
            </button>
          )}
          <button type="button" className="btn ghost sm" onClick={() => setPicked(new Set())}>
            清空
          </button>
        </div>
      )}

      {/* 任务面板（#164 共享组件）：行结构 / 状态药丸与项目组页一致。
          当前页行不拆段（分页语义由容器负责）；全选在面板头右侧。 */}
      <TaskPanel
        title={isGlobal ? '全局池任务' : '任务'}
        pendingCount={pendingCount}
        headerExtra={
          tasks.length ? (
            <label className="rp-proj-pickall" title="全选/取消全选当前页">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={togglePickAll}
                aria-label="全选当前页任务"
              />
              全选本页
            </label>
          ) : null
        }
        emptyText={`还没有页面：点「＋ 新建页」写第一篇，或让 agent 往${isGlobal ? '全局池' : '这个目录'}投递任务。`}
      >
        {tasks.map((t) => {
          const movableRow = movable(t);
          const downs = (downstreamOf && downstreamOf[t.id]) || [];
          return (
            <TaskRow
              key={t.id}
              t={t}
              selectable
              picked={picked.has(Number(t.id))}
              onTogglePick={togglePick}
              draggable={movableRow}
              dragHandlers={
                movableRow
                  ? {
                      onDragStart: (e) => onDragStart(e, t),
                      onDragOver: (e) => onDragOver(e, t),
                      onDragLeave: onDragLeave,
                      onDrop: (e) => onDrop(e, t),
                      onDragEnd: onDragEnd,
                    }
                  : null
              }
              dragVisual={{
                dragging: dragId === Number(t.id),
                drop: dropAt && dropAt.id === Number(t.id) ? dropAt.zone : null,
              }}
              showTimes
              downs={downs}
              onOpen={(row) => onOpenTask(row.id)}
              ops={
                <>
                  {movableRow && (onOpenDag || onToggleGate) && (
                    <RowMenu
                      items={[
                        { label: '编排依赖…', onPick: () => onOpenDag && onOpenDag(t) },
                        {
                          label: t.blocksFollowing ? '取消闸门（不再挡后续）' : '设为闸门（挡住后续）',
                          onPick: () => onToggleGate && onToggleGate(t),
                        },
                      ]}
                    />
                  )}
                  {/* #144 反馈只在链尖：已有派生子任务（后续轮次/评论派生）的任务
                      不再给反馈入口——在旧轮次上反馈会把链分叉 */}
                  {onReopenTask && t.status !== 'cancelled' && !t.childCount && (t.status === 'claimed' || t.status === 'done' || t.completedAt) && (
                    <span
                      className="op" role="button" tabIndex={-1}
                      title={t.completedAt ? '反馈：新开一条任务（原任务不动）' : '反馈修改：回写本任务并记入任务链'}
                      aria-label={`反馈 ${taskLabel(t)}`}
                      onClick={() => onReopenTask(t)}
                    >
                      <Icon name="refresh" size={12} />
                    </span>
                  )}
                  {onDeleteTask && (
                    <span
                      className="op danger" role="button" tabIndex={-1}
                      title="删除此任务（软删除，CLI 可恢复）"
                      aria-label={`删除 ${taskLabel(t)}`}
                      onClick={() => onDeleteTask(t)}
                    >
                      <Icon name="x" size={12} />
                    </span>
                  )}
                </>
              }
            />
          );
        })}
      </TaskPanel>

      {/* 队列长了翻页看（以前一次渲染全部，队列一长就是一堵墙） */}
      {taskCount > 0 && (
        <div className="mdw-land-pager">
          <Pager
            page={page}
            pageCount={pageCount}
            total={taskCount}
            onPage={onPage}
            unit="个任务"
          />
        </div>
      )}
    </div>
  );
}
