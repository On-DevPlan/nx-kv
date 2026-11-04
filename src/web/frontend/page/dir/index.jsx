// 目录面板 —— 简介（统一 Introduction）+ 子任务表。
import { useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog, PopMenu } from '../../components/popup/index.jsx';
import { GLOBAL_KEY, sortTasksForDisplay } from '../../modules/board/board-view.js';
import {
  FEEDBACK_HEADING,
  PLAIN_FEEDBACK_HEADING,
  buildReopenText,
} from '../../modules/board/reopen-text.js';
import { usePager } from '../../components/pager.jsx';
import { useApp } from '../../app-context.jsx';
import Landing from './landing.jsx';
import DagEditor from './dag-editor.jsx';
import { findOpenPanel, openPanel } from '../../workspace.js';
import { docIdOf, nextDraftId, peekDoc, saveDoc, scopeOf } from '../../modules/md/doc-store.js';

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
  const allTasks = useMemo(
    () => sortTasksForDisplay((topic?.tasks || []).filter((t) => !t.deletedAt)),
    [topic]
  );
  const pager = usePager(allTasks, PAGE_SIZE);
  const pendingCount = useMemo(
    () => allTasks.filter((t) => t.status !== 'consumed' && !t.migratedTo).length,
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
    const pend = allTasks.filter((t) => t.status !== 'consumed' && !t.migratedTo && !t.deletedAt);
    pend.forEach((t, i) => {
      if (t.blocksFollowing) map[t.id] = pend.slice(i + 1).map((x) => x.id);
    });
    return map;
  }, [allTasks]);
  const dagCandidates = useMemo(
    () => allTasks.filter((t) => t.status !== 'consumed' && !t.migratedTo && !t.deletedAt),
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
          onClick: () => newDraft(t.body),
        }))
      : [{ label: '按默认模板新建一页', icon: 'list', onClick: () => newDraft(tpl ? tpl.defaultBody() : '') }]),
    'sep',
    { label: '管理模板…', icon: 'gear', onClick: openTplPanel },
  ];

  const reopenTask = (t) => {
    if (!t) return;
    const title = (t.text || '').split('\n').find((l) => l.trim()) || `#${t.id}`;
    guard(async () => {
      const body = await dialog({
        title: `反馈修改 · #${t.id}`,
        input: true,
        placeholder: '写下要改的地方（留空 = 只重开，不改正文）',
      });
      if (body === null || body === undefined) return;
      // 反馈是**追加**不是替换：reopen 的 text 是整段新正文，直接把反馈当正文发过去
      // 会把原任务丢掉（agent 下一轮只看得见这句反馈）。拼成「原正文 + 反馈」。
      //
      // 已完成的任务走 **ack 语义**：除了用户反馈，还要把上一轮 agent 的完成总结
      // 追加进正文——重开后验收条消失，总结若不落进正文就没人看得见了。
      // 未完成的任务只是「反馈修改」，保持旧口径（不追加总结、段名不同）。
      const fb = String(body).trim();
      const acked = !!t.completedAt;
      const ackSummary = acked ? t.roundSummary || '' : '';
      // 没有新增内容 → 不带 text 字段（服务端只翻状态，正文一个字不动）。
      const text =
        fb || ackSummary
          ? buildReopenText({
              base: t.text || '',
              feedback: fb,
              ackSummary,
              feedbackHeading: acked ? FEEDBACK_HEADING : PLAIN_FEEDBACK_HEADING,
              bold: acked,
            })
          : '';
      const res = await api('/api/localtasks/reopen', {
        method: 'POST',
        body: {
          ...(isGlobal ? { key: GLOBAL_KEY } : { cwd: topic.cwd }),
          id: t.id,
          ...(text ? { text } : {}),
        },
      });
      // 这条任务若在某个页签里开着，把新正文写回那份文档——否则页面还显示旧正文，
      // 看不见刚追加的「上一轮完成总结 / 验收反馈」两段。
      // 只在文档**与服务端一致**（没有未保存编辑）时写：文档里若有人改过，
      // 那是他的活，别覆盖。
      if (text) {
        const docKey = docIdOf(scopeOf(dirKey), t.id);
        const open = peekDoc(docKey);
        if (open && String(open.body || '').trim() === String(t.text || '').trim()) {
          saveDoc(docKey, { body: text });
        }
      }
      toast(
        `已重开「${title.replace(/^#\s*/, '')}」——agent 可再次领取` +
          (res?.moved && res.name ? `；已改归属项目，迁到「${res.name}」#${res.task?.id}` : ''),
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
          onReopenTask={reopenTask}
          onTplMenu={(e) => setTplMenu({ x: e.clientX, y: e.clientY })}
          onImport={() => fileMdRef.current?.click()}
          onProg={openProgress}
          onMoveTask={moveTask}
          onOpenDag={setDagTask}
          onOpenFlow={() => model && openPanel(model, { component: 'dag', name: '编排', config: { dirKey } })}
          onToggleGate={toggleGate}
          downstreamOf={downstreamOf}
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

      {tplMenu && (
        <PopMenu x={tplMenu.x} y={tplMenu.y} items={tplMenuItems} onClose={() => setTplMenu(null)} />
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
