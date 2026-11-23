// 任务页模板（#251）：目录任务页（page/dir）与项目组页（page/group）共用的**整页交互**。
//
// 基线是目录页：用户口径「先读 dir 的所有样式 / 交互 / 按钮，再抽成模板，两页复用」。
// 抽离前两页各写一遍容器与交互——组页缺多选 / 批量条 / 行尾菜单 / 导入 / 草稿态，
// 目录页缺组页的项目 tag 语义，改一处另一处就漂。现在两页只交数据与动作：
//
//   rp-page
//     ├ rp-group-head  标题 + 计数 chips + 工具区（ToolActsBar：新建 / 导入 / 进程 / 编排 /
//     │                草稿态 / 更多；两页同一套按钮与文案，差别只在 kind 的模块表）
//     ├ intro          简介槽（目录 = 项目介绍，组 = 组介绍）
//     ├ batch          批量条（选中后出现：标为完成 / 取消 / 删除 / 清空）
//     ├ list           TaskPanel：搜索框 + 全选本页 + 任务行（多选 / 拖把 / 行尾 ⋯）
//     └ footer         翻页条
//
// 模板自己持有：搜索串、当前页、多选集合、拖拽视觉态、模板下拉菜单。
// 调用方持有：行数据（已排好显示序）、每行的 scope 语义、以及所有落盘动作。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Icon } from '../icons.jsx';
import Pager, { usePager } from '../pager.jsx';
import { PopMenu, RowMenu } from '../popup/index.jsx';
import type { PopMenuItem, RowMenuItem } from '../popup/index.jsx';
import ToolActsBar from '../tool-acts/bar.jsx';
import { useToast } from '../toast/index.jsx';
import TaskPanel from './index.jsx';
import TaskPanelLayout from './layout.jsx';
import TaskRow from './task-row.jsx';
import { contextOf, hitTaskQuery } from '../../modules/board/task-search.js';
import type { LocalTask } from '../../types.js';

/** 列表每页条数（两页同值：20）。 */
const PAGE_SIZE = 20;

/** 一行任务：任务本体 + 这一页给它加的行级语义。 */
export interface TaskPageRow {
  /** 行 key（组页同号任务会跨成员队列，key 必须带队列维度） */
  key: string;
  task: LocalTask;
  /** 归属项目 tag（组页用；目录页不传） */
  projectTag?: string;
  /** 项目 tag 悬浮说明 */
  projectTitle?: string;
  /** 闸门挡住的下游任务 id */
  downs?: Array<number | string>;
  /** 行内显示 创建→领取 时间（目录页基线：传 true） */
  showTimes?: boolean;
  /** 可拖动排序（= 队列里的待领取任务；同时决定行尾的编排 / 闸门入口） */
  movable?: boolean;
}

/** 工具区透传面（kind 决定模块表；new / import / plan 由模板接管）。 */
export interface TaskPageToolActs {
  labels?: Record<string, string | undefined>;
  titles?: Record<string, string | undefined>;
  disabled?: Record<string, boolean | undefined>;
  renderers?: Record<string, ((ctx: { open: boolean }) => ReactNode) | undefined>;
  actions?: Record<string, ((e?: ReactMouseEvent<HTMLButtonElement>) => void) | undefined>;
}

export interface TaskPageProps {
  /** 工具区模块表种类（dir / group） */
  kind: 'dir' | 'group';
  /** 页头主体名（目录名 / 组名） */
  name: string;
  /** 任务面板标题（「任务」/「本组任务」） */
  title: string;
  /** 全量行（已按显示序排好；搜索 / 分页由模板做） */
  rows: TaskPageRow[];
  /** 无搜索时的空态文案（搜索零命中的文案由模板拼） */
  emptyText: string;
  /** 简介槽 */
  intro?: ReactNode;
  /** 头部计数 chips 的**额外**项（对齐口径：任务数 / 待领取由模板出，页面只加自己的） */
  extraCounts?: string[];
  /** 工具区额外节点（如持续 get 的成员子菜单与配置弹窗） */
  actionExtra?: ReactNode;
  toolActs?: TaskPageToolActs;
  /** 「＋ 新建页」主区点击 */
  onNew: () => void;
  /** 新建按钮禁用（组页没有成员时不可建任务） */
  newDisabled?: boolean;
  /** 「＋ 新建页」▾ 的模板菜单 */
  tplMenuItems: Array<PopMenuItem | string>;
  /** 点行 / 回车打开任务 */
  onOpenRow: (row: TaskPageRow) => void;
  /** 拖动排序落盘（落点只有 before / after） */
  onMoveRow?: (src: TaskPageRow, dst: TaskPageRow, zone: 'before' | 'after') => void;
  /** 「导入」选中 .md 后的落地 */
  onImportFile?: (file: File) => void;
  /** 草稿态切换（行尾单条 / 批量条都会走这里） */
  onTogglePlan?: (rows: TaskPageRow[], to: 'plan' | 'pending') => void;
  /** 行尾「编排依赖…」 */
  onOpenDag?: (row: TaskPageRow) => void;
  /** 行尾闸门开关 */
  onToggleGate?: (row: TaskPageRow) => void;
  /** 行尾反馈 */
  onFeedback?: (row: TaskPageRow) => void;
  /** 行尾单条删除 */
  onDeleteRow?: (row: TaskPageRow) => void;
  /** 批量：删除 / 取消 / 标为完成（返回真值则清空选择） */
  onDeleteRows?: (rows: TaskPageRow[]) => Promise<unknown>;
  onCancelRows?: (rows: TaskPageRow[]) => Promise<unknown>;
  onCompleteRows?: (rows: TaskPageRow[]) => Promise<unknown>;
  /** 页面级弹层（编排编辑器、成员选择器等） */
  extra?: ReactNode;
}

/** 拖动落点：行上半 = 之前，下半 = 之后。 */
type DropZone = 'before' | 'after';

export default function TaskPage({
  kind,
  name,
  title,
  rows,
  emptyText,
  intro = null,
  extraCounts = [],
  actionExtra = null,
  toolActs = {},
  onNew,
  newDisabled = false,
  tplMenuItems,
  onOpenRow,
  onMoveRow,
  onImportFile,
  onTogglePlan,
  onOpenDag,
  onToggleGate,
  onFeedback,
  onDeleteRow,
  onDeleteRows,
  onCancelRows,
  onCompleteRows,
  extra = null,
}: TaskPageProps) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [tplMenu, setTplMenu] = useState<{ x?: number; y?: number } | null>(null);

  // ─── 搜索 + 分页（两页同一口径：标题与正文都搜，见 modules/board/task-search） ───
  const [q, setQ] = useState('');
  const searching = !!String(q).trim();
  const shown = useMemo(
    () => (searching ? rows.filter((r) => hitTaskQuery({ id: r.task.id, text: r.task.text }, q)) : rows),
    [rows, q, searching],
  );
  // 待领取计数跟着**筛后**集合走：搜索时头部数字要与屏幕上的行对得上
  const pendingCount = useMemo(
    () => shown.filter((r) => r.task.status === 'pending' && !r.task.migratedTo).length,
    [shown],
  );
  const pager = usePager(shown, PAGE_SIZE);
  // 改查询串回第一页（否则停在「上一结果的第 3 页」，看起来像没命中）
  useEffect(() => {
    pager.setPage(0);
  }, [q]);

  // ─── 多选 + 批量条 ─────────────────────────────────────────────
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const pageRows = pager.items;
  const pageKeys = pageRows.map((r) => r.key);
  const allPicked = pageKeys.length > 0 && pageKeys.every((k) => picked.has(k));
  // 翻页后清空选择，避免批量操作跨页误伤看不到的行
  useEffect(() => {
    setPicked(new Set());
  }, [pager.page]);
  const pickedRows = rows.filter((r) => picked.has(r.key));
  // #184：标为完成对「未结束」任务开放（待领取 + 已领取）；取消只给待领取
  const doneTargets = pickedRows.filter(
    (r) =>
      (r.task.status === 'pending' || r.task.status === 'claimed') && !r.task.migratedTo && !r.task.deletedAt,
  );
  const cancelTargets = pickedRows.filter(
    (r) => r.task.status === 'pending' && !r.task.migratedTo && !r.task.deletedAt,
  );
  const claimedPicked = doneTargets.filter((r) => r.task.status === 'claimed').length;
  const togglePick = (key: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const togglePickAll = () => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allPicked) pageKeys.forEach((k) => next.delete(k));
      else pageKeys.forEach((k) => next.add(k));
      return next;
    });
  };
  const runBatch = async (fn?: (rs: TaskPageRow[]) => Promise<unknown>) => {
    if (!pickedRows.length || !fn) return;
    const ok = await fn(pickedRows);
    if (ok) setPicked(new Set());
  };

  // ─── 草稿态（pending ↔ plan）：批量条不设按钮，走工具区「草稿态」+ 行尾菜单 ───
  const toPlan = pickedRows.filter((r) => r.task.status === 'pending');
  const toPending = pickedRows.filter((r) => r.task.status === 'plan');
  const planTargets = toPlan.length ? toPlan : toPending;
  const planTo: 'plan' | 'pending' = toPlan.length ? 'plan' : 'pending';
  const planLabel = pickedRows.length
    ? planTo === 'plan'
      ? `转草稿 (${toPlan.length})`
      : `转回待领取 (${toPending.length})`
    : '草稿态';

  // ─── 拖动排序（HTML5 DnD，只在可移动行之间换位）────────────────────
  // 拖拽态走 **ref**：dragstart / dragover 间隔只有几毫秒，state 那一拍会读到旧值
  const dragRef = useRef<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ key: string; zone: DropZone } | null>(null);
  const zoneOf = (e: ReactDragEvent<HTMLElement>, el: HTMLElement): DropZone => {
    const r = el.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };
  const onDragStart = (e: ReactDragEvent<HTMLElement>, r: TaskPageRow) => {
    dragRef.current = r.key;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'task:' + r.task.id);
    setDragKey(r.key);
  };
  const onDragOver = (e: ReactDragEvent<HTMLElement>, r: TaskPageRow) => {
    if (!dragRef.current || !r.movable || r.key === dragRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropAt({ key: r.key, zone: zoneOf(e, e.currentTarget) });
  };
  const onDragLeave = (e: ReactDragEvent<HTMLElement>) => {
    // 行内子元素之间移动也会触发 dragleave：真离开整行才清指示
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setDropAt(null);
  };
  const onDrop = (e: ReactDragEvent<HTMLElement>, r: TaskPageRow) => {
    e.preventDefault();
    const zone = zoneOf(e, e.currentTarget);
    const fromKey = dragRef.current;
    dragRef.current = null;
    setDragKey(null);
    setDropAt(null);
    if (!fromKey || !r.movable || r.key === fromKey) return;
    const src = rows.find((x) => x.key === fromKey);
    if (src && onMoveRow) onMoveRow(src, r, zone);
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setDragKey(null);
    setDropAt(null);
  };

  // ─── 行尾 ⋯ 菜单（两页同一套条目与文案；动作由调用方给）───────────────
  const menuOf = (r: TaskPageRow): Array<RowMenuItem | null | false> => {
    const t = r.task;
    return [
      (t.status === 'pending' || t.status === 'plan') && onTogglePlan
        ? {
            label: t.status === 'pending' ? '转为草稿（不进队列）' : '转回待领取',
            onPick: () => onTogglePlan([r], t.status === 'pending' ? 'plan' : 'pending'),
          }
        : null,
      r.movable && onOpenDag ? { label: '编排依赖…', onPick: () => onOpenDag(r) } : null,
      r.movable && onToggleGate
        ? {
            label: t.blocksFollowing ? '取消闸门（不再挡后续）' : '设为闸门（挡住后续）',
            onPick: () => onToggleGate(r),
          }
        : null,
      // #144 反馈只在链尖：已有派生子任务的旧轮次不再给入口（否则把链分叉）
      onFeedback && t.status !== 'cancelled' && !t.childCount && (t.status === 'claimed' || t.status === 'done' || t.completedAt)
        ? {
            label: t.completedAt ? '反馈：新开一条任务（原任务不动）' : '反馈修改：回写本任务并记入任务链',
            onPick: () => onFeedback(r),
          }
        : null,
      onDeleteRow ? { label: '删除此任务（软删除，CLI 可恢复）', danger: true, onPick: () => onDeleteRow(r) } : null,
    ];
  };

  // ─── 批量条（选中后出现；块序与样式与目录页原实现一致）───────────────
  const batchBar = pickedRows.length > 0 ? (
    <div className="mdw-land-batch">
      <span className="mdw-land-batch-count">已选 {pickedRows.length} 条</span>
      {onCompleteRows && (
        <button
          type="button"
          className="btn ghost sm"
          disabled={!doneTargets.length}
          title={
            doneTargets.length
              ? `把选中的未结束任务标为已完成（补一条完成记录，原文留档）${claimedPicked ? `；其中 ${claimedPicked} 条已被领取，会直接收口，agent 侧回执忽略` : ''}`
              : '选中的任务都已结束，没有可标为完成的'
          }
          onClick={() => void runBatch(onCompleteRows)}
        >
          标为完成选中{doneTargets.length ? ` (${doneTargets.length})` : ''}
        </button>
      )}
      {onCancelRows && (
        <button
          type="button"
          className="btn ghost sm"
          disabled={!cancelTargets.length}
          title={
            cancelTargets.length
              ? '把选中的待领取任务标为已取消（终态，原文留档）'
              : '只有待领取任务可以取消（已领取的交给 agent 回执）'
          }
          onClick={() => void runBatch(onCancelRows)}
        >
          取消选中{cancelTargets.length ? ` (${cancelTargets.length})` : ''}
        </button>
      )}
      {onDeleteRows && (
        <button type="button" className="btn ghost sm danger" onClick={() => void runBatch(onDeleteRows)}>
          删除选中 ({pickedRows.length})
        </button>
      )}
      <button type="button" className="btn ghost sm" onClick={() => setPicked(new Set())}>
        清空
      </button>
    </div>
  ) : null;

  // ─── 列表 ───────────────────────────────────────────────────────
  const listPanel = (
    <TaskPanel
      title={title}
      pendingCount={pendingCount}
      headerExtra={
        <span className="rp-tasks-tools">
          <input
            className="rp-task-search"
            type="search"
            value={q}
            placeholder="搜索标题 / 内容"
            aria-label="搜索任务"
            onChange={(e) => setQ(e.target.value)}
          />
          {pageRows.length ? (
            <label className="rp-proj-pickall" title="全选/取消全选当前页">
              <input type="checkbox" checked={allPicked} onChange={togglePickAll} aria-label="全选当前页任务" />
              全选本页
            </label>
          ) : null}
        </span>
      }
      emptyText={
        searching
          ? `没有匹配「${q.trim()}」的任务（标题与正文都搜过了）`
          : emptyText
      }
    >
      {pageRows.map((r) => {
        const handlers = r.movable
          ? {
              onDragStart: (e: ReactDragEvent<HTMLElement>) => onDragStart(e, r),
              onDragOver: (e: ReactDragEvent<HTMLElement>) => onDragOver(e, r),
              onDragLeave: onDragLeave,
              onDrop: (e: ReactDragEvent<HTMLElement>) => onDrop(e, r),
              onDragEnd: onDragEnd,
            }
          : null;
        return (
          <TaskRow
            key={r.key}
            t={r.task}
            projectTag={r.projectTag}
            projectTitle={r.projectTitle}
            searchCtx={searching ? contextOf(r.task, q) : null}
            selectable
            picked={picked.has(r.key)}
            onTogglePick={() => togglePick(r.key)}
            draggable={!!r.movable}
            dragHandlers={handlers}
            dragVisual={{ dragging: dragKey === r.key, drop: dropAt && dropAt.key === r.key ? dropAt.zone : null }}
            showTimes={r.showTimes}
            downs={r.downs}
            onOpen={() => onOpenRow(r)}
            ops={<RowMenu items={menuOf(r)} />}
          />
        );
      })}
    </TaskPanel>
  );

  const footerBar = pager.total > 0 ? (
    <div className="mdw-land-pager">
      <Pager page={pager.page} pageCount={pager.pageCount} total={pager.total} onPage={pager.setPage} unit="个任务" />
    </div>
  ) : null;

  // ─── 工具区：new / import / plan 由模板接管，其余（进程 / 编排 / 更多…）由页面给 ───
  const openTplMenu = (e: { type: string; clientX?: number; clientY?: number }) => {
    setTplMenu({ x: e.clientX, y: e.clientY });
  };
  const newButton = () => (
    <span className="rp-newtask">
      <button
        type="button"
        className="btn small primary"
        title="按默认模板新建一页（▾ 选模板）"
        disabled={newDisabled}
        onClick={() => onNew()}
      >
        ＋ 新建页
        <span
          role="button"
          tabIndex={newDisabled ? undefined : 0}
          aria-label="选择模板新建一页"
          aria-haspopup="menu"
          className="rp-newtask-caret"
          title="选择模板新建一页"
          onClick={(e) => {
            e.stopPropagation();
            openTplMenu(e);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              openTplMenu(e);
            }
          }}
        >
          <Icon name="chevron" size={11} title={undefined} />
        </span>
      </button>
    </span>
  );

  return (
    <>
      <TaskPanelLayout
        name={name}
        counts={[
          `${searching ? '命中 ' : ''}${pager.total} 个任务`,
          ...(pendingCount > 0 ? [`待领取 ${pendingCount}`] : []),
          ...extraCounts,
        ]}
        intro={intro}
        batch={batchBar}
        list={listPanel}
        footer={footerBar}
        actions={
          <>
            <ToolActsBar
              kind={kind}
              labels={{ more: '更多', ...toolActs.labels, plan: planLabel }}
              titles={{
                new: '按默认模板新建一页（▾ 选模板）',
                import: '把一个 .md 文件导入成任务',
                plan: '选中任务后：待领取 ↔ 草稿（草稿不进 get/wait 队列；行尾 ⋯ 菜单也能单条切换）',
                ...toolActs.titles,
              }}
              disabled={toolActs.disabled}
              renderers={{ new: newButton, ...toolActs.renderers }}
              actions={{
                ...toolActs.actions,
                new: () => onNew(),
                import: () => fileRef.current?.click(),
                plan: () => {
                  if (!planTargets.length) {
                    toast('先勾选任务：待领取可转草稿，草稿可转回待领取（行尾 ⋯ 菜单也能单条切换）');
                    return;
                  }
                  onTogglePlan?.(planTargets, planTo);
                },
              }}
            />
            {actionExtra}
          </>
        }
      />

      {tplMenu && <PopMenu x={tplMenu.x} y={tplMenu.y} items={tplMenuItems} onClose={() => setTplMenu(null)} />}

      <input
        ref={fileRef}
        type="file"
        accept=".md,text/markdown,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && onImportFile) onImportFile(f);
        }}
      />

      {extra}
    </>
  );
}
