// 目录面板 —— 一个目录的**子任务表**（工作区里的一块面板）。
//
// 点任务行 → 在工作区里开一个 MD 页签（可并排、可浮出，和别的目录同屏）；
// 「＋ 新建页」→ 开一个草稿页签（起始正文 = 默认模板）；「模板 ▾」→ 挑一个模板开页。
//
// 面板化之后这里**不再有页签栏**：开哪几页、在哪开、能不能并排，都由工作区布局管。
import { useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/ui.jsx';
import { PopMenu } from '../../components/overlay.jsx';
import { GLOBAL_KEY } from '../../../../modules/localtask/board.js';
import { useApp } from '../../app-context.jsx';
import Landing from './landing.jsx';
import { findOpenPanel, openPanel } from '../../workspace.js';
import { nextDraftId } from './doc-store.js';

export default function DirPanel({ dirKey }) {
  const app = useApp() || {};
  const toast = useToast();
  const rows = app.rows || [];
  const refreshLocal = app.refreshLocal;
  const tpl = app.tpl;
  const model = app.model;

  const isGlobal = !dirKey || dirKey === GLOBAL_KEY;
  const [tplMenu, setTplMenu] = useState(null);
  const fileMdRef = useRef(null);

  const topic = useMemo(() => {
    if (isGlobal) return rows.find((r) => r.isGlobal) || null;
    return rows.find((r) => r.key === dirKey) || null;
  }, [rows, dirKey, isGlobal]);

  const tasks = useMemo(() => (topic?.tasks || []).filter((t) => !t.deletedAt), [topic]);

  const guard = (fn) => fn().catch((e) => toast(String(e.message || e)));

  // ─── 开页签 ───
  const openTask = (id) => {
    if (app.openPage) app.openPage({ dirKey, task: String(id), name: `#${id}` });
  };

  const newDraft = (body) => {
    const task = nextDraftId();
    if (app.openPage) app.openPage({ dirKey, task, name: '新任务', body });
  };

  // 「模板 ▾」末尾的管理入口：开一块**面板**（不是弹窗）——模板是长期配置，
  // 值得占一块可拖动、可并排的位置，也能被深链 #/templates 直接打开。
  const openTplPanel = () => {
    if (model) openPanel(model, { component: 'templates', name: '任务模板' });
  };

  // 目录级的「进程」面板入口：面板化之后进程不在内嵌右侧栏里，
  // 从落地页也要开得出来（config 带 dirKey，否则会落到全局池）。
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

  // ─── 删除任务（软删除；顺手关掉已打开的页签）───
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
      // 关掉这一页（如果开着）
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
          tasks={tasks}
          onNew={() => newDraft(tpl ? tpl.defaultBody() : '')}
          onOpenTask={openTask}
          onDeleteTask={delTask}
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
    </div>
  );
}
