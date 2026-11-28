// 项目组详情（#/group/<看板 id>）：组是**操作单元**，不是树里的一层文件夹。
//
// 本页就是**本组任务面板**：一列列出全部「在本组创建」的任务——任务正文头部带
// frontmatter（board/project，提交时自动写入），每条用项目 tag 标出归属；
// 「新增任务」进 MD 编辑页，工具区选归属项目（限本组成员），提交按 frontmatter.project
// 路由进对应项目的队列。
//
// #251：整页交互与目录任务页**同一份模板**（components/task-panel/task-page）——
// 工具区 / 搜索 / 全选 / 多选批量条 / 行尾菜单 / 翻页 / 拖动排序不再各写一遍；
// 行尾与批量动作的流程在 components/task-panel/task-ops。本页只做接线：
// 把每个行 key 解析回「哪个成员队列 + 哪条任务」，动作层只认 scope。
import { useMemo, useState } from 'react';
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { readGroupProject } from './group-project-memo.js';
import { useDialog } from '../../components/popup/index.jsx';
import { useToast } from '../../components/toast/index.jsx';
import Introduction from '../../components/Introduction/index.jsx';
import MemberPicker from '../../components/board/member-picker.jsx';
import DagEditor from '../../components/task-panel/dag-editor.jsx';
import TaskPage from '../../components/task-panel/task-page.jsx';
import type { TaskPageRow } from '../../components/task-panel/task-page.jsx';
import {
  runBatchCancel,
  runBatchComplete,
  runBatchDelete,
  runDeleteTask,
  runFeedbackTask,
  runPlanSwitch,
  runToggleGate,
  saveDagPatches,
} from '../../components/task-panel/task-ops.js';
import type { DagPatchInput, ScopeIds, TaskOpsDeps } from '../../components/task-panel/task-ops.js';
import { useApp } from '../../app-context.jsx';
import { addTask, reorderTask } from './api.js';
import { openPanel } from '../../workspace.js';
import GetLoopMembersMenu from '../../components/repos/get-loop-members.js';
import GetLoopModal from '../../components/repos/get-loop-modal.js';
import { createTaskAndOpen } from '../../modules/task/create.js';
import { sortTasksForDisplay } from '../../modules/board/board-view.js';
import { usePretaskEntries } from '../../modules/pretask/use-pretask.js';
import { entryMenuItems } from '../../modules/pretask/menu.js';
import { draftBodyOf, openDraftEntry, openPanelEntry, openVisibilityPanel } from '../../modules/pretask/open-entry.js';
import type { PretaskEntry } from '../../modules/pretask/types.js';
import type { LocalTask, LocalTopic, RepoData, RepoRow } from '../../types.js';
import type { Model } from 'flexlayout-react';
import type { BoardRecord } from '../repos/repo-table.js';

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

export default function GroupView({ dirKey, rows, repoData, model }: {
  dirKey?: string;
  rows?: LocalTopic[];
  repoData?: RepoData;
  model?: Model | null;
}) {
  const toast = useToast();
  const app = useApp();
  const { dialog, node: dialogNode } = useDialog();
  // repoData / rows 来自 /api 负载（外部边界）：到这里按本页真正读的字段收窄一次
  const boards = ((repoData && repoData.boards) || []) as BoardRecord[];
  const repos = (repoData && repoData.repos) || [];
  const topics = (rows || []) as TopicRow[];
  // 「添加成员」就地弹窗（不跳仓库管理页——组面板里就地改归属）
  const [addOpen, setAddOpen] = useState(false);
  // #250：持续 get 的成员子菜单 + 配置弹窗（两个状态都在页面层：PopMenu 先关后选）
  const [glMenu, setGlMenu] = useState<{ x: number; y: number } | null>(null);
  const [glRepo, setGlRepo] = useState<RepoRow | null>(null);
  // 行尾「编排依赖…」：被编排的任务 + 它所在成员队列
  const [dag, setDag] = useState<{ rowKey: string } | null>(null);

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
      if (!t.repo || !t.repo.key) continue;
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
        desc: (repo && repo.desc) || '',
        pending: topic ? topic.pending || 0 : 0,
        waiting: !!(topic && topic.waiting),
        topicKey: topic ? topic.key : '',
        summary: topic ? topic.summary || '' : '',
        tasks: topic ? (topic.tasks || []) : [],
        present: m.present !== false,
        // 组内描述文档：后端直接给 ref:<refId>
        noteDocId: m.noteDocId || '',
      };
    });
  }, [board, repos, topics]);

  // 每个成员队列的编排素材：待领取任务（队列序）+ 闸门的下游映射（同 isReadyToClaim 口径）。
  const dagByTopic = useMemo<Map<string, { tasks: TopicTask[]; downstream: Record<string, number[]> }>>(() => {
    const map = new Map<string, { tasks: TopicTask[]; downstream: Record<string, number[]> }>();
    for (const r of topics) {
      if (!r.key) continue;
      const pend = (r.tasks || []).filter((t) => t && !t.deletedAt && !t.migratedTo && t.status === 'pending');
      const downstream: Record<string, number[]> = {};
      pend.forEach((t, i) => {
        if (t.blocksFollowing) downstream[t.id] = pend.slice(i + 1).map((x) => x.id);
      });
      map.set(r.key, { tasks: pend, downstream });
    }
    return map;
  }, [topics]);

  // 本组任务 = 成员队列里**归属本组**的任务（#197：读 DB 关联的 boardKey =
  // topics.group_key，不再解析正文 frontmatter）。显示序与目录页同源。
  const groupRows = useMemo(() => {
    const ids = board ? [board.id, board.key, board.name].filter(Boolean) : [];
    const list: Array<{ member: MemberItem; task: TopicTask }> = [];
    for (const it of items) {
      for (const t of it.tasks || []) {
        if (t.deletedAt) continue; // 软删的不进列表（#180 起 web 不再提供回收站入口，恢复走 CLI）
        const bk = String((t as any).boardKey || '');
        if (!bk || !ids.includes(bk)) continue;
        list.push({ member: it, task: t });
      }
    }
    const order = new Map<TopicTask, number>();
    sortTasksForDisplay(list.map((x) => x.task)).forEach((t, i) => order.set(t as TopicTask, i));
    return list.sort((a, b) => (order.get(a.task) ?? 0) - (order.get(b.task) ?? 0));
  }, [board, items]);

  const rowKey = (member: MemberItem, task: TopicTask) => member.key + ':' + task.id;
  // 行 key → 行（动作层只认 scope，本页负责把 key 解析回「成员队列 + 任务」）
  const metaOf = useMemo(() => {
    const map = new Map<string, { member: MemberItem; task: TopicTask; row: TaskPageRow }>();
    for (const { member, task } of groupRows) {
      const key = rowKey(member, task);
      map.set(key, {
        member,
        task,
        row: {
          key,
          task,
          projectTag: member.name,
          projectTitle: `归属项目：${member.name}`,
          showTimes: true, // 与目录页同一行结构
          movable: task.status === 'pending' && !!member.topicKey,
          downs: dagByTopic.get(member.topicKey)?.downstream[task.id] || [],
        },
      });
    }
    return map;
  }, [groupRows, dagByTopic]);
  const pageRows = useMemo(() => [...metaOf.values()].map((x) => x.row), [metaOf]);

  // 默认归属项目（#187）：上次在这个组选过的优先 → 第一个有待领取的 → 第一个成员。
  // 编辑页工具区里仍可改（限本组成员），改完会被记住（task-board-section 的 onChange）。
  const memoKey = readGroupProject(board ? board.id : '');
  const sel = items.find((it) => it.key === memoKey) || items.find((it) => it.pending > 0) || items[0] || null;

  // 插件 pretask 入口：组本身是可见主体；选中成员时优先成员 topic 的可见性。
  const entryState = usePretaskEntries({
    topic: sel ? sel.topicKey : '',
    group: board ? board.key : '',
    repo: sel ? sel.key : '',
  });
  const entryCtx = {
    topicKey: sel?.topicKey || '',
    groupKey: board?.key || '',
    repoKey: sel?.key || '',
    groupId: board?.id || '',
    board: board?.id || '',
    project: sel?.key || '',
    dirKey: sel?.topicKey || '',
    cwd: sel?.cwd || '',
    topic: {
      key: sel?.topicKey || '',
      name: sel?.name || sel?.key || '',
      kind: 'group' as const,
      cwd: sel?.cwd || '',
      repoKey: sel?.key || '',
      groupKey: board?.key || '',
      repoName: sel?.name || '',
      groupName: board?.name || '',
      repoRoot: sel?.path || '',
    },
    location: {
      dirKey: sel?.topicKey || '',
      groupId: board?.id || '',
      board: board?.id || '',
      project: sel?.key || '',
    },
  };
  // 默认入口（#286 改口径）：只有显式配置才生效；未配置 = 「＋ 新建页」落空白任务页。
  const defaultEntry = entryState.defaultExplicit
    ? entryState.entries.find((e) => e.id === entryState.defaultEntryId)
    : undefined;

  // 动作层依赖：弹窗 / 提示 / 刷新 / 文档落点（组 scope 的 doc key = 看板 id）
  const ops: TaskOpsDeps = {
    dialog,
    toast,
    refresh: () => app.refreshLocal?.(),
    docKey: board?.id || '',
  };
  // 行 → 队列定位（目录页是单主题，组页按成员 cwd）
  const scopeOfKey = (key: string) => {
    const m = metaOf.get(key);
    const cwd = m ? (m.member.cwd || m.member.path) : '';
    return cwd ? { cwd } : null;
  };
  /** 选中行 → 按成员队列分组的编号（批量接口按 topic 提交）。 */
  const groupsOf = (rs: TaskPageRow[]): ScopeIds[] => {
    const byCwd = new Map<string, number[]>();
    for (const r of rs) {
      const scope = scopeOfKey(r.key);
      if (!scope) continue;
      byCwd.set(scope.cwd, [...(byCwd.get(scope.cwd) || []), Number(r.task.id)]);
    }
    return [...byCwd.entries()].map(([cwd, ids]) => ({ scope: { cwd }, ids }));
  };

  const createPlanTask = (body: string, title = '') => {
    if (!board || !sel) return Promise.resolve(null);
    return createTaskAndOpen(
      { openPage: app.openPage, onNavigate: app.onNavigate, refreshLocal: app.refreshLocal },
      {
        text: body,
        title,
        status: 'plan',
        groupId: board.id,
        board: board.id,
        project: sel.key,
        cwd: sel.cwd,
      },
    );
  };

  // 组里建任务：优先走默认插件入口；有 form 进插件页面，panel 进插件页面，否则生成草稿。
  const createTask = (entry?: PretaskEntry) => {
    if (!board) return;
    if (!sel) return toast('这个组还没有成员——先「添加成员」，再建任务');
    const chosen = entry || defaultEntry;
    if (!chosen) {
      void createPlanTask('').catch((e) => toast(String((e as Error).message || e)));
      return;
    }
    const go = (hash: string) => app.onNavigate?.(hash);
    if (chosen.kind === 'panel') {
      openPanelEntry(chosen, entryCtx, go);
      return;
    }
    if (openDraftEntry(chosen, entryCtx, go)) return;
    void (async () => {
      try {
        await createPlanTask(await draftBodyOf(chosen, entryCtx));
      } catch (e) {
        toast(String((e as Error).message || e));
      }
    })();
  };

  // 导入 .md：与目录页同一个入口，只是落点带本组语义（board + 归属项目）
  const importMd = async (file: File) => {
    if (!board) return;
    if (!sel) return toast('这个组还没有成员——先「添加成员」，再导入');
    const text = await file.text();
    const name = file.name.replace(/\.md$/i, '');
    const bodyText = text.startsWith('#') ? text : `# ${name}\n\n${text}`;
    try {
      const res = await addTask({ board: board.id, project: sel.key, text: bodyText });
      toast(`已导入：${file.name}`);
      await app.refreshLocal?.();
      const newId = res?.task?.id ?? res?.id;
      if (newId != null) app.openPage?.({ groupId: board.id, task: String(newId), name: `#${newId}` });
    } catch (e) {
      toast(String((e as Error).message || e));
    }
  };

  const tplMenuItems = [
    ...entryMenuItems(entryState.entries, (entry) => createTask(entry)),
    ...(entryState.entries.length ? ['sep' as const] : []),
    {
      label: '配置新建页行为…',
      icon: 'gear',
      onClick: () =>
        openVisibilityPanel(model, {
          scopeKey: sel?.topicKey
            ? `topic:${sel.topicKey}`
            : sel?.key
              ? `repo:${sel.key}`
              : board
                ? `group:${board.key}`
                : '',
          label: board?.name || board?.key || '本组',
          topic: sel?.topicKey || '',
          group: board?.key || '',
          repo: sel?.key || '',
        }),
    },
  ];

  // #185：这个早退**必须排在所有 hook 之后**。它原来在 usePager / useTemplatesFor 之前，
  // 于是「首帧 boards 还没到」与「boards 到了」两次渲染的 hook 数量不同 →
  // React 抛 "Rendered more hooks than during the previous render" → 面板白屏。
  if (!board) {
    return (
      <div className="rp-page">
        <RouteBreadcrumb />
        <div className="rp-empty">项目组不存在（看板可能被删了）</div>
      </div>
    );
  }

  const dagRow = dag ? metaOf.get(dag.rowKey) : null;
  const dagTasks = dagRow ? (dagByTopic.get(dagRow.member.topicKey)?.tasks || []) : [];

  return (
    <>
      <TaskPage
        kind="group"
        name={board.name}
        title="本组任务"
        intro={<Introduction kind="board" owner={board} model={model} />}
        rows={pageRows}
        // 头部计数：任务数 / 待领取由模板出，本页再加成员目录数
        extraCounts={[`${items.length} 个目录`]}
        emptyText="本组还没有任务——点「＋ 新建页」创建；只有在本组创建的任务（携带本组语义）才会出现在这里。"
        tplMenuItems={tplMenuItems}
        onNew={() => createTask()}
        newDisabled={!sel}
        onOpenRow={(r) =>
          app.openPage?.({ groupId: board.id, task: String(r.task.id), name: `#${r.task.id}` })
        }
        onMoveRow={(src, dst, zone) => {
          const a = metaOf.get(src.key);
          const b = metaOf.get(dst.key);
          if (!a || !b) return;
          // 组任务横跨多个成员队列：reorder 按 topic 生效，只允许同一队列内换位
          if (a.member.topicKey !== b.member.topicKey) {
            toast('只能在同一项目队列内排序（跨项目请用编排连线）');
            return;
          }
          const cwd = a.member.cwd || a.member.path;
          if (!a.member.topicKey || !cwd) {
            toast('该成员还没有本地队列，无法排序');
            return;
          }
          void reorderTask({
            cwd,
            id: Number(a.task.id),
            ...(zone === 'before' ? { beforeId: Number(b.task.id) } : { afterId: Number(b.task.id) }),
          })
            .then(() => app.refreshLocal?.())
            .catch((err) => toast(String((err as Error).message || err)));
        }}
        onImportFile={(f) => void importMd(f)}
        onTogglePlan={(rs, to) => {
          const byCwd = new Map<string, Array<number | string>>();
          for (const r of rs) {
            const s = scopeOfKey(r.key);
            if (!s) continue;
            byCwd.set(s.cwd, [...(byCwd.get(s.cwd) || []), r.task.id]);
          }
          void runPlanSwitch(
            ops,
            [...byCwd.entries()].map(([cwd, ids]) => ({ scope: { cwd }, ids })),
            to
          );
        }}
        onOpenDag={(r) => setDag({ rowKey: r.key })}
        onToggleGate={(r) => {
          const s = scopeOfKey(r.key);
          if (s) void runToggleGate(ops, s, r.task);
        }}
        onFeedback={(r) => {
          const s = scopeOfKey(r.key);
          if (s) void runFeedbackTask(ops, s, r.task);
        }}
        onDeleteRow={(r) => {
          const s = scopeOfKey(r.key);
          if (s) void runDeleteTask(ops, s, r.task);
        }}
        onDeleteRows={(rs) => runBatchDelete(ops, groupsOf(rs))}
        onCancelRows={(rs) => runBatchCancel(ops, groupsOf(rs))}
        onCompleteRows={(rs) => runBatchComplete(ops, groupsOf(rs))}
        toolActs={{
          titles: {
            progress: '打开本组的任务进程面板',
            addMember: '挑项目加进这个组',
            orch: '打开可视化编排面板',
            refs: '查看文档 / reference 列表',
            getloop: '按成员项目配置持续 get（选一个项目去开/关）',
          },
          disabled: { new: !sel, import: !sel },
          actions: {
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
                config: { dirKey: (sel && sel.topicKey) || '', groupId: board.id },
              });
            },
            refs: () => {
              if (!model) return;
              openPanel(model, {
                component: 'refs',
                name: '文档列表',
                config: { boardKey: dirKey, boardName: board.name },
                location: 'right',
              });
            },
            // #250：组没有单一仓库——点击处弹成员子菜单（每行带开/关状态），选中再开配置弹窗
            getloop: (e) => {
              const hasTarget = items.some((it) => {
                const r = repos.find((x) => x.key === it.key);
                return !!(r && r.id);
              });
              if (!hasTarget) {
                toast('这个组还没有已登记本机的成员项目——先「添加成员」，持续 get 按项目配置');
                return;
              }
              if (!e) return;
              setGlMenu({ x: e.clientX, y: e.clientY });
            },
          },
        }}
        actionExtra={
          <>
            {glMenu && !glRepo && (
              <GetLoopMembersMenu
                x={glMenu.x}
                y={glMenu.y}
                members={items}
                repos={repos}
                onPick={(r) => {
                  setGlMenu(null);
                  setGlRepo(r);
                }}
                onClose={() => setGlMenu(null)}
              />
            )}
            {glRepo && (
              <GetLoopModal
                repo={glRepo as RepoRow & { id?: string }}
                onClose={() => setGlRepo(null)}
                onSaved={() => app.refreshRepos && app.refreshRepos()}
              />
            )}
          </>
        }
        extra={
          <>
            {dagRow && (
              <DagEditor
                task={dagRow.task}
                tasks={dagTasks}
                onClose={() => setDag(null)}
                onSave={(patches: DagPatchInput[]) => {
                  const s = scopeOfKey(dagRow.row.key);
                  return s ? saveDagPatches(ops, s, patches) : Promise.resolve();
                }}
              />
            )}
            {addOpen ? (
              <MemberPicker
                board={board}
                boards={boards as unknown as never[]}
                repos={repos as unknown as never[]}
                onClose={() => setAddOpen(false)}
                onChanged={() => app.refreshRepos && app.refreshRepos()}
              />
            ) : null}
            {dialogNode}
          </>
        }
      />
    </>
  );
}
