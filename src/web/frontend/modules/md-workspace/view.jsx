// MD 式目录工作台 —— 落地自 plan/agent-md-workspace.html
// 点目录 = 写新 MD 草稿并提交；点任务 = 编辑/预览已有 MD；右侧并发进程。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/ui.jsx';
import { GLOBAL_KEY } from '../../../../modules/localtask/board.js';
import ProgressPanel from './progress-panel.jsx';
import AttachBar from './attach-bar.jsx';
import ToolBar from './tool-bar.jsx';
import { MdPanes } from './md-panes.jsx';
import SelMenu from './sel-menu.jsx';
import { filesToAttachments, loadAttForTask, persistAtt } from './attachments.js';
import {
  NEW_TEMPLATE,
  renderMarkdownHtml,
  slugName,
  titleFromMd,
} from './md-parse.js';
import './style.css';

export default function MdWorkspace({ dirKey, rows, refreshLocal, onNavigate }) {
  const toast = useToast();
  const isGlobal = !dirKey || dirKey === GLOBAL_KEY;
  const topic = useMemo(() => {
    if (isGlobal) return rows.find((r) => r.isGlobal) || null;
    return rows.find((r) => r.key === dirKey) || null;
  }, [rows, dirKey, isGlobal]);

  const [mode, setMode] = useState('edit');
  const [focusTaskId, setFocusTaskId] = useState(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState(NEW_TEMPLATE);
  const [attachments, setAttachments] = useState([]);
  const [progOpen, setProgOpen] = useState(true);
  const [selMenu, setSelMenu] = useState(null);
  const fileMdRef = useRef(null);
  const fileAttRef = useRef(null);
  const articleRef = useRef(null);
  const lastSel = useRef('');

  const tasks = useMemo(
    () => (topic?.tasks || []).filter((t) => !t.deletedAt),
    [topic]
  );

  const loadTask = useCallback((task) => {
    if (!task) {
      setFocusTaskId(null);
      setTitle('');
      setBody(NEW_TEMPLATE);
      setAttachments([]);
      setMode('edit');
      return;
    }
    setFocusTaskId(task.id);
    const text = task.text || '';
    setTitle(titleFromMd(text));
    setBody(text);
    setAttachments(loadAttForTask(task.id));
    setMode(task.status === 'consumed' ? 'preview' : 'split');
  }, []);

  useEffect(() => {
    setFocusTaskId(null);
    setTitle('');
    setBody(NEW_TEMPLATE);
    setAttachments([]);
    setMode('edit');
    setSelMenu(null);
  }, [dirKey]);

  const applyTaskFromHash = useCallback(() => {
    const q = new URLSearchParams((location.hash.split('?')[1] || ''));
    const tid = q.get('task');
    if (!tid || !topic) return;
    const t = (topic.tasks || []).find((x) => String(x.id) === String(tid) && !x.deletedAt);
    if (t) loadTask(t);
  }, [topic, loadTask]);
  useEffect(() => {
    applyTaskFromHash();
    window.addEventListener('hashchange', applyTaskFromHash);
    return () => window.removeEventListener('hashchange', applyTaskFromHash);
  }, [applyTaskFromHash]);

  useEffect(() => {
    const close = () => setSelMenu(null);
    document.addEventListener('scroll', close, true);
    return () => document.removeEventListener('scroll', close, true);
  }, []);

  const previewHtml = useMemo(
    () => renderMarkdownHtml(body, attachments),
    [body, attachments]
  );

  const missing = !topic && !isGlobal;

  const guard = (fn) => fn().catch((e) => toast(String(e.message || e)));

  const composeBody = () => {
    const t = title.trim() || '未命名任务';
    let b = body;
    if (!/^#\s+/m.test(b)) b = `# ${t}\n\n${b}`;
    else b = b.replace(/^#\s+.+$/m, `# ${t}`);
    return { title: t, text: b };
  };

  const submit = () => guard(async () => {
    const { title: t, text } = composeBody();
    if (focusTaskId != null) {
      await api('/api/localtasks/item', {
        method: 'PATCH',
        body: {
          cwd: isGlobal ? undefined : topic.cwd,
          key: isGlobal ? GLOBAL_KEY : undefined,
          id: focusTaskId,
          text,
        },
      });
      persistAtt(focusTaskId, attachments);
      toast('已同步 MD');
      refreshLocal();
      return;
    }
    const res = await api('/api/localtasks', {
      method: 'POST',
      body: isGlobal ? { global: true, text } : { cwd: topic.cwd, text },
    });
    const newId = res?.task?.id ?? res?.id;
    if (newId != null) {
      persistAtt(newId, attachments);
      setFocusTaskId(newId);
      setTitle(t);
      setBody(text);
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

  const addFiles = async (fileList) => {
    const { items, imageInserts } = await filesToAttachments(fileList);
    if (imageInserts.length) setBody((b) => b + imageInserts.join(''));
    const next = [...attachments, ...items];
    setAttachments(next);
    if (focusTaskId != null) persistAtt(focusTaskId, next);
  };

  const openTask = (id) => {
    const t = tasks.find((x) => x.id === id);
    if (t) loadTask(t);
  };

  const spawnFollow = (isIssue) => {
    const quote = lastSel.current || '';
    if (!quote) {
      toast('先在预览中划选一段');
      return;
    }
    const parent = title || topic?.name || '';
    const t = `${isIssue ? '问题' : '追加'}：${quote.slice(0, 24)}`;
    const b = `# ${t}\n\n> 锚定自「${parent}」：\n> ${quote.replace(/\n/g, '\n> ')}\n\n## 要做什么\n- [ ] …\n\n## 验收\n- [ ] …\n`;
    setFocusTaskId(null);
    setTitle(t);
    setBody(b);
    setAttachments([]);
    setMode('edit');
    setSelMenu(null);
    toast('已打开新 MD 草稿（并发追加）');
  };

  const onPreviewMouseUp = (e) => {
    if (mode === 'edit') return;
    if (e.target.closest?.('#mdw-sel-menu')) return;
    const sel = window.getSelection();
    const text = (sel && String(sel)).trim();
    if (!text || text.length < 2) {
      setSelMenu(null);
      return;
    }
    if (!articleRef.current?.contains(sel.anchorNode)) {
      setSelMenu(null);
      return;
    }
    lastSel.current = text;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setSelMenu({
      x: Math.min(window.innerWidth - 220, Math.max(8, r.left + r.width / 2 - 100)),
      y: Math.min(window.innerHeight - 140, r.bottom + 8),
      text,
    });
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
    );
  }

  return (
    <div className="mdw" onMouseUp={onPreviewMouseUp}>
      <div className="mdw-main">
        <div className="mdw-top">
          <div className="mdw-head">
            <div className="mdw-title">
              {focusTaskId == null ? '新 MD 任务' : (title || '任务')}
            </div>
            <div className="mdw-path">
              {isGlobal ? '全局任务池' : (topic?.cwd || topic?.name || '—')}
              {focusTaskId != null ? ` / #${focusTaskId}` : ' / (draft)'}
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
          mode={mode}
          onMode={setMode}
          showMark={mode !== 'edit'}
          submitLabel={focusTaskId == null ? '提交为任务' : '保存并同步'}
          onImg={() => pickAtt('image/*')}
          onAtt={() => pickAtt('image/*,.pdf,.zip,.txt,.json,.csv')}
          onImport={() => fileMdRef.current?.click()}
          onNew={() => loadTask(null)}
          onMark={() => spawnFollow(true)}
          onDraft={() => toast('草稿仅在当前编辑器（刷新前有效）')}
          onSubmit={submit}
          onProg={() => setProgOpen((v) => !v)}
          onOverview={() => onNavigate('#/overview')}
        />

        <MdPanes
          ref={articleRef}
          mode={mode}
          title={title}
          body={body}
          previewHtml={previewHtml}
          onTitle={setTitle}
          onBody={setBody}
        />

        <AttachBar
          attachments={attachments}
          onRemove={(id) => {
            const next = attachments.filter((x) => x.id !== id);
            setAttachments(next);
            if (focusTaskId != null) persistAtt(focusTaskId, next);
          }}
        />
      </div>

      <ProgressPanel
        dirName={topic?.name || (isGlobal ? '全局任务' : '')}
        tasks={tasks}
        focusId={focusTaskId}
        open={progOpen}
        onToggle={setProgOpen}
        onOpenTask={openTask}
      />

      <SelMenu
        at={selMenu}
        onIssue={() => spawnFollow(true)}
        onAppend={() => spawnFollow(false)}
        onCopy={() => {
          navigator.clipboard?.writeText(lastSel.current);
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
    </div>
  );
}
