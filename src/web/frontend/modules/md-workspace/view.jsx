// MD 式目录工作台 —— 落地自 plan/agent-md-workspace.html
// 目录点击 = 侧栏展开子行（不进编辑）；点具体页面（任务/草稿）= 工作台全屏编辑 + 页签。
// 未打开页面时主区是目录落地页（页面列表 + 新建页），右侧并发进程面板常驻。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/ui.jsx';
import { GLOBAL_KEY } from '../../../../modules/localtask/board.js';
import TabBar from '../../components/layout/tabs.jsx';
import ProgressPanel from './progress-panel.jsx';
import AttachBar from './attach-bar.jsx';
import ToolBar from './tool-bar.jsx';
import Landing from './landing.jsx';
import { MdPanes } from './md-panes.jsx';
import ShortcutSheet from './shortcut-sheet.jsx';
import SelMenu from './sel-menu.jsx';
import { filesToAttachments, loadAttForTask, persistAtt } from './attachments.js';
import { clearHistory, pushHistory, redoHistory, undoHistory } from './md-history.js';
import {
  NEW_TEMPLATE,
  renderMarkdownHtml,
  slugName,
  titleFromMd,
} from './md-parse.js';
import {
  closeTab,
  docOf,
  isDraftTask,
  openDraft,
  openPage,
  promoteDraft,
  routeOfTab,
  saveDoc,
  scopeOf,
  setActive,
  tabById,
  useTabs,
} from './tabs-store.js';
import './style.css';

export default function MdWorkspace({ dirKey, rows, refreshLocal, onNavigate }) {
  const toast = useToast();
  const isGlobal = !dirKey || dirKey === GLOBAL_KEY;
  const scope = scopeOf(dirKey);
  const topic = useMemo(() => {
    if (isGlobal) return rows.find((r) => r.isGlobal) || null;
    return rows.find((r) => r.key === dirKey) || null;
  }, [rows, dirKey, isGlobal]);

  const { tabs, activeId } = useTabs();
  const [progOpen, setProgOpen] = useState(true);
  const [selMenu, setSelMenu] = useState(null);
  const fileMdRef = useRef(null);
  const fileAttRef = useRef(null);
  const articleRef = useRef(null);
  const editorApiRef = useRef(null);
  const lastSel = useRef('');

  const tasks = useMemo(
    () => (topic?.tasks || []).filter((t) => !t.deletedAt),
    [topic]
  );

  // 激活页签（必须属于当前目录作用域；其余情况一律落目录落地页）
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeId && t.scope === scope) || null,
    [tabs, activeId, scope]
  );
  const doc = activeTab ? docOf(activeTab.id) : null;

  // ─── 路由 ?task= → 页签（唯一入口；store 有幂等护栏，轮询重放无副作用）───
  const applyTaskFromHash = useCallback(() => {
    if (!topic) { setActive(null); return; }
    const q = new URLSearchParams((location.hash.split('?')[1] || ''));
    const tid = q.get('task');
    if (!tid) { setActive(null); return; }
    if (tid === 'draft') {
      // 「新建一页」瞬时标记：开新草稿页签，URL 落定成可复现的 draft-N
      const id = openDraft({ scope, title: '', body: NEW_TEMPLATE });
      history.replaceState(null, '', routeOfTab(tabById(id)));
      return;
    }
    const t = tasks.find((x) => String(x.id) === String(tid));
    if (t) {
      openPage({
        scope,
        task: tid,
        title: titleFromMd(t.text),
        body: t.text,
        attachments: loadAttForTask(t.id),
      });
      return;
    }
    if (isDraftTask(tid)) {
      // 刷新后按 URL 复现草稿页签（内容是会话态，刷新即空稿）
      openDraft({ scope, task: tid, title: '', body: NEW_TEMPLATE });
      return;
    }
    setActive(null); // 未知 task：落目录落地页
  }, [topic, tasks, scope]);
  useEffect(() => {
    applyTaskFromHash();
    window.addEventListener('hashchange', applyTaskFromHash);
    return () => window.removeEventListener('hashchange', applyTaskFromHash);
  }, [applyTaskFromHash]);

  useEffect(() => {
    setSelMenu(null);
  }, [dirKey]);

  useEffect(() => {
    const close = () => setSelMenu(null);
    document.addEventListener('scroll', close, true);
    return () => document.removeEventListener('scroll', close, true);
  }, []);

  const previewHtml = useMemo(
    () => (doc ? renderMarkdownHtml(doc.body, doc.attachments) : ''),
    [doc]
  );

  const missing = !topic && !isGlobal;

  const guard = (fn) => fn().catch((e) => toast(String(e.message || e)));

  // 未保存标记：标题/正文/附件改动即挂点，保存/提交成功后摘除（页签上一颗点）
  const [dirtyIds, setDirtyIds] = useState(() => new Set());
  // 文档级撤销栈：受控 textarea 的程序化改写会冲掉原生 undo（格式操作不可撤），
  // 这里自己记快照，Ctrl/⌘Z 与 Ctrl/⌘⇧Z 走它
  const histRef = useRef(new Map());
  // 快捷键速查面板
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Ctrl/⌘ / 唤起速查（Notion 习惯）：只在工作台范围内生效，侧栏输入框不受影响
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key !== '/') return;
      const t = e.target;
      if (t && typeof t.closest === 'function' && !t.closest('.mdw')) return;
      e.preventDefault();
      setShowShortcuts((v) => !v);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const markDirty = (id) => setDirtyIds((s) => {
    if (s.has(id)) return s;
    const n = new Set(s);
    n.add(id);
    return n;
  });
  const clearDirty = (id) => setDirtyIds((s) => {
    if (!s.has(id)) return s;
    const n = new Set(s);
    n.delete(id);
    return n;
  });

  // ─── 页签操作：切换 / 关闭 / 新建（切换一律走路由，activeId 与 URL 保持同源）───
  const gotoTab = (id) => {
    const t = tabById(id);
    if (!t) return;
    const hash = routeOfTab(t);
    if (location.hash === hash) setActive(id);
    else location.hash = hash;
  };

  const closeTabAndNav = (id) => {
    const next = closeTab(id);
    if (next) gotoTab(next.id);
    else location.hash = isGlobal ? '#/global' : `#/dir/${encodeURIComponent(dirKey)}`;
  };

  const newDraft = () => {
    const id = openDraft({ scope, title: '', body: NEW_TEMPLATE });
    gotoTab(id);
  };

  const openTask = (id) => {
    const base = isGlobal ? '#/global' : `#/dir/${encodeURIComponent(dirKey)}`;
    onNavigate(`${base}?task=${encodeURIComponent(id)}`);
  };

  const submit = () => guard(async () => {
    if (!activeTab || !doc) return;
    const t = (doc.title || '').trim() || '未命名任务';
    let b = doc.body;
    if (!/^#\s+/m.test(b)) b = `# ${t}\n\n${b}`;
    else b = b.replace(/^#\s+.+$/m, `# ${t}`);
    if (!isDraftTask(activeTab.task)) {
      await api('/api/localtasks/item', {
        method: 'PATCH',
        body: {
          cwd: isGlobal ? undefined : topic.cwd,
          key: isGlobal ? GLOBAL_KEY : undefined,
          id: activeTab.task,
          text: b,
        },
      });
      persistAtt(activeTab.task, doc.attachments);
      saveDoc(activeTab.id, { title: t, body: b });
      clearDirty(activeTab.id);
      clearHistory(histRef.current, activeTab.id);
      toast('已同步 MD');
      refreshLocal();
      return;
    }
    const res = await api('/api/localtasks', {
      method: 'POST',
      body: isGlobal ? { global: true, text: b } : { cwd: topic.cwd, text: b },
    });
    const newId = res?.task?.id ?? res?.id;
    if (newId != null) {
      persistAtt(newId, doc.attachments);
      promoteDraft(activeTab.id, { task: String(newId), title: t });
      saveDoc(`${scope}::${newId}`, { title: t, body: b });
      clearDirty(activeTab.id);
      clearHistory(histRef.current, activeTab.id);
      history.replaceState(null, '', routeOfTab({ scope, task: String(newId) }));
    }
    toast(`已提交：${slugName(t)}`);
    refreshLocal();
    setProgOpen(true);
  });

  const importMd = async (file) => {
    const text = await file.text();
    const name = file.name.replace(/\.md$/i, '');
    await guard(async () => {
      const bodyText = text.startsWith('#') ? text : `# ${name}\n\n${text}`;
      await api('/api/localtasks', {
        method: 'POST',
        body: isGlobal ? { global: true, text: bodyText } : { cwd: topic.cwd, text: bodyText },
      });
      toast(`已导入：${file.name}`);
      refreshLocal();
      setProgOpen(true);
    });
  };

  const addFiles = async (fileList, opts = {}) => {
    if (!activeTab || !doc) return;
    const { items, imageInserts } = await filesToAttachments(fileList);
    const patch = {};
    if (imageInserts.length) {
      const ins = imageInserts.join('');
      const b = doc.body || '';
      if (opts.insertAt != null && opts.insertAt >= 0) {
        const at = Math.min(opts.insertAt, b.length);
        patch.body = b.slice(0, at) + ins + b.slice(at);
        // 源码模式：插入后把光标移到图片标记末尾
        if (opts.mode === 'edit') {
          requestAnimationFrame(() => {
            editorApiRef.current?.focus?.();
            const ta = document.querySelector('.mdw-editor');
            if (ta) {
              const caret = at + ins.length;
              try { ta.setSelectionRange(caret, caret); } catch { /* ignore */ }
            }
          });
        }
      } else {
        patch.body = b + ins;
      }
    }
    const next = [...(doc.attachments || []), ...items];
    patch.attachments = next;
    saveDoc(activeTab.id, patch);
    if (!isDraftTask(activeTab.task)) persistAtt(activeTab.task, next);
  };

  const spawnFollow = (isIssue) => {
    const quote = lastSel.current || '';
    if (!quote) {
      toast('先在预览中划选一段');
      return;
    }
    const parent = doc?.title || topic?.name || '';
    const t = `${isIssue ? '问题' : '追加'}：${quote.slice(0, 24)}`;
    const b = `# ${t}\n\n> 锚定自「${parent}」：\n> ${quote.replace(/\n/g, '\n> ')}\n\n## 要做什么\n- [ ] …\n\n## 验收\n- [ ] …\n`;
    const id = openDraft({ scope, title: t, body: b });
    gotoTab(id);
    setSelMenu(null);
    toast('已在新页签打开 MD 草稿（并发追加）');
  };

  /** 标题与正文首行 # 双向同步（实时预览标题栏独立，不改正文） */
  const onTitle = (next, kind = 'typing') => {
    if (!activeTab || !doc) return;
    pushHistory(histRef.current, activeTab.id, { title: doc.title, body: doc.body }, kind);
    markDirty(activeTab.id);
    const patch = { title: next };
    if (doc.mode !== 'split' && /^# (?!#)/m.test(doc.body)) {
      patch.body = doc.body.replace(/^# (?!#).+$/m, `# ${next || '未命名任务'}`);
    }
    saveDoc(activeTab.id, patch);
  };

  const onBody = (next, kind = 'op') => {
    if (!activeTab || !doc) return;
    pushHistory(histRef.current, activeTab.id, { title: doc.title, body: doc.body }, kind);
    markDirty(activeTab.id);
    const patch = { body: next };
    if (doc.mode !== 'split') patch.title = titleFromMd(next);
    saveDoc(activeTab.id, patch);
  };

  /** 撤销 / 重做：只移动历史指针并回写文档，不产生新的历史条目 */
  const undo = () => {
    if (!activeTab || !doc) return;
    const snap = undoHistory(histRef.current, activeTab.id, { title: doc.title, body: doc.body });
    if (!snap) return;
    saveDoc(activeTab.id, { title: snap.title, body: snap.body });
    markDirty(activeTab.id);
    // 光标回到改动处（源码模式精确；live 模式暂留原处）
    requestAnimationFrame(() => editorApiRef.current?.caretFromDiff?.(doc.body, snap.body));
  };

  const redo = () => {
    if (!activeTab || !doc) return;
    const snap = redoHistory(histRef.current, activeTab.id, { title: doc.title, body: doc.body });
    if (!snap) return;
    saveDoc(activeTab.id, { title: snap.title, body: snap.body });
    markDirty(activeTab.id);
    requestAnimationFrame(() => editorApiRef.current?.caretFromDiff?.(doc.body, snap.body));
  };

  const placeSelMenu = (kind, text, x, y) => {
    lastSel.current = text;
    setSelMenu({
      kind,
      text,
      x: Math.min(window.innerWidth - 220, Math.max(8, x)),
      y: Math.min(window.innerHeight - 160, Math.max(8, y)),
    });
  };

  /** 源码 / live 编辑态 textarea 划选 → 格式浮条 */
  const onEditorTextSel = (info) => {
    if (!info?.text || info.text.length < 1) {
      setSelMenu((cur) => (cur?.kind === 'format' ? null : cur));
      return;
    }
    placeSelMenu('format', info.text, info.x, info.y);
  };

  /** 阅读 / live 渲染态 DOM 划选 → 任务浮层（可带格式入口若可编辑） */
  const onPreviewMouseUp = (e) => {
    if (!activeTab || doc?.mode === 'edit') return;
    if (e.target.closest?.('#mdw-sel-menu')) return;
    if (e.target.closest?.('textarea')) return; // 交给 onEditorTextSel
    const sel = window.getSelection();
    const text = (sel && String(sel)).trim();
    if (!text || text.length < 2) {
      setSelMenu((cur) => (cur?.kind === 'task' || cur?.kind === 'both' ? null : cur));
      return;
    }
    if (!articleRef.current?.contains(sel.anchorNode)) {
      setSelMenu((cur) => (cur?.kind === 'task' || cur?.kind === 'both' ? null : cur));
      return;
    }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    // DOM 划选（阅读 / live 渲染态）：任务操作；编辑态划选走 onEditorTextSel 格式条
    placeSelMenu('task', text, r.left + r.width / 2 - 100, r.bottom + 8);
  };

  const status = topic?.waiting
    ? 'wait'
    : (tasks.some((t) => t.status !== 'consumed' && !t.from)
      ? 'wait'
      : (tasks.some((t) => t.status !== 'consumed') ? 'run' : null));

  const pickAtt = (accept) => {
    fileAttRef.current.accept = accept;
    fileAttRef.current?.click();
  };

  if (missing) {
    return (
      <div className="mdw">
        <div className="mdw-main">
          <div className="mdw-top">
            <div className="mdw-head">
              <div className="mdw-title">目录不存在</div>
              <div className="mdw-path">—</div>
            </div>
          </div>
          <div className="mdw-toolbar">
            <div className="mdw-toolbar-left" />
            <div className="mdw-actions">
              <button type="button" className="btn ghost sm" onClick={() => onNavigate('#/overview')}>总览</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isDraft = activeTab ? isDraftTask(activeTab.task) : false;

  return (
    <div className="mdw" data-mode={doc?.mode || 'split'} onMouseUp={onPreviewMouseUp}>
      <div className="mdw-main">
        {tabs.length > 0 && (
          <TabBar
            tabs={tabs.map((t) => (dirtyIds.has(t.id) ? { ...t, dirty: true } : t))}
            activeId={activeTab?.id ?? null}
            onSelect={gotoTab}
            onClose={closeTabAndNav}
            onNew={newDraft}
            newLabel="新建页"
          />
        )}

        {activeTab && doc ? (
          <>
            <div className="mdw-top">
              <div className="mdw-head">
                <div className="mdw-title">
                  {isDraft ? (doc.title || '新 MD 任务') : (doc.title || '任务')}
                </div>
                <div className="mdw-path">
                  {isGlobal ? '全局任务池' : (topic?.cwd || topic?.name || '—')}
                  {isDraft ? ` / (${activeTab.task})` : ` / #${activeTab.task}`}
                </div>
              </div>
              {status && (
                <span className={`mdw-pill${status === 'wait' ? ' wait' : ''}`}>
                  <span className="d" />
                  {status === 'wait' ? '等待中' : '进行中'}
                </span>
              )}
            </div>

            <ToolBar
              mode={doc.mode}
              onMode={(m) => saveDoc(activeTab.id, { mode: m })}
              showMark={doc.mode !== 'edit'}
              submitLabel={isDraft ? '提交为任务' : '保存并同步'}
              onImg={() => pickAtt('image/*')}
              onAtt={() => pickAtt('image/*,.pdf,.zip,.txt,.json,.csv')}
              onShortcuts={() => setShowShortcuts(true)}
              onImport={() => fileMdRef.current?.click()}
              onNew={newDraft}
              onMark={() => spawnFollow(true)}
              onDraft={() => toast('草稿随页签保留（刷新后需从侧栏或页签重新打开）')}
              onSubmit={submit}
              onProg={() => setProgOpen((v) => !v)}
              onOverview={() => onNavigate('#/overview')}
              onFormat={(op) => editorApiRef.current?.format?.(op)}
              onTurn={(id) => editorApiRef.current?.turn?.(id)}
            />

            <MdPanes
              ref={articleRef}
              mode={doc.mode}
              title={doc.title}
              body={doc.body}
              previewHtml={previewHtml}
              onTitle={onTitle}
              onBody={onBody}
              attachments={doc.attachments}
              docKey={activeTab.id}
              editorApiRef={editorApiRef}
              onFiles={addFiles}
              onTextSel={onEditorTextSel}
              onSave={submit}
              onUndo={undo}
              onRedo={redo}
              onCloseSelMenu={() => setSelMenu(null)}
            />

            <AttachBar
              attachments={doc.attachments}
              onRemove={(id) => {
                const next = doc.attachments.filter((x) => x.id !== id);
                markDirty(activeTab.id);
                saveDoc(activeTab.id, { attachments: next });
                if (!isDraft) persistAtt(activeTab.task, next);
              }}
            />
          </>
        ) : (
          <>
            <div className="mdw-top">
              <div className="mdw-head">
                <div className="mdw-title">{isGlobal ? '全局任务池' : (topic?.name || '—')}</div>
                <div className="mdw-path">
                  {isGlobal ? '全局任务池' : (topic?.cwd || '—')}
                  {' / 页面列表'}
                </div>
              </div>
              {status && (
                <span className={`mdw-pill${status === 'wait' ? ' wait' : ''}`}>
                  <span className="d" />
                  {status === 'wait' ? '等待中' : '进行中'}
                </span>
              )}
            </div>
            <Landing
              isGlobal={isGlobal}
              tasks={tasks}
              onNew={newDraft}
              onOpenTask={openTask}
            />
          </>
        )}
      </div>

      <ProgressPanel
        dirName={topic?.name || (isGlobal ? '全局任务' : '')}
        tasks={tasks}
        focusId={activeTab && !isDraft ? Number(activeTab.task) : null}
        open={progOpen}
        onToggle={setProgOpen}
        onOpenTask={openTask}
      />

      <SelMenu
        at={selMenu}
        onFormat={(op) => {
          editorApiRef.current?.format?.(op);
          setSelMenu(null);
        }}
        onIssue={() => spawnFollow(true)}
        onAppend={() => spawnFollow(false)}
        onCopy={() => {
          navigator.clipboard?.writeText(lastSel.current || selMenu?.text || '');
          toast('已复制');
          setSelMenu(null);
        }}
      />

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
      <input
        ref={fileAttRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {showShortcuts && <ShortcutSheet onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
