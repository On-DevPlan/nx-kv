// 目录落地页 = 简介 + 任务面板。
// 简介由统一组件 Introduction 负责（与项目组同构：显示 / 编辑 / 补 ref）。
//
// 任务面板（#164）：外壳与行组件与项目组页共用（components/task-panel，
// 以组面板行结构为准）——待领取行拖动排序（拖把手）、行尾操作（编排菜单 /
// 反馈 / 删除）、多选批量条、状态统一为 StatusTag 全称药丸（原单字徽标
// 等/跑/完/档 收口）。分页与计数由容器（page/dir/index.jsx）算好传进来。
// #167 三轮：去面包屑（group 页没有，返回导航走左侧树）。
import { useEffect, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, ReactNode } from 'react';
import type { Model } from 'flexlayout-react';
import { Icon } from '../../components/icons.jsx';
import Introduction from '../../components/Introduction/index.jsx';
import Pager from '../../components/pager.jsx';
import { RowMenu } from '../../components/popup/index.jsx';
import ToolActsBar from '../../components/tool-acts/bar.jsx';
import TaskPanel from '../../components/task-panel/index.jsx';
import TaskPanelLayoutRaw from '../../components/task-panel/layout.jsx';
import TaskRow from '../../components/task-panel/task-row.jsx';
import { taskLabel } from '../../components/sidebar/model.js';
import type { LocalTask, LocalTopic, RepoRow } from '../../types.js';

/** 拖动落点：行上半 = 之前，下半 = 之后。 */
type DropZone = 'before' | 'after';

/**
 * 共享布局组件的槽位默认值（[] / null）让 TS 把它们推断成 never[] / null
 * （components/task-panel/layout.tsx 尚未类型化完）；这里按实际契约声明一次。
 */
interface TaskPanelLayoutProps {
  name: string;
  counts?: Array<string | { text?: string }>;
  icon?: string;
  actions?: ReactNode;
  intro?: ReactNode;
  batch?: ReactNode;
  list?: ReactNode;
  footer?: ReactNode;
  extra?: ReactNode;
}
const TaskPanelLayout = TaskPanelLayoutRaw as unknown as (props: TaskPanelLayoutProps) => ReactNode;

/**
 * 同上的推断问题：TaskPanel 的 `children = null` / TaskRow 的 `dragHandlers = null`、
 * `downs = []`、`ops = null` 都被推断成 null / never[]。按实际契约声明一次。
 */
interface TaskPanelBoxProps {
  icon?: string;
  title: string;
  pendingCount?: number;
  headerExtra?: ReactNode;
  children?: ReactNode;
  emptyText?: string;
}
const TaskPanelBox = TaskPanel as unknown as (props: TaskPanelBoxProps) => ReactNode;

interface TaskRowProps {
  t: LocalTask;
  projectTag?: string;
  projectTitle?: string;
  selectable?: boolean;
  picked?: boolean;
  onTogglePick?: (id: number | string) => void;
  draggable?: boolean;
  dragHandlers?: Record<string, (e: ReactDragEvent<HTMLElement>) => void> | null;
  dragVisual?: { dragging?: boolean; drop?: DropZone | null } | null;
  onOpen?: (row: LocalTask) => void;
  showTimes?: boolean;
  downs?: number[];
  history?: boolean;
  ops?: ReactNode;
}
const TaskRowBox = TaskRow as unknown as (props: TaskRowProps) => ReactNode;

interface LandingProps {
  isGlobal: boolean;
  topic: LocalTopic | null;
  repo?: RepoRow | null;
  model?: Model | null;
  tasks?: LocalTask[];
  taskCount?: number;
  pendingCount?: number;
  page?: number;
  pageCount?: number;
  onPage?: (page: number) => void;
  onNew: () => void;
  onOpenTask: (id: number | string) => void;
  onDeleteTask?: (t: LocalTask) => void;
  /** (ids) 批量删除选中任务 */
  onDeleteTasks?: (ids: number[]) => Promise<unknown>;
  /** (ids) 批量取消选中待领取任务 */
  onCancelTasks?: (ids: number[]) => Promise<unknown>;
  /** (ids) 批量把选中待领取任务标为完成 */
  onCompleteTasks?: (ids: number[]) => Promise<unknown>;
  onReopenTask?: (t: LocalTask) => void;
  /** 模板菜单的锚点（click 与 Enter/Space 都会调；只有鼠标事件带坐标） */
  onTplMenu?: (e: { type: string; clientX?: number; clientY?: number }) => void;
  onImport?: () => void;
  onProg?: () => void;
  /** (t, targetId, 'before'|'after') 拖动排序落盘 */
  onMoveTask?: (t: { id: number }, targetId: number | string, zone: DropZone) => void;
  /** (t) 打开编排编辑器 */
  onOpenDag?: (t: LocalTask) => void;
  /** () 打开可视化编排面板 */
  onOpenFlow?: () => void;
  /** (t) 闸门快捷开关 */
  onToggleGate?: (t: LocalTask) => void;
  /** { [gateTaskId]: number[] } 闸门挡住的后续任务 id */
  downstreamOf?: Record<string, number[]>;
  /** () 打开文档列表右侧栏 */
  onRefs?: () => void;
  /** 搜索串（#181：标题 + 正文模糊匹配） */
  q?: string;
  /** (v) 改搜索串 */
  onQuery?: (v: string) => void;
}

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
  onRefs,          // () 打开文档列表右侧栏
  q = '',          // 搜索串（标题 + 正文模糊匹配）
  onQuery,         // (v) 改搜索串
}: LandingProps) {
  const name = isGlobal ? '全局池' : (topic?.name || '目录');
  const searching = !!String(q).trim();

  // 拖动排序（HTML5 DnD）：只在待领取行之间换位，落点 = 上半行之前 / 下半行之后。
  // 拖拽态走 **ref**（同步可读）——dragstart/dragover 在真实拖拽里也只隔几毫秒，
  // state 那一拍渲染延迟会让 onDragOver 读到旧值直接 return（与侧栏 drag.js 同一教训）。
  const dragRef = useRef<{ id: number } | null>(null);   // { id }
  const [dragId, setDragId] = useState<number | null>(null); // 仅视觉：正在拖的行
  const [dropAt, setDropAt] = useState<{ id: number; zone: DropZone } | null>(null); // 仅视觉：{ id, zone }
  const [picked, setPicked] = useState<Set<number>>(() => new Set()); // 多选：任务 id 集合

  // 翻页后清空选择，避免批量操作跨页误伤看不到的行
  useEffect(() => {
    setPicked(new Set());
  }, [page]);

  const pageIds = tasks.map((t) => Number(t.id));
  const allPicked = pageIds.length > 0 && pageIds.every((id) => picked.has(id));
  const pickedTasks = tasks.filter((t) => picked.has(Number(t.id)));
  // 取消/标为完成只对待领取生效；已领取/已完成/已取消由后端跳过
  const closableTasks = pickedTasks.filter(
    (t) => t.status === 'pending' && !t.migratedTo && !t.deletedAt
  );
  const togglePick = (id: number | string) => {
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
  const runBatch = async (kind: string) => {
    const ids = [...picked];
    const fn =
      kind === 'cancel' ? onCancelTasks : kind === 'complete' ? onCompleteTasks : onDeleteTasks;
    if (!ids.length || !fn) return;
    const ok = await fn(ids);
    if (ok) setPicked(new Set());
  };
  // 只有待领取行能拖动调序（已领取/已完成/已取消都是固定历史）
  const movable = (t: LocalTask) => t.status === 'pending' && !t.migratedTo && !t.deletedAt;
  const zoneOf = (e: ReactDragEvent<HTMLElement>, tr: HTMLElement): DropZone => {
    const r = tr.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };
  const onDragStart = (e: ReactDragEvent<HTMLElement>, t: LocalTask) => {
    dragRef.current = { id: Number(t.id) };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'task:' + t.id);
    setDragId(Number(t.id));
  };
  const onDragOver = (e: ReactDragEvent<HTMLElement>, t: LocalTask) => {
    if (!dragRef.current || !movable(t) || Number(t.id) === dragRef.current.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropAt({ id: Number(t.id), zone: zoneOf(e, e.currentTarget) });
  };
  const onDragLeave = (e: ReactDragEvent<HTMLElement>) => {
    // 行内 td 之间移动也会触发 dragleave：只有真正离开整行才清指示
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setDropAt(null);
  };
  const onDrop = (e: ReactDragEvent<HTMLElement>, t: LocalTask) => {
    e.preventDefault();
    const zone = zoneOf(e, e.currentTarget);
    const drag = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    setDropAt(null);
    if (!drag || !movable(t) || Number(t.id) === drag.id) return;
    if (onMoveTask) onMoveTask({ id: drag.id }, t.id, zone);
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setDragId(null);
    setDropAt(null);
  };

  const batchBar = pickedTasks.length > 0 ? (
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
  ) : null;
  const listPanel = (
      <TaskPanelBox
        title={isGlobal ? '全局池任务' : '任务'}
        pendingCount={pendingCount}
        headerExtra={
          <>
            {/* #181：搜索框——标题与正文一起搜（模糊串规则见 modules/board/task-search） */}
            <span className="rp-tasks-tools">
              <input
                className="rp-task-search"
                type="search"
                value={q}
                placeholder="搜索标题 / 内容"
                aria-label="搜索任务"
                onChange={(e) => onQuery && onQuery(e.target.value)}
              />
              {tasks.length ? (
                <label className="rp-proj-pickall" title="全选/取消全选当前页">
                  <input
                    type="checkbox"
                    checked={allPicked}
                    onChange={togglePickAll}
                    aria-label="全选当前页任务"
                  />
                  全选本页
                </label>
              ) : null}
            </span>
          </>
        }
        emptyText={
          searching
            ? `没有匹配「${q.trim()}」的任务（标题与正文都搜过了）`
            : `还没有页面：点「＋ 新建页」写第一篇，或让 agent 往${isGlobal ? '全局池' : '这个目录'}投递任务。`
        }
      >
        {tasks.map((t) => {
          const movableRow = movable(t);
          const downs = (downstreamOf && downstreamOf[t.id]) || [];
          return (
            <TaskRowBox
              key={t.id}
              t={t}
              selectable
              picked={picked.has(Number(t.id))}
              onTogglePick={togglePick}
              draggable={movableRow}
              dragHandlers={
                movableRow
                  ? {
                      onDragStart: (e: ReactDragEvent<HTMLElement>) => onDragStart(e, t),
                      onDragOver: (e: ReactDragEvent<HTMLElement>) => onDragOver(e, t),
                      onDragLeave: onDragLeave,
                      onDrop: (e: ReactDragEvent<HTMLElement>) => onDrop(e, t),
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
              onOpen={(row: LocalTask) => onOpenTask(row.id)}
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
                      {/* icons.tsx 尚未类型化完（title 被推断为必填）：显式传 undefined 与不传等价 */}
                      <Icon name="refresh" size={12} title={undefined} />
                    </span>
                  )}
                  {onDeleteTask && (
                    <span
                      className="op danger" role="button" tabIndex={-1}
                      title="删除此任务（软删除，CLI 可恢复）"
                      aria-label={`删除 ${taskLabel(t)}`}
                      onClick={() => onDeleteTask(t)}
                    >
                      <Icon name="x" size={12} title={undefined} />
                    </span>
                  )}
                </>
              }
            />
          );
        })}
      </TaskPanelBox>
  );
  const footerBar = taskCount > 0 ? (
      <div className="mdw-land-pager">
          <Pager
            page={page}
            pageCount={pageCount}
            total={taskCount}
            onPage={onPage}
            unit="个任务"
          />
        </div>
  ) : null;

  return (
    // #170：整页布局复用共享组件 TaskPanelLayout（路由与数据语义各自保留，
    // 但排布骨架同源：头部 / 简介 / 批量条 / 列表 / 翻页的块序与间距由组件定）。
    // #167 三轮：去面包屑（group 页没有，返回导航走左侧树）。
    <TaskPanelLayout
      name={name}
      counts={
        searching
          ? [`命中 ${taskCount} 个任务`, ...(pendingCount > 0 ? [`待领取 ${pendingCount}`] : [])]
          : [`${taskCount} 个任务`, ...(pendingCount > 0 ? [`待领取 ${pendingCount}`] : [])]
      }
      intro={!isGlobal && repo ? <Introduction kind="repo" owner={repo} model={model} /> : null}
      batch={batchBar}
      list={listPanel}
      footer={footerBar}
      actions={
        <>
          {/* #139：工具区可编排（顺序 / 显隐；隐藏收入「更多」） */}
          <ToolActsBar
            kind="dir"
            labels={{
              more: '更多',
            }}
            titles={{
              new: '按默认模板新建一页（▾ 选模板）',
              import: '把一个 .md 文件导入成任务',
              progress: '打开这个目录的进程面板',
              more: '更多操作',
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
                      <Icon name="chevron" size={11} title={undefined} />
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
              refs: onRefs,
            }}
          />
        </>
      }
    >

      {/* 任务面板（#164 共享组件）：行结构 / 状态药丸与项目组页一致。
          当前页行不拆段（分页语义由容器负责）；全选在面板头右侧。 */}

    </TaskPanelLayout>
  );
}
