// MD 页签面板 —— 一个 MD 页 = 工作区里的一等页签。
//
// 面板化之后，原来的「工作台内部页签栏」没了：开哪几页、在哪开、能不能并排，
// 都由工作区布局管（可拖拽 / 可拆分 / 可浮出）。这个面板只管**一页的内容**：
// 编辑、保存/提交、附件、撤销重做、划选浮条。
//
// 文档内容存在会话内存（doc-store.js），页签身份在 FlexLayout 模型里——
// 两者分工明确：布局归布局，内容归内容。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Actions } from 'flexlayout-react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/ui.jsx';
import { GLOBAL_KEY } from '../../../../modules/localtask/board.js';
import ToolBar from './tool-bar.jsx';
import { MdPanes } from './md-panes.jsx';
import AttachBar from './attach-bar.jsx';
import SelMenu from './sel-menu.jsx';
import ShortcutSheet from './shortcut-sheet.jsx';
import { useApp } from '../../app-context.jsx';
import { filesToAttachments, persistAtt } from './attachments.js';
import { clearHistory, pushHistory, redoHistory, undoHistory } from './md-history.js';
import { renderMarkdownHtml, slugName, titleFromMd } from './md-parse.js';
import {
  docIdOf,
  getDoc,
  isDraftTask,
  nextDraftId,
  promoteDoc,
  saveDoc,
  scopeOf,
  useDocs,
} from './doc-store.js';

export default function PagePanel({ dirKey, task, tabId, model }) {
  const app = useApp() || {};
  const toast = useToast();
  const rows = app.rows || [];
  const refreshLocal = app.refreshLocal;
  const tpl = app.tpl;

  const isGlobal = !dirKey || dirKey === GLOBAL_KEY;
  const scope = scopeOf(dirKey);
  const isDraft = isDraftTask(task);
  const id = docIdOf(scope, task);

  // 本目录的主题（提交/删除要它的 cwd）
  const topic = useMemo(() => {
    if (isGlobal) return rows.find((r) => r.isGlobal) || null;
    return rows.find((r) => r.key === dirKey) || null;
  }, [rows, dirKey, isGlobal]);

  const taskRow = useMemo(
    () => (topic?.tasks || []).find((x) => String(x.id) === String(task)) || null,
    [topic, task]
  );

  const docs = useDocs();
  const doc = docs[id] || null;

  // 首开这一页时把内容「种」进去：真实任务用服务端正文，草稿用默认模板
  useEffect(() => {
    if (docs[id]) return;
    if (isDraft) getDoc(id, { title: '', body: tpl ? tpl.defaultBody() : '' });
    else if (taskRow) getDoc(id, { title: titleFromMd(taskRow.text), body: taskRow.text });
  }, [id, isDraft, taskRow]);

  const [selMenu, setSelMenu] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const fileMdRef = useRef(null);
  const fileAttRef = useRef(null);
  const articleRef = useRef(null);
  const editorApiRef = useRef(null);
  const lastSel = useRef('');
  const histRef = useRef(new Map());
  const [dirty, setDirty] = useState(false);

  const previewHtml = useMemo(
    () => (doc ? renderMarkdownHtml(doc.body, doc.attachments) : ''),
    [doc]
  );

  useEffect(() => {
    setSelMenu(null);
  }, [id]);

  useEffect(() => {
    const close = () => setSelMenu(null);
    document.addEventListener('scroll', close, true);
    return () => document.removeEventListener('scroll', close, true);
  }, []);

  const guard = (fn) => fn().catch((e) => toast(String(e.message || e)));

  const markDirty = useCallback(() => setDirty(true), []);

  // ─── 保存 / 提交 ───
  const submit = () => guard(async () => {
    if (!doc) return;
    const t = (doc.title || '').trim() || '未命名任务';
    let b = doc.body;
    if (!/^#\s+/m.test(b)) b = `# ${t}\n\n${b}`;
    else b = b.replace(/^#\s+.+$/m, `# ${t}`);
    if (!isDraft) {
      await api('/api/localtasks/item', {
        method: 'PATCH',
        body: {
          cwd: isGlobal ? undefined : topic.cwd,
          key: isGlobal ? GLOBAL_KEY : undefined,
          id: Number(task),
          text: b,
        },
      });
      persistAtt(task, doc.attachments);
      saveDoc(id, { title: t, body: b });
      setDirty(false);
      clearHistory(histRef.current, id);
      toast('已同步 MD');
      refreshLocal();
      return;
    }
    // 草稿 → 提交成任务：换身份（页签的 config 跟着改，内容搬到新任务号下）
    const res = await api('/api/localtasks', {
      method: 'POST',
      body: isGlobal ? { global: true, text: b } : { cwd: topic.cwd, text: b },
    });
    const newId = res?.task?.id ?? res?.id;
    if (newId != null) {
      persistAtt(newId, doc.attachments);
      const newDocId = docIdOf(scope, String(newId));
      promoteDoc(id, newDocId, { title: t, body: b });
      // 页签的 config 换成新任务（否则刷新后还认着 draft 号）
      if (model && tabId) {
        model.doAction(Actions.updateNodeAttributes(tabId, { config: { dirKey, task: String(newId) } }));
      }
      setDirty(false);
      clearHistory(histRef.current, newDocId);
    }
    toast(`已提交：${slugName(t)}`);
    refreshLocal();
  });

  // ─── 导入 .md（在本目录里建一个任务，并开它的页签）───
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
      if (newId != null && app.openPage) app.openPage({ dirKey, task: String(newId), name: `#${newId}` });
    });
  };

  // ─── 删除本页（软删除）───
  const delTask = () => {    if (!doc || isDraft) return;
    const title = doc.title || `#${task}`;
    if (!confirm(`删除任务「${title}」？\n软删除：CLI localtask task restore 可恢复。`)) return;
    guard(async () => {
      await api('/api/localtasks/item', {
        method: 'DELETE',
        body: isGlobal ? { key: GLOBAL_KEY, id: Number(task) } : { cwd: topic.cwd, id: Number(task) },
      });
      toast(`已删除「${title}」`);
      if (model && tabId) model.doAction(Actions.deleteTab(tabId));
      refreshLocal();
    });
  };

  const addFiles = async (fileList, opts = {}) => {
    if (!doc) return;
    const { items, imageInserts } = await filesToAttachments(fileList);
    const patch = {};
    if (imageInserts.length) {
      const ins = imageInserts.join('');
      const b = doc.body || '';
      if (opts.insertAt != null && opts.insertAt >= 0) {
        const at = Math.min(opts.insertAt, b.length);
        patch.body = b.slice(0, at) + ins + b.slice(at);
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
    patch.attachments = [...(doc.attachments || []), ...items];
    saveDoc(id, patch);
    markDirty();
    if (!isDraft) persistAtt(task, patch.attachments);
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
    // 并发追加：开一个**新的页签**（工作区里并排开着，不打断当前这页）
    if (app.openPage) app.openPage({ dirKey, body: b, title: t });
    setSelMenu(null);
    toast('已开新页签（并发追加）');
  };

  /** 标题与正文首行 # 双向同步 */
  const onTitle = (next, kind = 'typing') => {
    if (!doc) return;
    pushHistory(histRef.current, id, { title: doc.title, body: doc.body }, kind);
    markDirty();
    const patch = { title: next };
    if (doc.mode !== 'split' && /^# (?!#)/m.test(doc.body)) {
      patch.body = doc.body.replace(/^# (?!#).+$/m, `# ${next || '未命名任务'}`);
    }
    saveDoc(id, patch);
  };

  const onBody = (next, kind = 'op') => {
    if (!doc) return;
    pushHistory(histRef.current, id, { title: doc.title, body: doc.body }, kind);
    markDirty();
    const patch = { body: next };
    if (doc.mode !== 'split') patch.title = titleFromMd(next);
    saveDoc(id, patch);
  };

  const undo = () => {
    if (!doc) return;
    const snap = undoHistory(histRef.current, id, { title: doc.title, body: doc.body });
    if (!snap) return;
    saveDoc(id, { title: snap.title, body: snap.body });
    markDirty();
    requestAnimationFrame(() => editorApiRef.current?.caretFromDiff?.(doc.body, snap.body));
  };

  const redo = () => {
    if (!doc) return;
    const snap = redoHistory(histRef.current, id, { title: doc.title, body: doc.body });
    if (!snap) return;
    saveDoc(id, { title: snap.title, body: snap.body });
    markDirty();
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

  const onEditorTextSel = (info) => {
    if (!info?.text || info.text.length < 1) {
      setSelMenu((cur) => (cur?.kind === 'format' ? null : cur));
      return;
    }
    placeSelMenu('format', info.text, info.x, info.y);
  };

  const onPreviewMouseUp = (e) => {
    if (!doc || doc.mode === 'edit') return;
    if (e.target.closest?.('#mdw-sel-menu')) return;
    if (e.target.closest?.('textarea')) return;
    const sel = window.getSelection();
    const text = (sel && String(sel)).trim();
    if (!text || text.length < 2) {
      setSelMenu((cur) => (cur?.kind === 'task' ? null : cur));
      return;
    }
    if (!articleRef.current?.contains(sel.anchorNode)) {
      setSelMenu((cur) => (cur?.kind === 'task' ? null : cur));
      return;
    }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    placeSelMenu('task', text, r.left + r.width / 2 - 100, r.bottom + 8);
  };

  const pickAtt = (accept) => {
    fileAttRef.current.accept = accept;
    fileAttRef.current?.click();
  };

  if (!doc) {
    return <div className="mdw"><div className="pad muted">载入中…</div></div>;
  }

  return (
    <div className="mdw" data-mode={doc.mode || 'split'} onMouseUp={onPreviewMouseUp}>
      <div className="mdw-main">
        <div className="mdw-top">
          <div className="mdw-head">
            <div className="mdw-title">{isDraft ? (doc.title || '新 MD 任务') : (doc.title || '任务')}</div>
            <div className="mdw-path">
              {isGlobal ? '全局任务池' : (topic?.cwd || topic?.name || '—')}
              {isDraft ? ` / (${task})` : ` / #${task}`}
              {dirty ? ' · 未保存' : ''}
            </div>
          </div>
        </div>

        <ToolBar
          mode={doc.mode}
          onMode={(m) => saveDoc(id, { mode: m })}
          showMark={doc.mode !== 'edit'}
          submitLabel={isDraft ? '提交为任务' : '保存并同步'}
          onImg={() => pickAtt('image/*')}
          onAtt={() => pickAtt('image/*,.pdf,.zip,.txt,.json,.csv')}
          onShortcuts={() => setShowShortcuts(true)}
          onImport={() => fileMdRef.current?.click()}
          onNew={() => app.openPage && app.openPage({ dirKey, task: nextDraftId(), name: '新任务' })}
          onMark={() => spawnFollow(true)}
          onDraft={() => toast('草稿随页签保留（刷新后需从侧栏或页签重新打开）')}
          onSubmit={submit}
          onDelete={isDraft ? null : delTask}
          onOverview={() => app.onNavigate && app.onNavigate('#/overview')}
          onFormat={(op) => editorApiRef.current?.format?.(op)}
          onTurn={(id2) => editorApiRef.current?.turn?.(id2)}
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
          docKey={id}
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
          onRemove={(aid) => {
            const next = (doc.attachments || []).filter((x) => x.id !== aid);
            markDirty();
            saveDoc(id, { attachments: next });
            if (!isDraft) persistAtt(task, next);
          }}
        />
      </div>

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
        ref={fileAttRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const f = e.target.files;
          e.target.value = '';
          if (f && f.length) addFiles(f);
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
      {showShortcuts && <ShortcutSheet onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
