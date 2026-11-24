// 任务模板宿主（#217）：#/templates = 列表页（主内容区，侧边栏 sfoot 进入）；
// #/templates/new、#/templates/edit/<id> = 全屏模板编辑器（MdPanes）。
// config: { mode:'edit'|'new', id?, name?, scope?, topic? }
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { renderMarkdownHtml } from '../../modules/md/md-parse.js';
import { useMemo, useRef, useState } from 'react';
import { Actions } from 'flexlayout-react';
import type { Model } from 'flexlayout-react';
import { useToast } from '../../components/toast/index.jsx';
import { useApp } from '../../app-context.jsx';
import { MdPanes } from '../../components/md/panes/md-panes.jsx';
import type { EditorApi } from '../../components/md/panes/md-panes-helpers.js';
import { clearHistory, pushHistory, redoHistory, undoHistory } from '../../modules/md/md-history.js';
import { popRoute } from '../../components/layout/route-history.js';
import TemplateListPanel from './template-list.jsx';
import TemplateManagePanel from './manage.jsx';
import TemplateFillPanel from './fill.jsx';
import '../../modules/md/style.css';
import './style.css';

/** 模板编辑器里「保存」回传的内容。 */
interface TemplateDraft {
  name: string;
  body: string;
}

const HIST_KEY = (id?: string | null) => `tpl:${id || 'new'}`;

/**
 * 新建模板的默认正文：一段可直接改写的 Markdown 骨架。
 * 模板只负责内容与样式，正式内容在任务编辑页自行填写；留白不够就在模板里多留空行。
 */
const NEW_TEMPLATE_BODY = `## 背景


## 验收
- [ ] …

## 约束
- …`;

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

  // 预览 = 正文的 Markdown 渲染；模板就是内容本身，没有插槽/渲染替换层。
  const previewHtml = useMemo(
    () => renderMarkdownHtml(body || ''),
    [body],
  );

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

  // #151：主题级模板管理页（从「新建任务」下拉的「管理模板…」进入）
  if (mode === 'manage') {
    return <TemplateManagePanel config={cfg} />;
  }

  // #151/#191：参数填写中间页（带 {{槽位}} 的模板先填值，再生成纯文本草稿）
  if (mode === 'fill') {
    return <TemplateFillPanel config={cfg} />;
  }

  // #142：关闭/创建后回到来处面板，不要 deleteTab 把 maincontent 拆空。
  const leaveEditor = () => {
    const prev = popRoute();
    if (prev && app.onNavigate) {
      app.onNavigate(prev);
      return;
    }
    if (app.onNavigate) {
      app.onNavigate('#/repos');
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

  // 列表态（#/templates）：模板列表已经在主内容区里了（#217——从设置搬出来，
  // 侧边栏 sfoot 直接进这一页），不再是「引导去设置」的空占位。
  if (!isNew && !templateId) {
    return <TemplateListPanel />;
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
  const initialBody = isNew ? NEW_TEMPLATE_BODY : existing?.body ?? '';

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
