// 目录面板 —— 简介（统一 Introduction）+ 子任务表。
import { useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useDialog, useToast } from '../../components/ui.jsx';
import { PopMenu } from '../../components/overlay.jsx';
import { GLOBAL_KEY } from '../../../../modules/localtask/board.js';
import { useApp } from '../../app-context.jsx';
import Landing from './landing.jsx';
import { findOpenPanel, openPanel } from '../../workspace.js';
import { nextDraftId } from '../../modules/md/doc-store.js';

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

  const tasks = useMemo(() => (topic?.tasks || []).filter((t) => !t.deletedAt), [topic]);
  const guard = (fn) => fn().catch((e) => toast(String(e.message || e)));

  const openTask = (id) => {
    if (app.openPage) app.openPage({ dirKey, task: String(id), name: `#${id}` });
  };

  const newDraft = (body) => {
    const task = nextDraftId();
    if (app.openPage) app.openPage({ dirKey, task, name: '新任务', body });
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
      await api('/api/localtasks/reopen', {
        method: 'POST',
        body: {
          ...(isGlobal ? { key: GLOBAL_KEY } : { cwd: topic.cwd }),
          id: t.id,
          ...(String(body).trim() ? { text: String(body) } : {}),
        },
      });
      toast(`已重开「${title.replace(/^#\s*/, '')}」——agent 可再次领取`);
      refreshLocal();
    });
  };

  const delTask = (t) => {
    if (!t) return;
    const title = (t.text || '').split('\n').find((l) => l.trim()) || `#${t.id}`;
    if (!confirm(`删除任务「${title.replace(/^#\s*/, '')}」？\n软删除：CLI localtask task restore 可恢复。`)) return;
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
          tasks={tasks}
          onNew={() => newDraft(tpl ? tpl.defaultBody() : '')}
          onOpenTask={openTask}
          onDeleteTask={delTask}
          onReopenTask={reopenTask}
          onTplMenu={(e) => setTplMenu({ x: e.clientX, y: e.clientY })}
          onImport={() => fileMdRef.current?.click()}
          onProg={openProgress}
        />
      </div>

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
