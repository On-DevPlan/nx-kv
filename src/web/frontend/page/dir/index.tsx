// 目录面板 —— 简介（统一 Introduction）+ 任务页模板（#251）。
//
// 本页只负责「目录这条主题」的数据与接线：主题定位、显示序、模板可见域、草稿落点。
// 列表的**整页交互**（工具区 / 搜索 / 全选 / 多选批量条 / 行尾菜单 / 翻页 / 拖动排序）
// 全在 components/task-panel/task-page（与项目组页同一份），行尾与批量动作的流程在
// components/task-panel/task-ops（同一份）——两页不再各写一遍。
import { useMemo, useState } from 'react';
import { addTask, reorderTask } from './api.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { isGroupTask } from '../../modules/board/board-view.js';
import { useApp } from '../../app-context.jsx';
import Introduction from '../../components/Introduction/index.jsx';
import GetLoopModal from '../../components/repos/get-loop-modal.js';
import DagEditor from '../../components/task-panel/dag-editor.jsx';
import { findOpenPanel, openPanel } from '../../workspace.js';
import { createTaskAndOpen } from '../../modules/task/create.js';
import { usePretaskEntries } from '../../modules/pretask/use-pretask.js';
import { entryMenuItems } from '../../modules/pretask/menu.js';
import { draftBodyOf, openDraftEntry, openPanelEntry, openVisibilityPanel } from '../../modules/pretask/open-entry.js';
import type { PretaskEntry } from '../../modules/pretask/types.js';
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
import type { DagPatchInput, TaskOpsDeps } from '../../components/task-panel/task-ops.js';
import { useUndoDelete } from '../../components/task-panel/undo-delete.js';
import TrashModal from './trash-modal.js';
import { sortTasksForDisplay } from './task-utils.js';
import type { LocalTask, RepoRow } from '../../types.js';

interface DirPanelProps {
  dirKey?: string;
}

export default function DirPanel({ dirKey }: DirPanelProps) {
  const { dialog, node: dialogNode } = useDialog();
  const app = useApp();
  const toast = useToast();
  const rows = app.rows || [];
  const refreshLocal = app.refreshLocal;
  const model = app.model;
  const repos = (app.repoData && app.repoData.repos) || [];

  const [dagTask, setDagTask] = useState<LocalTask | null>(null); // 正在编排依赖的任务（DAG 节点编辑器）
  // #165：持续 get（waitgoal）配置——按主题（仓库）粒度控制，收在工具区直读状态
  const [glOpen, setGlOpen] = useState(false);

  const topic = useMemo(() => rows.find((r) => r.key === dirKey) || null, [rows, dirKey]);

  const repo = useMemo<RepoRow | null>(() => {
    if (!topic) return null;
    const rk = topic.repo && topic.repo.key;
    if (rk) {
      const byKey = repos.find((r) => r.key === rk);
      if (byKey) return byKey;
    }
    const cwd = String(topic.cwd || '').replace(/\\/g, '/').toLowerCase();
    if (!cwd) return null;
    return repos.find((r) => String(r.path || '').replace(/\\/g, '/').toLowerCase() === cwd) || null;
  }, [topic, repos]);

  // 显示序：未完成（待领取）优先，追加的新任务不会被历史埋在下面；
  // 软删除的行不进表。#85 两种走向：目录页是**项目走向**的视图——组任务
  // （frontmatter.board）物理上在这条队列里，但归组页管，列表与计数一并排除。
  const allTasks = useMemo<LocalTask[]>(
    () => sortTasksForDisplay((topic?.tasks || []).filter((t) => !t.deletedAt && !isGroupTask(t))),
    [topic]
  );

  // 闸门 → 被它挡住的后续任务（队列序：pending 子序即领取序）。
  // 领取闸判定只看「排在我前面的 alive 闸门」（core/workflow/readiness），同一口径。
  const downstreamOf = useMemo(() => {
    const map: Record<string, number[]> = {};
    const pend = allTasks.filter((t) => t.status === 'pending' && !t.migratedTo && !t.deletedAt);
    pend.forEach((t, i) => {
      if (t.blocksFollowing) map[t.id] = pend.slice(i + 1).map((x) => x.id);
    });
    return map;
  }, [allTasks]);
  const dagCandidates = useMemo(
    () => allTasks.filter((t) => t.status === 'pending' && !t.migratedTo && !t.deletedAt),
    [allTasks]
  );

  // #181 搜索 / 分页 / 多选 / 拖动 / 行尾菜单都由 TaskPage 持有；这里只给行数据。
  const pageRows = useMemo<TaskPageRow[]>(
    () =>
      allTasks.map((t) => ({
        key: String(t.id),
        task: t,
        showTimes: true, // 目录页基线：行内显示 创建 → 领取 时间
        movable: t.status === 'pending' && !t.migratedTo && !t.deletedAt,
        downs: downstreamOf[t.id] || [],
      })),
    [allTasks, downstreamOf]
  );

  const guard = (fn: () => Promise<unknown>) => fn().catch((e) => toast(String((e as Error).message || e)));

  // 主题定位：按目录 cwd（行尾 / 批量 / 编排同一套；#190 全局池已删除）
  const scopeBody = () => ({ cwd: topic?.cwd });
  const topicKeyHere = dirKey || '';
  // 持续 get 的展示态（配置本身在 GetLoopModal 里改）
  const glOn = !!(repo && repo.getLoop && repo.getLoop.enabled);
  const glMinutes = repo && repo.getLoop && repo.getLoop.waitMinutes !== undefined && repo.getLoop.waitMinutes !== null
    ? Number(repo.getLoop.waitMinutes)
    : null;

  // #208：撤销删除弹窗（restore 闭包在 task-ops 内自带删除时的 scope）
  const undo = useUndoDelete();
  const [trashOpen, setTrashOpen] = useState(false);

  // 动作层的依赖：弹窗 / 提示 / 刷新 / 文档落点都来自本页
  const ops: TaskOpsDeps = {
    dialog,
    toast,
    refresh: () => {
      refreshLocal?.();
    },
    docKey: dirKey || 'local',
    onDeleted: (t) => {
      if (!model) return;
      // workspace.findOpenPanel 的返回类型尚未收口（被推断成 null），按实际契约窄化
      const page = findOpenPanel(model, 'page', { dirKey, task: String(t.id) }) as { getId: () => string } | null;
      if (page && app.closePanel) app.closePanel(page.getId());
    },
    // #208：软删成功弹 5 秒撤销窗（撤回调恢复 API）
    undoDelete: (item) => undo?.(item),
  };

  const openTask = (id: number | string) => {
    if (app.openPage) app.openPage({ dirKey, task: String(id), name: `#${id}` });
  };

  const createPlanTask = (body: string, title = '') =>
    guard(() =>
      createTaskAndOpen(
        { openPage: app.openPage, refreshLocal: app.refreshLocal },
        {
          text: body,
          title,
          status: 'plan',
          dirKey,
          cwd: topic?.cwd || '',
        },
      ),
    );

  const openProgress = () => {
    if (!model) return;
    openPanel(model, {
      component: 'progress',
      name: '进程',
      config: { dirKey: dirKey || '' },
      location: 'right',
    });
  };

  // 插件 pretask 入口：按当前主题取可见入口；默认入口用于「＋ 新建页」。
  const entryState = usePretaskEntries({ topic: topicKeyHere, repo: repo?.key || '' });
  const entryCtx = {
    topicKey: topicKeyHere,
    repoKey: repo?.key || String(topic?.repo_key || ''),
    groupKey: '',
    cwd: topic?.cwd || '',
    dirKey,
    topic: {
      key: topicKeyHere,
      name: topic?.name || dirKey || '',
      kind: 'repo' as const,
      cwd: topic?.cwd || '',
      repoKey: repo?.key || String(topic?.repo_key || ''),
      groupKey: '',
      repoName: repo?.name || '',
      groupName: '',
      repoRoot: repo?.path || topic?.cwd || '',
    },
    location: { dirKey },
  };
  // 默认入口（#286 改口径）：只有本主题显式配置才生效；未配置 = 「＋ 新建页」直接
  // 创建空白任务页进编辑（不再回落插件声明/首个可见入口）。
  const defaultEntry = entryState.defaultExplicit
    ? entryState.entries.find((e) => e.id === entryState.defaultEntryId)
    : undefined;

  const pickEntry = (entry: PretaskEntry) => {
    const go = (hash: string) => app.onNavigate?.(hash);
    if (entry.kind === 'panel') {
      openPanelEntry(entry, entryCtx, go);
      return;
    }
    if (openDraftEntry(entry, entryCtx, go)) return;
    void (async () => {
      await createPlanTask(await draftBodyOf(entry, entryCtx));
    })();
  };

  const tplMenuItems = [
    ...entryMenuItems(entryState.entries, pickEntry),
    ...(entryState.entries.length ? ['sep' as const] : []),
    {
      label: '配置新建页行为…',
      icon: 'gear',
      onClick: () =>
        openVisibilityPanel(model, {
          scopeKey: `topic:${topicKeyHere}`,
          label: topic?.name || dirKey || '本目录',
          topic: topicKeyHere,
          repo: repo?.key || '',
        }),
    },
  ];

  // ─── 文档列表（右侧栏）────────────────────────────────────────────
  const openRefs = () => {
    if (!repo) {
      toast('这个目录还没有登记为仓库，没有项目文档列表');
      return;
    }
    if (!model) return;
    const rk = repo.key || (topic?.repo && topic.repo.key) || '';
    if (!rk) {
      toast('这个项目还没有仓库标识（key），无法定位文档列表');
      return;
    }
    openPanel(model, {
      component: 'refs',
      name: '文档列表',
      config: { repoKey: rk },
      location: 'right',
    });
  };

  const importMd = async (file: File) => {
    const text = await file.text();
    const name = file.name.replace(/\.md$/i, '');
    await guard(async () => {
      const bodyText = text.startsWith('#') ? text : `# ${name}\n\n${text}`;
      const res = await addTask({ cwd: topic?.cwd, text: bodyText });
      toast(`已导入：${file.name}`);
      refreshLocal?.();
      const newId = res?.task?.id ?? res?.id;
      if (newId != null) openTask(newId);
    });
  };

  if (!topic) {
    // 空态与组页同骨架（#170：落地页不套 .mdw 编辑器外壳；#251：两页空态都走 rp-page）
    return (
      <div className="rp-page">
        <div className="rp-empty">目录不存在（主题可能被删了）</div>
      </div>
    );
  }

  return (
    // #170：落地页**不再套 .mdw 工作台外壳**——.mdw 是「MD 编辑器」的外壳
    // （自带 canvas 米色底 + 一整套 .mdw 作用域的按钮/字号口径）。落地页只是
    // 队列列表页，套上它会让**同款按钮在目录页与项目组页呈现两套观感**
    // （.mdw .btn.ghost 透明浅边 vs .btn.ghost 灰底），页面底色也不同。
    <>
      <TaskPage
        kind="dir"
        name={topic?.name || '目录'}
        title='任务'
        intro={repo ? <Introduction kind="repo" owner={repo} model={model} /> : null}
        rows={pageRows}
        emptyText='还没有页面：点「＋ 新建页」写第一篇，或让 agent 往这个目录投递任务。'
        tplMenuItems={tplMenuItems}
        onNew={() => {
          if (defaultEntry) pickEntry(defaultEntry);
          else createPlanTask('');
        }}
        onOpenRow={(r) => openTask(r.task.id)}
        onImportFile={(f) => void importMd(f)}
        onMoveRow={(src, dst, zone) => guard(async () => {
          // 服务端只许 pending ↔ pending 换位（已领取是固定历史），UI 侧已同口径过滤
          await reorderTask({
            ...scopeBody(),
            id: src.task.id,
            ...(zone === 'before' ? { beforeId: dst.task.id } : { afterId: dst.task.id }),
          });
          refreshLocal?.();
        })}
        onTogglePlan={(rs, to) =>
          void runPlanSwitch(ops, [{ scope: { key: topicKeyHere }, ids: rs.map((r) => r.task.id) }], to)
        }
        onOpenDag={(r) => setDagTask(r.task)}
        onToggleGate={(r) => void runToggleGate(ops, scopeBody(), r.task)}
        onFeedback={(r) => void runFeedbackTask(ops, scopeBody(), r.task)}
        onDeleteRow={(r) => void runDeleteTask(ops, scopeBody(), r.task)}
        onDeleteRows={(rs) =>
          runBatchDelete(ops, [{ scope: scopeBody(), ids: rs.map((r) => Number(r.task.id)) }])
        }
        onCancelRows={(rs) =>
          runBatchCancel(ops, [{ scope: scopeBody(), ids: rs.map((r) => Number(r.task.id)) }])
        }
        onCompleteRows={(rs) =>
          runBatchComplete(ops, [{ scope: scopeBody(), ids: rs.map((r) => Number(r.task.id)) }])
        }
        toolActs={{
          // #165：持续 get 开/关状态直读（配置弹窗点开改）
          renderers: {
            getloop: () => (
              <button
                type="button"
                className="btn small ghost"
                title={glOn
                  ? `持续 get 已开启：agent 领完任务没活时会阻塞等待（每轮 ${glMinutes ?? 10} 分钟）——点这里去配置/关闭`
                  : '持续 get 未开启：开启后 agent 领完任务没活会自动唤起阻塞等待——点这里配置'}
                onClick={() => setGlOpen(true)}
              >
                {glOn ? `持续 get：开（${glMinutes ?? 10} 分钟）` : '持续 get：关'}
              </button>
            ),
          },
          actions: {
            progress: openProgress,
            orch: () => model && openPanel(model, { component: 'dag', name: '编排', config: { dirKey } }),
            refs: openRefs,
            getloop: () => setGlOpen(true),
            trash: () => setTrashOpen(true),
          },
        }}
        actionExtra={glOpen && repo ? <GetLoopModal repo={repo} onClose={() => setGlOpen(false)} onSaved={() => app.refreshRepos?.()} /> : null}

        extra={
          <>
            {trashOpen && (
              <TrashModal scopes={[scopeBody()]} onClose={() => setTrashOpen(false)} onChanged={() => refreshLocal?.()} />
            )}
            {dagTask && (
              <DagEditor
                task={dagTask}
                tasks={dagCandidates}
                onClose={() => setDagTask(null)}
                onSave={(patches: DagPatchInput[]) => saveDagPatches(ops, scopeBody(), patches)}
              />
            )}
            {dialogNode}
          </>
        }
      />
    </>
  );
}
