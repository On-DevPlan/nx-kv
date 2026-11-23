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
import { GLOBAL_KEY, isGroupTask } from '../../modules/board/board-view.js';
import { useApp } from '../../app-context.jsx';
import Introduction from '../../components/Introduction/index.jsx';
import GetLoopModal from '../../components/repos/get-loop-modal.js';
import DagEditor from '../../components/task-panel/dag-editor.jsx';
import { findOpenPanel, openPanel } from '../../workspace.js';
import { openTemplateEditor } from '../../panels.jsx';
import { docIdOf, nextDraftId, saveDoc, scopeOf } from '../../modules/md/doc-store.js';
import { putManageSession } from '../../modules/md/manage-session.js';
import { useTemplatesFor } from '../../modules/md/use-templates.js';
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
import { sortTasksForDisplay } from './task-utils.js';
import type { LocalTask, PromptTemplate, RepoRow } from '../../types.js';

interface DirPanelProps {
  dirKey?: string;
}

export default function DirPanel({ dirKey }: DirPanelProps) {
  const { dialog, node: dialogNode } = useDialog();
  const app = useApp();
  const toast = useToast();
  const rows = app.rows || [];
  const refreshLocal = app.refreshLocal;
  const tpl = app.tpl;
  const model = app.model;
  const repos = (app.repoData && app.repoData.repos) || [];

  const isGlobal = !dirKey || dirKey === GLOBAL_KEY;
  const [dagTask, setDagTask] = useState<LocalTask | null>(null); // 正在编排依赖的任务（DAG 节点编辑器）
  // #165：持续 get（waitgoal）配置——按主题（仓库）粒度控制，收在工具区直读状态
  const [glOpen, setGlOpen] = useState(false);

  const topic = useMemo(() => {
    if (isGlobal) return rows.find((r) => r.isGlobal) || null;
    return rows.find((r) => r.key === dirKey) || null;
  }, [rows, dirKey, isGlobal]);

  const repo = useMemo<RepoRow | null>(() => {
    if (!topic || isGlobal) return null;
    const rk = topic.repo && topic.repo.key;
    if (rk) {
      const byKey = repos.find((r) => r.key === rk);
      if (byKey) return byKey;
    }
    const cwd = String(topic.cwd || '').replace(/\\/g, '/').toLowerCase();
    if (!cwd) return null;
    return repos.find((r) => String(r.path || '').replace(/\\/g, '/').toLowerCase() === cwd) || null;
  }, [topic, repos, isGlobal]);

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

  // 主题定位二选一：全局池用 key，目录用 cwd（行尾 / 批量 / 编排同一套）
  const scopeBody = () => (isGlobal ? { key: GLOBAL_KEY } : { cwd: topic?.cwd });
  const topicKeyHere = isGlobal ? GLOBAL_KEY : dirKey || GLOBAL_KEY;
  // 持续 get 的展示态（配置本身在 GetLoopModal 里改）
  const glOn = !!(repo && repo.getLoop && repo.getLoop.enabled);
  const glMinutes = repo && repo.getLoop && repo.getLoop.waitMinutes !== undefined && repo.getLoop.waitMinutes !== null
    ? Number(repo.getLoop.waitMinutes)
    : null;

  // 动作层的依赖：弹窗 / 提示 / 刷新 / 文档落点都来自本页
  const ops: TaskOpsDeps = {
    dialog,
    toast,
    refresh: () => {
      refreshLocal?.();
    },
    docKey: dirKey || GLOBAL_KEY,
    onDeleted: (t) => {
      if (!model) return;
      // workspace.findOpenPanel 的返回类型尚未收口（被推断成 null），按实际契约窄化
      const page = findOpenPanel(model, 'page', { dirKey, task: String(t.id) }) as { getId: () => string } | null;
      if (page && app.closePanel) app.closePanel(page.getId());
    },
  };

  const openTask = (id: number | string) => {
    if (app.openPage) app.openPage({ dirKey, task: String(id), name: `#${id}` });
  };

  const newDraft = (body: string) => {
    const task = nextDraftId();
    // 正文先写进 doc-store：openPage 只透传 dirKey / task / name，body 会被丢掉
    // （按模板新建时丢的就是模板正文）。
    saveDoc(docIdOf(scopeOf(dirKey), task), { title: '', body });
    if (app.openPage) app.openPage({ dirKey, task, name: '新任务' });
  };

  // #151：「管理模板…」进**本主题**级管理页（不是全局 #/templates）
  const openTplList = () => {
    const id = putManageSession({
      topic: topicKeyHere,
      repo: isGlobal ? '' : (repo?.key || ''),
      label: isGlobal ? '全局池' : (topic?.name || dirKey || '本目录'),
    });
    app.onNavigate?.(`#/templates/manage/${id}`);
  };

  const openProgress = () => {
    if (!model) return;
    openPanel(model, {
      component: 'progress',
      name: '进程',
      config: { dirKey: dirKey || GLOBAL_KEY },
      location: 'right',
    });
  };

  // #128 模板可见域：「模板 ▾」只列**本主题可用**的模板（服务端按 scope 过滤）。
  // 三档退化都回落全量（scoped 未加载/旧 serve/失败时 templates=null），菜单不变空。
  const scopedTpl = useTemplatesFor(topicKeyHere);
  const menuTemplates: PromptTemplate[] = scopedTpl.templates || (tpl && tpl.templates) || [];

  // 「为本目录新建模板」（#135）：不弹窗，直进全屏编辑；标题即名称。
  const newTemplateForHere = () => {
    if (!model) {
      toast('工作区未就绪');
      return;
    }
    openTemplateEditor(model, {
      mode: 'new',
      topic: topicKeyHere,
      scope: isGlobal ? [] : [`topic:${topicKeyHere}`],
      name: '',
    });
  };

  const tplMenuItems = [
    ...((menuTemplates.length)
      ? menuTemplates.map((t: PromptTemplate) => ({
          label: (t.id === tpl?.defaultId ? '✓ ' : '') + t.name,
          icon: 'list',
          onClick: () => newDraft(String(t.body || '')),
        }))
      : [{
          label: '按默认模板新建一页',
          icon: 'list',
          onClick: () => {
            const p = tpl ? tpl.defaultPick() : null;
            newDraft(p ? p.body : '');
          },
        }]),
    'sep',
    { label: `为本${isGlobal ? '全局池' : '目录'}新建模板…`, icon: 'plus', onClick: newTemplateForHere },
    { label: '管理模板…', icon: 'gear', onClick: openTplList },
  ];

  // ─── 文档列表（右侧栏）────────────────────────────────────────────
  const openRefs = () => {
    if (isGlobal || !repo) {
      toast('全局池没有项目文档列表');
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
      const res = await addTask(isGlobal ? { global: true, text: bodyText } : { cwd: topic?.cwd, text: bodyText });
      toast(`已导入：${file.name}`);
      refreshLocal?.();
      const newId = res?.task?.id ?? res?.id;
      if (newId != null) openTask(newId);
    });
  };

  if (!topic && !isGlobal) {
    return (
      <div className="mdw">
        <div className="mdw-main">
          <div className="mdw-top">
            <div className="mdw-head">
              <div className="mdw-title">目录不存在</div>
              <div className="mdw-path">—</div>
            </div>
          </div>
        </div>
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
        name={isGlobal ? '全局池' : (topic?.name || '目录')}
        title={isGlobal ? '全局池任务' : '任务'}
        intro={!isGlobal && repo ? <Introduction kind="repo" owner={repo} model={model} /> : null}
        rows={pageRows}
        emptyText={`还没有页面：点「＋ 新建页」写第一篇，或让 agent 往${isGlobal ? '全局池' : '这个目录'}投递任务。`}
        tplMenuItems={tplMenuItems}
        onNew={() => {
          const p = tpl ? tpl.defaultPick() : null;
          newDraft(p ? p.body : '');
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
          },
        }}
        actionExtra={glOpen && repo ? <GetLoopModal repo={repo} onClose={() => setGlOpen(false)} onSaved={() => app.refreshRepos?.()} /> : null}
        extra={
          <>
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
