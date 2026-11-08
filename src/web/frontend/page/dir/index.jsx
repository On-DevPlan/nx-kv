// 目录面板 —— 简介（统一 Introduction）+ 子任务表。
import { useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog, PopMenu } from '../../components/popup/index.jsx';
import { GLOBAL_KEY, sortTasksForDisplay, isGroupTask } from '../../modules/board/board-view.js';
import {
  FEEDBACK_HEADING,
  PLAIN_FEEDBACK_HEADING,
  buildReopenText,
} from '../../modules/board/reopen-text.js';
import { usePager } from '../../components/pager.jsx';
import { useApp } from '../../app-context.jsx';
import Landing from './landing.jsx';
import DagEditor from './dag-editor.jsx';
import DeletedPanel from './deleted-panel.jsx';
import { findOpenPanel, openPanel } from '../../workspace.js';
import { docIdOf, nextDraftId, saveDoc, scopeOf } from '../../modules/md/doc-store.js';
import { NEW_TEMPLATE_VALUES } from '../../modules/md/md-parse.js';
import { renderTemplateBody } from '../../modules/prompts/placeholders.js';

// 目录任务表每页条数（队列一长就翻页，不再一次渲染全部）
const PAGE_SIZE = 20;

export default function DirPanel({ dirKey }) {
  const { dialog, node: dialogNode } = useDialog();
  const app = useApp() || {};
  const toast = useToast();
  const rows = app.rows || [];
  const refreshLocal = app.refreshLocal;
  const tpl = app.tpl;
  const model = app.model;
  const repos = (app.repoData && app.repoData.repos) || [];

  const isGlobal = !dirKey || dirKey === GLOBAL_KEY;
  const [tplMenu, setTplMenu] = useState(null);
  const [moreMenu, setMoreMenu] = useState(null); // 头部「更多 ▾」下拉（{x, y}）
  const [showDeleted, setShowDeleted] = useState(false); // 已删除任务面板开关
  const [dagTask, setDagTask] = useState(null); // 正在编排依赖的任务（DAG 节点编辑器）
  const fileMdRef = useRef(null);

  const topic = useMemo(() => {
    if (isGlobal) return rows.find((r) => r.isGlobal) || null;
    return rows.find((r) => r.key === dirKey) || null;
  }, [rows, dirKey, isGlobal]);

  const repo = useMemo(() => {
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
  // 软删除的行不进表。分页：队列一长就翻页，不一次渲染全部。
  // #85 两种走向：目录页是**项目走向**的视图——组任务（frontmatter.board）
  // 物理上在这条队列里，但归组页管，列表与下面的计数/编排一并排除。
  const allTasks = useMemo(
    () => sortTasksForDisplay((topic?.tasks || []).filter((t) => !t.deletedAt && !isGroupTask(t))),
    [topic]
  );
  const pager = usePager(allTasks, PAGE_SIZE);
  const pendingCount = useMemo(
    () => allTasks.filter((t) => t.status === 'pending' && !t.migratedTo).length,
    [allTasks]
  );
  const guard = (fn) => fn().catch((e) => toast(String(e.message || e)));

  // ─── 编排（DAG）：拖动排序 / 闸门 / 上下游依赖 ───
  // 定位 body：全局池用 key，目录用 cwd（与 reopen / delete 同一套）
  const scopeBody = () => (isGlobal ? { key: GLOBAL_KEY } : { cwd: topic.cwd });

  // 拖动排序：服务端只许 pending ↔ pending 换位（已领取是固定历史），UI 侧已同口径过滤
  const moveTask = (t, targetId, zone) => {
    guard(async () => {
      await api('/api/localtasks/reorder', {
        method: 'PATCH',
        body: { ...scopeBody(), id: t.id, ...(zone === 'before' ? { beforeId: targetId } : { afterId: targetId }) },
      });
      refreshLocal();
    });
  };

  const toggleGate = (t) => {
    guard(async () => {
      await api('/api/localtasks/item', {
        method: 'PATCH',
        body: { ...scopeBody(), id: t.id, gate: !t.blocksFollowing },
      });
      toast(!t.blocksFollowing ? `#${t.id} 已设为闸门——挡住所有后续待领取任务` : `#${t.id} 闸门已取消`);
      refreshLocal();
    });
  };

  // 编排编辑器保存：patches 是逐条任务级 PATCH（本任务的 gate/blockBy + 下游各方 blockBy）。
  // 失败时 toast 并**向上抛**——编辑器据此保持打开。
  const saveDag = async (patches) => {
    try {
      for (const p of patches) {
        await api('/api/localtasks/item', { method: 'PATCH', body: { ...scopeBody(), ...p } });
      }
      toast('编排已保存');
      refreshLocal();
    } catch (e) {
      toast(String(e.message || e));
      throw e;
    }
  };

  // 闸门 → 被它挡住的后续任务（队列序：pending 子序即领取序）。
  // 领取闸判定只看「排在我前面的 alive 闸门」（core/workflow/readiness），同一口径。
  const downstreamOf = useMemo(() => {
    const map = {};
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

  const openTask = (id) => {
    if (app.openPage) app.openPage({ dirKey, task: String(id), name: `#${id}` });
  };

  const newDraft = (body) => {
    const task = nextDraftId();
    // 正文先写进 doc-store：openPage 只透传 dirKey / task / name，body 会被丢掉
    // （按模板新建时丢的就是模板正文）。
    saveDoc(docIdOf(scopeOf(dirKey), task), { title: '', body });
    if (app.openPage) app.openPage({ dirKey, task, name: '新任务' });
  };

  const openTplPanel = () => {
    if (model) openPanel(model, { component: 'templates', name: '任务模板' });
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

  const tplMenuItems = [
    ...((tpl && tpl.templates && tpl.templates.length)
      ? tpl.templates.map((t) => ({
          label: (t.id === tpl.defaultId ? '✓ ' : '') + t.name,
          icon: 'list',
          // 正文按模板取值渲染（老模板可能带 {{槽位}}，任务里不能出现裸标记）
          onClick: () => newDraft(renderTemplateBody(t.body, { ...NEW_TEMPLATE_VALUES, ...(t.values || {}) })),
        }))
      : [{ label: '按默认模板新建一页', icon: 'list', onClick: () => newDraft(tpl ? tpl.defaultBody() : '') }]),
    'sep',
    { label: '管理模板…', icon: 'gear', onClick: openTplPanel },
  ];

  // #79：反馈的 base 以**服务端当前正文**为准——列表行的 t.text 是 rows 快照，
  // 可能落后于盘上（别的会话改过 / 上一轮重开追加过），拿旧正文拼回去就是丢数据。
  const fetchServerTask = async (t) => {
    if (t == null) return null;
    const q = isGlobal
      ? `key=${encodeURIComponent(GLOBAL_KEY)}&id=${Number(t.id)}`
      : `cwd=${encodeURIComponent(topic?.cwd || '')}&id=${Number(t.id)}`;
    return api(`/api/localtasks/item?${q}`).catch(() => null);
  };

  const reopenTask = (t) => {
    if (!t) return;
    const title = (t.text || '').split('\n').find((l) => l.trim()) || `#${t.id}`;
    guard(async () => {
      const acked = !!t.completedAt;
      const body = await dialog({
        title: acked ? `反馈 · #${t.id}` : `反馈修改 · #${t.id}`,
        input: true,
        placeholder: acked
          ? '写下反馈（将新开一条任务，原任务不动）'
          : '写下要改的地方（留空 = 只重开，不改正文）',
      });
      if (body === null || body === undefined) return;
      const fb = String(body).trim();
      // #79：base 取服务端当前正文（取不到才退回 rows 快照）；两头的都没有就中止。
      const fresh = await fetchServerTask(t);
      const baseText = String(fresh?.text ?? '').trim() || String(t.text || '').trim();
      const ackSummary = acked ? (fresh?.roundSummary || t.roundSummary || '') : '';
      if (!fb && !acked && !baseText) {
        // 只重开（不改正文）不需要 base；带反馈但拿不到正文时不能瞎拼
        toast('拿不到任务当前正文，已取消（防止丢内容）');
        return;
      }

      // #75：已完成 → 反馈 = **新开任务**（forkOf 指回本条），原任务留档不动。
      // 新任务的正文 = 完整之前的任务 + 上轮总结 + 本轮反馈（面板拼装——新任务
      // 的落点内容只能整篇给）。
      if (acked) {
        const text = fb
          ? buildReopenText({
              base: baseText,
              feedback: fb,
              ackSummary,
              feedbackHeading: FEEDBACK_HEADING,
              bold: true,
            })
          : '';
        if (!text) {
          toast('写一下反馈');
          return;
        }
        const res = await api('/api/localtasks', {
          method: 'POST',
          body: isGlobal
            ? { global: true, text, forkOf: String(t.id), forkKind: 'reopen' }
            : { cwd: topic.cwd, text, forkOf: String(t.id), forkKind: 'reopen' },
        });
        const newId = String(res?.task?.id ?? res?.id ?? '');
        const landedKey = res?.key || dirKey;
        if (newId) saveDoc(docIdOf(scopeOf(landedKey), newId), { body: text });
        toast(`已反馈「${title.replace(/^#\s*/, '')}」→ 新任务 #${newId || '?'}`);
        refreshLocal();
        return;
      }

      // 未完成：就地回写（#74 reopen）。#79：纯反馈不传 text——服务端把反馈段
      // 原子追加到盘上当前正文；「只重开不改正文」（无反馈）维持只翻状态。
      const res = await api('/api/localtasks/reopen', {
        method: 'POST',
        body: {
          ...scopeBody(),
          id: t.id,
          kind: 'reopen',
          ...(fb
            ? {
                feedback: fb,
                feedbackHeading: PLAIN_FEEDBACK_HEADING,
                feedbackBold: false,
              }
            : {}),
        },
      });
      const landedKey = res?.key || dirKey;
      const sameId = String(res?.task?.id ?? t.id);
      const finalText = String(res?.task?.text ?? '');
      if (finalText) saveDoc(docIdOf(scopeOf(landedKey), sameId), { body: finalText });
      toast(
        `已回写「${title.replace(/^#\s*/, '')}」#${sameId}` +
          (res?.moved && res.name ? `；归属迁到「${res.name}」` : ''),
      );
      refreshLocal();
    });
  };

  const delTask = async (t) => {
    if (!t) return;
    const title = (t.text || '').split('\n').find((l) => l.trim()) || `#${t.id}`;
    const ok = await dialog({
      title: `删除任务「${title.replace(/^#\s*/, '')}」`,
      message: '软删除：CLI localtask task restore 可恢复。',
      danger: true,
      okText: '删除',
    });
    if (!ok) return;
    guard(async () => {
      await api('/api/localtasks/item', {
        method: 'DELETE',
        body: isGlobal ? { key: GLOBAL_KEY, id: t.id } : { cwd: topic.cwd, id: t.id },
      });
      toast(`已删除「${title.replace(/^#\s*/, '')}」`);
      if (model) {
        const page = findOpenPanel(model, 'page', { dirKey, task: String(t.id) });
        if (page) app.closePanel && app.closePanel(page.getId());
      }
      refreshLocal();
    });
  };

  // ─── 批量操作（多选删除 / 取消）────────────────────────────────────
  const batchDeleteTasks = async (ids) => {
    const list = (ids || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (!list.length) return false;
    const ok = await dialog({
      title: `删除选中的 ${list.length} 条任务`,
      message: '软删除：CLI localtask task restore 可恢复。',
      danger: true,
      okText: '删除',
    });
    if (!ok) return false;
    return guard(async () => {
      const res = await api('/api/localtasks/items', {
        method: 'DELETE',
        body: { ...scopeBody(), ids: list },
      });
      toast(`已删除 ${res?.count ?? list.length} 条任务`);
      refreshLocal();
      return true;
    });
  };

  const batchCancelTasks = async (ids) => {
    const list = (ids || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (!list.length) return false;
    const ok = await dialog({
      title: `取消选中的 ${list.length} 条待领取任务`,
      message: '只处理待领取任务；已领取/已交付/已取消会跳过。取消为终态，原文留档。',
      okText: '取消任务',
    });
    if (!ok) return false;
    return guard(async () => {
      const res = await api('/api/localtasks/items/cancel', {
        method: 'POST',
        body: { ...scopeBody(), ids: list },
      });
      const skipped = res?.skipped?.length || 0;
      toast(`已取消 ${res?.count ?? 0} 条任务${skipped ? `，跳过 ${skipped} 条` : ''}`);
      refreshLocal();
      return true;
    });
  };

  const batchCompleteTasks = async (ids) => {
    const list = (ids || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (!list.length) return false;
    const ok = await dialog({
      title: `把选中的 ${list.length} 条待领取任务标为完成`,
      message: '只处理待领取任务；已领取/已交付/已取消会跳过。完成会补一条完成记录，原文留档。',
      okText: '标为完成',
    });
    if (!ok) return false;
    return guard(async () => {
      const res = await api('/api/localtasks/items/close', {
        method: 'POST',
        body: { ...scopeBody(), ids: list, status: 'done' },
      });
      const skipped = res?.skipped?.length || 0;
      toast(`已标为完成 ${res?.count ?? 0} 条任务${skipped ? `，跳过 ${skipped} 条` : ''}`);
      refreshLocal();
      return true;
    });
  };

  // ─── 已删除（软删回收站）──────────────────────────────────────────
  // 软删的行仍在 topic.tasks 里（带 deletedAt），看板/列表把它们过滤掉了，
  // 这里捞出来给「更多 → 已删除任务」面板。倒序：刚删的在上。
  const deletedTasks = useMemo(
    () => (topic?.tasks || []).filter((t) => t.deletedAt).slice().reverse(),
    [topic]
  );

  const restoreDeleted = (t) => {
    if (!t) return;
    guard(async () => {
      await api('/api/localtasks/tasks/restore', {
        method: 'POST',
        body: isGlobal ? { key: GLOBAL_KEY, id: t.id } : { cwd: topic.cwd, id: t.id },
      });
      toast(`已恢复 #${t.id}「${(t.text || '').split('\n').find((l) => l.trim())?.replace(/^#\s*/, '') || ''}」`);
      refreshLocal();
    });
  };

  const purgeDeleted = async (t) => {
    if (!t) return;
    const title = (t.text || '').split('\n').find((l) => l.trim()) || `#${t.id}`;
    const ok = await dialog({
      title: `彻底删除「${title.replace(/^#\s*/, '')}」`,
      message: '彻底删除后不可恢复（行从队列里真正摘除）。',
      danger: true,
      okText: '彻底删除',
    });
    if (!ok) return;
    guard(async () => {
      await api('/api/localtasks/item', {
        method: 'DELETE',
        body: { ...(isGlobal ? { key: GLOBAL_KEY } : { cwd: topic.cwd }), id: t.id, purge: true },
      });
      toast(`已彻底删除 #${t.id}`);
      refreshLocal();
    });
  };

  const moreMenuItems = [
    {
      label: `已删除任务（${deletedTasks.length}）`,
      icon: 'trash',
      onClick: () => setShowDeleted(true),
    },
    // 查看列表（任务「简介文档优化」）：与进程一致的右侧边栏，列本项目的文档 / reference
    ...(!isGlobal && repo ? [{
      label: '查看列表（文档 / reference）',
      icon: 'list',
      onClick: () => {
        if (!model) return;
        const rk = repo.key || (topic.repo && topic.repo.key) || '';
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
      },
    }] : []),
  ];

  const importMd = async (file) => {
    const text = await file.text();
    const name = file.name.replace(/\.md$/i, '');
    await guard(async () => {
      const bodyText = text.startsWith('#') ? text : `# ${name}\n\n${text}`;
      const res = await api('/api/localtasks', {
        method: 'POST',
        body: isGlobal ? { global: true, text: bodyText } : { cwd: topic.cwd, text: bodyText },
      });
      toast(`已导入：${file.name}`);
      refreshLocal();
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
    <div className="mdw">
      <div className="mdw-main">
        <Landing
          isGlobal={isGlobal}
          topic={topic}
          repo={repo}
          model={model}
          tasks={pager.items}
          taskCount={pager.total}
          pendingCount={pendingCount}
          page={pager.page}
          pageCount={pager.pageCount}
          onPage={pager.setPage}
          onNew={() => newDraft(tpl ? tpl.defaultBody() : '')}
          onOpenTask={openTask}
          onDeleteTask={delTask}
          onDeleteTasks={batchDeleteTasks}
          onCancelTasks={batchCancelTasks}
          onCompleteTasks={batchCompleteTasks}
          onReopenTask={reopenTask}
          onTplMenu={(e) => setTplMenu({ x: e.clientX, y: e.clientY })}
          onImport={() => fileMdRef.current?.click()}
          onProg={openProgress}
          onMoveTask={moveTask}
          onOpenDag={setDagTask}
          onOpenFlow={() => model && openPanel(model, { component: 'dag', name: '编排', config: { dirKey } })}
          onToggleGate={toggleGate}
          downstreamOf={downstreamOf}
          onMoreMenu={(e) => setMoreMenu({ x: e.clientX, y: e.clientY })}
          deletedCount={deletedTasks.length}
        />
      </div>

      {dagTask && (
        <DagEditor
          task={dagTask}
          tasks={dagCandidates}
          onClose={() => setDagTask(null)}
          onSave={saveDag}
        />
      )}

      {showDeleted && (
        <DeletedPanel
          tasks={deletedTasks}
          onClose={() => setShowDeleted(false)}
          onRestore={restoreDeleted}
          onPurge={purgeDeleted}
        />
      )}

      {tplMenu && (
        <PopMenu x={tplMenu.x} y={tplMenu.y} items={tplMenuItems} onClose={() => setTplMenu(null)} />
      )}

      {moreMenu && (
        <PopMenu x={moreMenu.x} y={moreMenu.y} items={moreMenuItems} onClose={() => setMoreMenu(null)} />
      )}

      <input
        ref={fileMdRef}
        type="file"
        accept=".md,text/markdown,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) importMd(f);
        }}
      />

      {dialogNode}
    </div>
  );
}
