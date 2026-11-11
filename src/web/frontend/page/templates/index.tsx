// 任务模板编辑宿主（#135）：不再做列表页——管理在设置卡片；这里只承载全屏 MdPanes。
// config: { mode:'edit'|'new', id?, name?, scope?, topic? }
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { renderTemplateBody } from '../../modules/prompts/placeholders.js';
import { renderMarkdownHtml } from '../../modules/md/md-parse.js';
import { useMemo, useRef, useState } from 'react';
import { Actions } from 'flexlayout-react';
import type { Model } from 'flexlayout-react';
import { useToast } from '../../components/toast/index.jsx';
import { useApp } from '../../app-context.jsx';
import { MdPanes } from '../../components/md/md-panes.jsx';
import type { EditorApi } from '../../components/md/md-panes-helpers.js';
import { clearHistory, pushHistory, redoHistory, undoHistory } from '../../modules/md/md-history.js';
import { popRoute } from '../../components/layout/route-history.js';
import { openFloatingPanel } from '../../workspace.js';
import '../../modules/md/style.css';

/** 模板编辑器里「保存」回传的内容。 */
interface TemplateDraft {
  name: string;
  body: string;
}

const HIST_KEY = (id?: string | null) => `tpl:${id || 'new'}`;

interface TemplateEditorViewProps {
  templateId: string;
  initialName: string;
  initialBody: string;
  isNew: boolean;
  onSave: (v: TemplateDraft) => void | Promise<void>;
  onClose: () => void;
  busy: boolean;
}

function TemplateEditorView({
  templateId,
  initialName,
  initialBody,
  isNew,
  onSave,
  onClose,
  busy,
}: TemplateEditorViewProps) {
  const toast = useToast();
  const [name, setName] = useState(initialName || '');
  const [body, setBody] = useState(initialBody || '');
  const [mode, setMode] = useState('split');
  const [dirty, setDirty] = useState(false);
  const editorApiRef = useRef<EditorApi | null>(null);
  // 撤销栈（md-history 尚未标注形状，按 Map 原样递进去）
  const histRef = useRef<Map<string, unknown>>(new Map());
  const histId = HIST_KEY(isNew ? 'new' : templateId);

  const previewHtml = useMemo(() => renderMarkdownHtml(body || ''), [body]);

  const mark = (nextName: string, nextBody: string, kind = 'typing') => {
    pushHistory(histRef.current, histId, { title: name, body }, kind);
    setName(nextName);
    setBody(nextBody);
    setDirty(true);
  };

  const onTitle = (next: string, kind = 'typing') => mark(next, body, kind);
  const onBody = (next: string, kind = 'op') => mark(name, next, kind);

  const undo = () => {
    const snap = undoHistory(histRef.current, histId, { title: name, body });
    if (!snap) return;
    setName(snap.title || '');
    setBody(snap.body || '');
    setDirty(true);
  };
  const redo = () => {
    const snap = redoHistory(histRef.current, histId, { title: name, body });
    if (!snap) return;
    setName(snap.title || '');
    setBody(snap.body || '');
    setDirty(true);
  };

  const save = async () => {
    if (!(name || '').trim()) {
      toast('模板名不能为空（标题即名称）');
      return;
    }
    await onSave({ name: name.trim(), body });
    clearHistory(histRef.current, histId);
    setDirty(false);
  };

  return (
    <div className="mdw mdw-tpl-edpage" data-mode={mode}>
      <div className="mdw-main">
        <div className="mdw-top">
          <RouteBreadcrumb />
          <div className="mdw-head">
            <div className="mdw-title">{isNew ? '新建模板' : '编辑模板'}</div>
            <div className="mdw-path">
              任务模板
              {name ? ` / ${name}` : ''}
              {dirty ? ' · 未保存' : ''}
            </div>
          </div>
        </div>

        {/* 与任务页 ToolBar 同构：左模式 / 右 mdw-actions（勿用 .grow——全局 max-width:340 推不到右缘） */}
        <div className="mdw-toolbar">
          <div className="mdw-toolbar-left">
            <div className="seg" role="group" aria-label="编辑模式">
              {[
                { id: 'split', label: '并排' },
                { id: 'edit', label: '源码' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={mode === m.id ? 'on' : ''}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mdw-actions" role="group" aria-label="模板操作">
            <button type="button" className="btn ghost sm" disabled={busy} onClick={onClose}>
              关闭
            </button>
            <button type="button" className="btn sm primary" disabled={busy || !dirty} onClick={save}>
              {isNew ? '创建' : '保存'}
            </button>
          </div>
        </div>

        <MdPanes
          mode={mode}
          title={name}
          body={body}
          previewHtml={previewHtml}
          onTitle={onTitle}
          onBody={onBody}
          docKey={histId}
          editorApiRef={editorApiRef}
          onSave={save}
          onUndo={undo}
          onRedo={redo}
          attachments={[]}
        />
      </div>
    </div>
  );
}

export interface TemplatePanelProps {
  /** 面板 config（panels.tsx 透传的 JSON）：{ mode, id, name, topic, scope }。 */
  config?: Record<string, any>;
  model?: Model | null;
  tabId?: string;
}

export default function TemplatePanel({ config, model, tabId }: TemplatePanelProps) {
  const app = useApp();
  const tpl = app.tpl;
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const cfg = config || {};
  const mode = cfg.mode || (cfg.id ? 'edit' : '');
  const isNew = mode === 'new';
  const templateId = cfg.id || '';

  // #142：关闭/创建后回到来处面板，不要 deleteTab 把 maincontent 拆空。
  const leaveEditor = () => {
    const prev = popRoute();
    if (prev && app.onNavigate) {
      app.onNavigate(prev);
      return;
    }
    if (app.onNavigate) {
      app.onNavigate('#/overview');
      return;
    }
    if (model && tabId) {
      try {
        model.doAction(Actions.deleteTab(tabId));
      } catch {
        /* tab 可能已关 */
      }
    }
  };

  if (!tpl) {
    return (
      <div className="mdw-tpl-panel">
        <RouteBreadcrumb />
        <div className="pad muted">模板服务未就绪 —— 面板还在装载。</div>
      </div>
    );
  }

  // 无编辑意图（深链 #/templates）：不再提供列表，引导去设置。
  if (!isNew && !templateId) {
    return (
      <div className="mdw-tpl-panel">
        <RouteBreadcrumb />
        <div className="pad stack">
          <div>模板在「设置 → 任务模板」管理；这里只承载全屏编辑。</div>
          <div>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (model) {
                  openFloatingPanel(model, { component: 'settings', name: '设置', config: {} });
                }
                leaveEditor();
              }}
            >
              打开设置
            </button>
          </div>
        </div>
      </div>
    );
  }

  const existing = !isNew
    ? (tpl.templates || []).find((t) => t.id === templateId)
    : null;

  if (!isNew && !existing) {
    return (
      <div className="mdw-tpl-panel">
        <RouteBreadcrumb />
        <div className="pad muted">找不到模板「{templateId}」——可能已删除。</div>
      </div>
    );
  }

  const saveEditing = async ({ name, body }: TemplateDraft) => {
    setBusy(true);
    try {
      if (isNew) {
        const opts: { scope?: string[]; topic?: string } = {};
        if (Array.isArray(cfg.scope)) opts.scope = cfg.scope;
        if (cfg.topic) opts.topic = cfg.topic;
        await tpl.add(name, body, false, opts);
        toast('已创建模板');
      } else {
        await tpl.update(templateId, { name, body });
        toast('已保存模板');
      }
      leaveEditor();
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  // 走到这里 existing 必定存在（上面的守卫已排除「编辑态但找不到」）
  const initialName = isNew ? (cfg.name || '') : existing?.name ?? '';
  const initialBody = isNew
    ? ''
    : renderTemplateBody(existing?.body || '', existing?.values || {});

  return (
    <TemplateEditorView
      key={isNew ? `new:${cfg.topic || ''}:${(cfg.scope || []).join(',')}` : templateId}
      templateId={templateId}
      initialName={initialName}
      initialBody={initialBody}
      isNew={isNew}
      busy={busy}
      onSave={saveEditing}
      onClose={leaveEditor}
    />
  );
}
