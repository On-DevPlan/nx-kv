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
import { openTemplateEditor } from '../../panels.jsx';
import GetLoopMembersMenu from '../../components/repos/get-loop-members.js';
import GetLoopModal from '../../components/repos/get-loop-modal.js';
import { docIdOf, nextDraftId, saveDoc, scopeOf } from '../../modules/md/doc-store.js';
import { parseFrontmatter, withFrontmatter } from '../../modules/md/md-parse.js';
import { sortTasksForDisplay } from '../../modules/board/board-view.js';
import { putManageSession } from '../../modules/md/manage-session.js';
import { useTemplates, useTemplatesFor } from '../../modules/md/use-templates.js';
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

/** 模板下拉里的一项（flyTemplates 为接口数据，形状按用到的字段收窄）。 */
interface TemplateItem {
  id: string;
  name: string;
  body?: string;
  values?: Record<string, string>;
  fallback?: boolean;
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
  const tpl = useTemplates();
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
      if (!r.key || r.isGlobal) continue;
      const pend = (r.tasks || []).filter((t) => t && !t.deletedAt && !t.migratedTo && t.status === 'pending');
      const downstream: Record<string, number[]> = {};
      pend.forEach((t, i) => {
        if (t.blocksFollowing) downstream[t.id] = pend.slice(i + 1).map((x) => x.id);
      });
      map.set(r.key, { tasks: pend, downstream });
    }
    return map;
  }, [topics]);

  // 本组任务 = 成员队列里**正文 frontmatter.board 指向本组**的任务。
  // 显示序与目录页同源（sortTasksForDisplay：待领取在前，历史按状态沉底）。
  const groupRows = useMemo(() => {
    const ids = board ? [board.id, board.key, board.name].filter(Boolean) : [];
    const list: Array<{ member: MemberItem; task: TopicTask }> = [];
    for (const it of items) {
      for (const t of it.tasks || []) {
        if (t.deletedAt) continue; // 软删的不进列表（#180 起 web 不再提供回收站入口，恢复走 CLI）
        const fm = parseFrontmatter(t.text);
        if (!fm.board || !ids.includes(fm.board)) continue;
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

  // 新建任务的默认归属项目：第一个有待领取的成员（面板一打开就对准活儿），
  // 都没有就第一个成员。编辑页的工具区里还可以改（限本组成员）。
  const sel = items.find((it) => it.pending > 0) || items[0] || null;

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

  // 组里建任务：草稿预写 frontmatter（board + 默认归属项目），提交时编辑页的工具区
  // 可改归属项目（限本组成员），按它路由进对应项目的队列。
  const createTask = (pick?: { id?: string; body?: unknown } | null) => {
    if (!board) return;
    if (!sel) return toast('这个组还没有成员——先「添加成员」，再建任务');
    const id = nextDraftId();
    // 草稿 doc 种在**组 scope**：从 #/group/<id>?task=draft-N 打开寻得回同一份（#86）
    const docId = docIdOf(scopeOf(board.id), id);
    // 与目录任务页同一条口径：正文取模板原文，归属字段写进 frontmatter。
    const extra = { board: board.id, project: sel.key };
    saveDoc(docId, {
      title: '',
      body: withFrontmatter(pick ? String(pick.body || '') : tpl.defaultPick().body, extra),
    });
    app.openPage?.({ groupId: board.id, task: id, name: '新任务' });
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
    openTemplateEditor(model, { mode: 'new', scope: [`group:${board.key}`], name: '' });
  };

  // #151：与目录页同款下拉（模板项 / 新建 / 管理本主题模板）
  const openTplManage = () => {
    if (!board) return;
    const id = putManageSession({
      topic: sel ? sel.topicKey : '',
      group: board.key || '',
      repo: sel ? sel.key : '',
      label: board.name || board.key,
    });
    app.onNavigate?.(`#/templates/manage/${id}`);
  };
  const tplMenuItems = [
    ...(flyTemplates.length
      ? flyTemplates.map((t: TemplateItem) => ({
          label: (t.id === tpl.defaultId ? '✓ ' : '') + t.name,
          icon: 'list',
          onClick: () => createTask(t.fallback ? null : t),
        }))
      : [{ label: '按默认模板新建一页', icon: 'list', onClick: () => createTask() }]),
    'sep',
    { label: '为本组新建模板…', icon: 'plus', onClick: newTemplateHere },
    { label: '管理模板…', icon: 'gear', onClick: openTplManage },
  ] as any[];

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
