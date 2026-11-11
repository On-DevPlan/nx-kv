// 项目组详情（#/group/<看板 id>）：组是**操作单元**，不是树里的一层文件夹。
//
// 本页就是**本组任务面板**（2026-11-03）：一列列出全部「在本组创建」的任务——
// 任务正文头部带 frontmatter（board/project，提交时自动写入，携带工作组语义），
// 每条用项目 tag 标出归属；「新增任务」进 MD 编辑页，工具区选归属项目（限本组成员），
// 提交按 frontmatter.project 路由进对应项目的队列。成员名册表格已移除（成员管理在仓库页）。
//
// 编排（#40）：组任务横跨多个成员队列；待领取行可拖动排序（同目录页）——
// reorder API 按 topic，故只允许拖到**同一成员队列**的落点；跨项目落点会提示。
// 组介绍与项目介绍共用 Introduction（显示 / 编辑 / 补 ref）。
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icons.jsx';
import { useToast } from '../../components/toast/index.jsx';
import Introduction from '../../components/Introduction/index.jsx';
import MemberPicker from '../../components/board/member-picker.jsx';
import TaskPanel from '../../components/task-panel/index.jsx';
import TaskPanelLayout from '../../components/task-panel/layout.jsx';
import DeletedPanel from '../dir/deleted-panel.jsx';
import TaskRow from '../../components/task-panel/task-row.jsx';
import Pager, { usePager } from '../../components/pager.jsx';
import { useApp } from '../../app-context.jsx';
import { removeTask, reorderTask, restoreTask } from './api.js';
import { openPanel } from '../../workspace.js';
import { openTemplateEditor } from '../../panels.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import ToolActsBar from '../../components/tool-acts/bar.jsx';
import { docIdOf, nextDraftId, saveDoc, scopeOf } from '../../modules/md/doc-store.js';
import { NEW_TEMPLATE_VALUES, parseFrontmatter, withFrontmatter } from '../../modules/md/md-parse.js';
import { renderTemplateBody } from '../../modules/prompts/placeholders.js';
import { useTemplates, useTemplatesFor } from '../../modules/md/use-templates.js';
import type { LocalTask, LocalTopic, RepoData } from '../../types.js';
import type { Model } from 'flexlayout-react';
import type { BoardRecord } from '../repos/repo-table.js';

// TaskPanelLayout 尚未类型化：其 props 里没有 children（实现也不渲染），而调用处把
// 成员弹窗 / 已删除面板挂成 children —— 按实际调用面放宽签名（属他人负责文件）。
const Layout = TaskPanelLayout as unknown as (p: {
  name?: string;
  counts?: string[];
  icon?: string;
  actions?: ReactNode;
  intro?: ReactNode;
  batch?: ReactNode;
  list?: ReactNode;
  footer?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
}) => ReactElement | null;

// 本组任务列表页大小：与目录任务页同值——两页面板同构（#167 三轮）
const PAGE_SIZE = 20;

/** 队列里的一条任务：LocalTask 之外还会读软删 / 迁移 / 领取时刻等标记。 */
interface TopicTask extends LocalTask {
  deletedAt?: string;
  migratedTo?: string;
  consumedAt?: string;
  completedAt?: string;
  roundSummary?: string;
  childRoundCount?: number;
  blocksFollowing?: boolean;
  boardMark?: string;
  from?: string;
}

/** 队列主题（/api/localtasks 的 rows[]）：进程态字段按需读。 */
interface TopicRow extends LocalTopic {
  cwd?: string;
  isGlobal?: boolean;
  repo?: { key?: string; name?: string };
  pending?: number;
  waiting?: boolean;
  summary?: string;
  tasks?: TopicTask[];
}

/** 成员行（看板成员 + 仓库登记 + 队列现状的合成视图）。 */
interface MemberItem {
  key: string;
  name: string;
  path: string;
  cwd: string;
  desc: string;
  pending: number;
  waiting: boolean;
  topicKey: string;
  summary: string;
  tasks: TopicTask[];
  present: boolean;
  noteDocId: string;
}

/** 本组任务的一行（任务 + 它所在的成员队列 + 归属项目）。 */
interface GroupTaskRow {
  member: MemberItem;
  task: TopicTask;
  project: string;
}

/** 已删除任务（带它所在队列的定位信息）。 */
type DeletedRow = TopicTask & { memberName?: string; memberCwd?: string };

/** 模板下拉里的一项（flyTemplates 为接口数据，形状按用到的字段收窄）。 */
interface TemplateItem {
  id: string;
  name: string;
  body?: string;
  values?: Record<string, string>;
  fallback?: boolean;
}

/** 拖动中的任务（拖到同一成员队列内才允许落点）。 */
interface DragInfo {
  id: number;
  topicKey: string;
  cwd: string;
  row: string;
}

export default function GroupView({ dirKey, rows, repoData, model }: {
  dirKey?: string;
  rows?: LocalTopic[];
  repoData?: RepoData;
  model?: Model | null;
}) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const app = useApp();
  const tpl = useTemplates();
  // repoData / rows 来自 /api 负载（外部边界）：到这里按本页真正读的字段收窄一次
  const boards = ((repoData && repoData.boards) || []) as BoardRecord[];
  const repos = (repoData && repoData.repos) || [];
  const topics = (rows || []) as TopicRow[];
  // 已领取历史折叠态：#167 三轮起被分页取代（列表进 usePager，历史行混排在页内）
  // 「添加成员」就地弹窗（不跳仓库管理页——组面板里就地改归属）
  const [addOpen, setAddOpen] = useState(false);
  // #169：本组已删除任务（组任务跨多个成员队列）
  const [showDeleted, setShowDeleted] = useState(false);
  // 「＋ 新增任务 ▾」（#131/#132）：点击开合；portal + fixed 防组页矮容器裁切出滚动条。
  const [tplFlyOpen, setTplFlyOpen] = useState(false);
  const [tplFlyPos, setTplFlyPos] = useState<{ top: number; right: number } | null>(null); // { top, right } 视口坐标
  const newtaskRef = useRef<HTMLDivElement | null>(null);
  const tplFlyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tplFlyOpen) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (newtaskRef.current?.contains(e.target as Node) || tplFlyRef.current?.contains(e.target as Node)) return;
      setTplFlyOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTplFlyOpen(false);
    };
    const onReposition = () => {
      const btn = newtaskRef.current?.querySelector('button');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const menuH = tplFlyRef.current?.offsetHeight || 240;
      const gap = 6;
      const spaceBelow = window.innerHeight - r.bottom - gap;
      const top = spaceBelow >= menuH || spaceBelow >= r.top
        ? r.bottom + gap
        : Math.max(8, r.top - gap - menuH);
      setTplFlyPos({
        top,
        right: Math.max(8, window.innerWidth - r.right),
      });
    };
    onReposition();
    // 下一帧再量一次（菜单已挂到 body，高度准）
    const t = requestAnimationFrame(onReposition);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      cancelAnimationFrame(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [tplFlyOpen]);

  const board = useMemo(
    () => boards.find((b) => b.id === dirKey) || boards.find((b) => b.key === dirKey) || null,
    [boards, dirKey]
  );

  // 成员行 = 看板成员 + 仓库登记（本机没有登记的占位只显示 key）+ 队列现状
  const items = useMemo<MemberItem[]>(() => {
    if (!board) return [];
    const repoByKey = new Map(repos.map((r) => [r.key, r]));
    const topicByRepoKey = new Map<string, TopicRow>();
    for (const t of topics) {
      if (t.isGlobal || !t.repo || !t.repo.key) continue;
      if (!topicByRepoKey.has(t.repo.key)) topicByRepoKey.set(t.repo.key, t);
    }
    return (board.repos || []).map((m) => {
      const repo = repoByKey.get(m.key) || null;
      const topic = topicByRepoKey.get(m.key) || null;
      return {
        key: m.key,
        name: m.name || (repo && repo.name) || m.key,
        path: m.path || (repo && repo.path) || '',
        cwd: (topic && topic.cwd) || m.path || (repo && repo.path) || '',
        desc: m.note || (repo && repo.desc) || '',
        pending: topic ? topic.pending || 0 : 0,
        waiting: !!(topic && topic.waiting),
        topicKey: topic ? topic.key : '',
        summary: topic ? topic.summary || '' : '',
        tasks: topic ? (topic.tasks || []) : [],
        present: m.present !== false,
        // 组内描述文档：绑定优先（外部 path 只读），缺省约定路径
        noteDocId: m.noteDocPath ? 'path:' + m.noteDocPath : 'rel:' + (m.noteDocRel || ''),
      };
    });
  }, [board, repos, topics]);

  if (!board) {
    return (
      <div className="rp-page">
        <RouteBreadcrumb />
        <div className="rp-empty">项目组不存在（看板可能被删了）</div>
      </div>
    );
  }

  const totalPending = items.reduce((n, it) => n + it.pending, 0);

  // 每个成员队列的编排素材：待领取任务（队列序）+ 闸门的下游映射（同 isReadyToClaim 口径）。
  // rows = /api/localtasks 的裸 topic（tasks 直挂其上）。
  const dagByTopic = useMemo<Map<string, { tasks: TopicTask[]; downstream: Record<string, number[]> }>>(() => {
    const map = new Map<string, { tasks: TopicTask[]; downstream: Record<string, number[]> }>();
    for (const r of topics) {
      if (!r.key || r.isGlobal) continue;
      const pend = (r.tasks || []).filter(
        (t) => t && !t.deletedAt && !t.migratedTo && t.status === 'pending',
      );
      const downstream: Record<string, number[]> = {};
      pend.forEach((t, i) => {
        if (t.blocksFollowing) downstream[t.id] = pend.slice(i + 1).map((x) => x.id);
      });
      map.set(r.key, { tasks: pend, downstream });
    }
    return map;
  }, [topics]);

  // 保存与目录页同构：逐条 PATCH（本任务 gate/blockBy + 下游各方 blockBy）；
  // 失败 toast 并上抛——编辑器据此保持打开。

  // 新建任务的默认归属项目：第一个有待领取的成员（面板一打开就对准活儿），
  // 都没有就第一个成员。编辑页的工具区里还可以改（限本组成员）。
  const sel =
    items.find((it) => it.pending > 0) ||
    items[0] ||
    null;

  // 本组任务 = 成员队列里**正文 frontmatter.board 指向本组**的任务。
  // 展示序列与目录页同构（#167 三轮）：待领取在前（各成员队列序），历史在后
  // （领取时间倒序）——整条序列进 usePager 分页，两页面板完全一致。
  const groupTasks = useMemo<GroupTaskRow[]>(() => {
    const ids = board ? [board.id, board.key, board.name].filter(Boolean) : [];
    const pend: GroupTaskRow[] = [];
    const done: GroupTaskRow[] = [];
    for (const it of items) {
      for (const t of it.tasks || []) {
        if (t.deletedAt) continue; // 软删的进「已删除任务」面板，不进列表
        const fm = parseFrontmatter(t.text);
        if (!fm.board || !ids.includes(fm.board)) continue;
        (t.status === 'pending' ? pend : done).push({ member: it, task: t, project: fm.project || '' });
      }
    }
    done.sort((a, b) => String(b.task.consumedAt || '').localeCompare(String(a.task.consumedAt || '')));
    return [...pend, ...done];
  }, [board, items]);

  // #169：本组已删除任务（组任务跨多个成员队列——每条记着自己队列的 cwd，
  // 恢复/彻底删除按各自队列定位）。
  const deletedTasks = useMemo<DeletedRow[]>(() => {
    const ids = board ? [board.id, board.key, board.name].filter(Boolean) : [];
    const out: DeletedRow[] = [];
    for (const it of items) {
      for (const t of it.tasks || []) {
        if (!t.deletedAt) continue;
        const fm = parseFrontmatter(t.text);
        if (!fm.board || !ids.includes(fm.board)) continue;
        out.push({ ...t, memberName: it.name, memberCwd: it.cwd });
      }
    }
    return out.reverse();
  }, [board, items]);

  const restoreDeleted = async (t: DeletedRow) => {
    if (!t) return;
    try {
      await restoreTask({ cwd: t.memberCwd, id: t.id });
      toast(`已恢复 #${t.id}`);
      if (app.refreshLocal) await app.refreshLocal();
    } catch (e) {
      toast(`恢复失败：${(e as Error).message || e}`);
    }
  };

  const purgeDeleted = async (t: DeletedRow) => {
    if (!t) return;
    const title = (t.text || '').split('\n').find((l) => l.trim()) || `#${t.id}`;
    const ok = await dialog({
      title: `彻底删除「${title.replace(/^#\s*/, '')}」`,
      message: '彻底删除后不可恢复（行从队列里真正摘除）。',
      danger: true,
      okText: '彻底删除',
    });
    if (!ok) return;
    try {
      await removeTask({ cwd: t.memberCwd, id: t.id, purge: true });
      toast(`已彻底删除 #${t.id}`);
      if (app.refreshLocal) await app.refreshLocal();
    } catch (e) {
      toast(`删除失败：${(e as Error).message || e}`);
    }
  };
  const groupPendingCount = useMemo(
    () => groupTasks.filter((x) => x.task.status === 'pending').length,
    [groupTasks]
  );
  const pager = usePager(groupTasks, PAGE_SIZE);

  // 待领取拖动排序（同目录页 HTML5 DnD；落点须同 topic）
  const dragRef = useRef<DragInfo | null>(null); // { id, topicKey, cwd }
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ key: string; zone: string } | null>(null); // { key: memberKey:taskId, zone }
  const rowKey = (member: MemberItem, task: TopicTask) => member.key + ':' + task.id;
  const zoneOf = (e: ReactDragEvent<HTMLElement>, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };
  const onDragStart = (e: ReactDragEvent<HTMLElement>, member: MemberItem, task: TopicTask) => {
    dragRef.current = {
      id: Number(task.id),
      topicKey: member.topicKey,
      cwd: member.cwd || member.path || '',
      row: rowKey(member, task),
    };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'task:' + task.id);
    setDragId(rowKey(member, task));
  };
  const onDragOver = (e: ReactDragEvent<HTMLElement>, member: MemberItem, task: TopicTask) => {
    const drag = dragRef.current;
    if (!drag || drag.row === rowKey(member, task)) return;
    // 异队列也可 hover 提示，松手再拦
    e.preventDefault();
    e.dataTransfer.dropEffect = drag.topicKey === member.topicKey ? 'move' : 'none';
    setDropAt({ key: rowKey(member, task), zone: zoneOf(e, e.currentTarget) });
  };
  const onDragLeave = (e: ReactDragEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropAt(null);
  };
  const onDrop = async (e: ReactDragEvent<HTMLElement>, member: MemberItem, task: TopicTask) => {
    e.preventDefault();
    const zone = zoneOf(e, e.currentTarget);
    const drag = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    setDropAt(null);
    if (!drag || drag.row === rowKey(member, task)) return;
    if (drag.topicKey !== member.topicKey) {
      toast('只能在同一项目队列内排序（跨项目请用编排连线）');
      return;
    }
    const cwd = member.cwd || member.path;
    if (!member.topicKey || !cwd) {
      toast('该成员还没有本地队列，无法排序');
      return;
    }
    try {
      await reorderTask({
        cwd,
        id: drag.id,
        ...(zone === 'before' ? { beforeId: Number(task.id) } : { afterId: Number(task.id) }),
      });
      if (app.refreshLocal) await app.refreshLocal();
    } catch (err) {
      toast(String((err as Error).message || err));
    }
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setDragId(null);
    setDropAt(null);
  };

  // 组里建任务：草稿预写 frontmatter（board + 默认归属项目），提交时编辑页的工具区
  // 可改归属项目（限本组成员），按它路由进对应项目的队列。
  // 落种用 PagePanel 同一套复合键（scope::draft-N）——裸 draft 号会种不到正文上。
  // body 可选（#128）：hover 面板里选了模板就带模板正文；不带 = 默认模板（旧行为）。
  const createTask = (body?: string) => {
    if (!board) return;
    if (!sel) return toast('这个组还没有成员——先「添加成员」，再建任务');
    const id = nextDraftId();
    // 草稿 doc 种在**组 scope**（docIdOf(scopeOf(board.id), id)）：从组路由
    // #/group/<id>?task=draft-N 打开寻得回同一份（#86）。以前种在成员 scope、
    // 打开走 dir 路由——组语义在建任务这步就断了。
    const docId = docIdOf(scopeOf(board.id), id);
    // 与目录任务页同一条 defaultBody：已按槽位值渲染，不出现裸 {{背景}}
    saveDoc(docId, {
      title: '',
      body: withFrontmatter(body || tpl.defaultBody(), { board: board.id, project: sel.key }),
    });
    app.openPage?.({ groupId: board.id, task: id, name: '新任务' });
  };

  // #132：组本身是可见主体——按 group +（可选）成员 repo/topic 三钥过滤。
  const scopedTpl = useTemplatesFor({
    topic: sel ? sel.topicKey : '',
    group: board ? board.key : '',
    repo: sel ? sel.key : '',
  });
  const flyTemplates: TemplateItem[] = scopedTpl.templates || tpl.templates || [];

  // 就地新建（#135）：不弹窗，直进全屏编辑；标题即名称；scope 预置本组。
  const newTemplateHere = () => {
    if (!board || !model) return;
    openTemplateEditor(model, {
      mode: 'new',
      scope: [`group:${board.key}`],
      name: '',
    });
  };

  const introSlot = (
      <Introduction kind="board" owner={board} model={model} />
  );
  // TaskPanel / TaskPanelLayout / TaskRow / MemberPicker 尚未类型化：插槽与列表 props
  // 因 `= null` / `= []` 默认值退化成 null / never[]，这里在调用边界上放宽。
  const listPanel = (
      <TaskPanel
        title="本组任务"
        pendingCount={groupPendingCount}
        emptyText="本组还没有任务——点「＋ 新增任务」创建；只有在本组创建的任务（携带本组语义）才会出现在这里。"
      >
        {(pager.items.map(({ member, task }) => {
          const isPending = task.status === 'pending';
          const dagInfo = dagByTopic.get(member.topicKey);
          const downs = (dagInfo && dagInfo.downstream[task.id]) || [];
          const rk = rowKey(member, task);
          return (
            <TaskRow
              key={rk}
              t={task}
              projectTag={member.name}
              history={!isPending}
              draggable={isPending && !!member.topicKey}
              dragHandlers={
                isPending && member.topicKey
                  ? ({
                      onDragStart: (e: ReactDragEvent<HTMLElement>) => onDragStart(e, member, task),
                      onDragOver: (e: ReactDragEvent<HTMLElement>) => onDragOver(e, member, task),
                      onDragLeave: onDragLeave,
                      onDrop: (e: ReactDragEvent<HTMLElement>) => onDrop(e, member, task),
                      onDragEnd: onDragEnd,
                    } as unknown as null)
                  : null
              }
              dragVisual={{
                dragging: dragId === rk,
                drop: dropAt && dropAt.key === rk ? dropAt.zone : null,
              }}
              downs={downs as unknown as never[]}
              onTogglePick={undefined}
              onOpen={() =>
                app.openPage &&
                app.openPage({ groupId: board.id, task: String(task.id), name: `#${task.id}` })
              }
            />
          );
        })) as unknown as null}
      </TaskPanel>
  );
  const footerBar = (
      <div className="mdw-land-pager">
        <Pager
          page={pager.page}
          pageCount={pager.pageCount}
          total={pager.total}
          onPage={pager.setPage}
          unit="个任务"
        />
      </div>
  );

  return (
    <Layout
      name={board.name}
      counts={[`${items.length} 个目录`, ...(totalPending > 0 ? [`待领取 ${totalPending}`] : [])]}
      intro={introSlot}
      list={listPanel}
      footer={footerBar}
      actions={(
        <>
          {/* #139：工具区可编排；新增任务保留模板下拉（#132 portal） */}
          <ToolActsBar
            kind="group"
            titles={{
              progress: '打开本组的任务进程面板',
              addMember: '挑项目加进这个组',
              orch: '打开可视化编排面板',
              deleted: '查看本组已删除的任务（可恢复）',
              refs: '查看文档 / reference 列表',
            }}
            labels={{
              more: deletedTasks.length ? `更多 (${deletedTasks.length})` : '更多',
              deleted: deletedTasks.length ? `已删除任务（${deletedTasks.length}）` : '已删除任务',
            }}
            disabled={{ new: !sel }}
            renderers={{
              new: () => (
                <div className="rp-newtask" ref={newtaskRef}>
                  {/* #161 拆两级命中区（视觉一颗按钮）：主区点击 = 按默认模板直接
                      新建；内嵌箭头 = 模板下拉（选择模板新建） */}
                  <button
                    type="button"
                    className={'btn small' + (tplFlyOpen ? ' is-open' : '')}
                    title="按默认模板新建任务（▾ 选模板；携带本组语义）"
                    disabled={!sel}
                    onClick={() => createTask('')}
                  >
                    ＋ 新增任务
                    <span
                      role="button"
                      tabIndex={sel ? 0 : undefined}
                      aria-label="选择模板新建任务"
                      aria-haspopup="menu"
                      aria-expanded={tplFlyOpen}
                      className={'rp-newtask-caret' + (tplFlyOpen ? ' rot' : '')}
                      title="选择模板新建任务"
                      onClick={(e) => {
                        e.stopPropagation();
                        const host = e.currentTarget.closest('.rp-newtask');
                        const r = (host || e.currentTarget).getBoundingClientRect();
                        setTplFlyPos({
                          top: r.bottom + 6,
                          right: Math.max(8, window.innerWidth - r.right),
                        });
                        setTplFlyOpen((v) => !v);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          const host = e.currentTarget.closest('.rp-newtask');
                          const r = (host || e.currentTarget).getBoundingClientRect();
                          setTplFlyPos({
                            top: r.bottom + 6,
                            right: Math.max(8, window.innerWidth - r.right),
                          });
                          setTplFlyOpen((v) => !v);
                        }
                      }}
                    >
                      <Icon name="chevron" size={11} title={undefined} />
                    </span>
                  </button>
                  {tplFlyOpen &&
                    sel &&
                    tplFlyPos &&
                    createPortal(
                      <div
                        ref={tplFlyRef}
                        className="rp-tpl-fly rp-tpl-fly-portal"
                        role="menu"
                        aria-label="选择模板新建任务"
                        style={{ top: tplFlyPos.top, right: tplFlyPos.right }}
                      >
                        <div className="rp-tpl-fly-h">{board.name} · 可用模板</div>
                        <div className="rp-tpl-fly-list">
                          {(flyTemplates.length
                            ? flyTemplates
                            : [{ id: '__fallback__', name: '按默认模板新建', fallback: true }]
                          ).map((t: TemplateItem) => (
                            <button
                              key={t.id}
                              type="button"
                              className="rp-tpl-fly-it"
                              role="menuitem"
                              onClick={() => {
                                setTplFlyOpen(false);
                                createTask(
                                  t.fallback
                                    ? ''
                                    : renderTemplateBody(t.body, { ...NEW_TEMPLATE_VALUES, ...(t.values || {}) })
                                );
                              }}
                            >
                              {(t.id === tpl.defaultId && !t.fallback ? '✓ ' : '') + t.name}
                            </button>
                          ))}
                        </div>
                        <div className="rp-tpl-fly-foot">
                          <button
                            type="button"
                            className="rp-tpl-fly-new"
                            onClick={() => {
                              setTplFlyOpen(false);
                              newTemplateHere();
                            }}
                          >
                            ＋ 新增模板…
                          </button>
                        </div>
                      </div>,
                      document.body
                    )}
                </div>
              ),
            }}
            actions={{
              progress: () => {
                if (!model) return;
                openPanel(model, {
                  component: 'progress',
                  name: '进程',
                  config: { groupKey: dirKey },
                  location: 'right',
                });
              },
              addMember: () => setAddOpen(true),
              orch: () => {
                if (!model) return;
                openPanel(model, {
                  component: 'dag',
                  name: '编排',
                  config: { dirKey: (sel && sel.topicKey) || '', groupId: board && board.id },
                });
              },
              refs: () => {
                if (!model || !board) return;
                openPanel(model, {
                  component: 'refs',
                  name: '文档列表',
                  config: { boardKey: dirKey, boardName: board.name },
                  location: 'right',
                });
              },
              deleted: () => setShowDeleted(true),
            }}
          />
        </>)
      }
    >
      {dialogNode}

      {/* 组介绍（board/<组>.md，文字超链接打开 DocPanel）放在本组任务**上方**——
          先看这个组是干什么的，再看活儿 */}

      {/* 首屏：本组任务面板——只列 frontmatter.board 指向本组的任务，项目 tag 标归属。
          #164：面板外壳与任务行抽到 components/task-panel（与目录任务页共用）；
          #167 三轮：列表进 usePager 分页（待领取在前、历史在后混排当前页），
          与目录页完全同构，历史行走 history 样式 + StatusTag 真实状态。 */}

      {/* 翻页条：与目录任务页同款（#167 三轮：group 列表加分页） */}

      {/* 添加成员：就地弹窗（项目 + 项目组，可搜索） */}
      {addOpen && board ? (
        <MemberPicker
          board={board}
          boards={boards as unknown as never[]}
          repos={repos as unknown as never[]}
          onClose={() => setAddOpen(false)}
          onChanged={() => app.refreshRepos && app.refreshRepos()}
        />
      ) : null}

      {/* #169：本组已删除任务（组任务跨多个成员队列，恢复按各自队列定位） */}
      {showDeleted && (
        <DeletedPanel
          tasks={deletedTasks}
          onClose={() => setShowDeleted(false)}
          onRestore={restoreDeleted}
          onPurge={purgeDeleted}
        />
      )}
    </Layout>
  );
}
