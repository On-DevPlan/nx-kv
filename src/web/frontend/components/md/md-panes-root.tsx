// MdPanes（模式分发 + 文档级快捷键）与 ModeSeg（模式切换段控件）。
// 两个编辑器实现在 md-panes.jsx（结构钉测试锚定其源码），这里只做装配。
import { forwardRef, useEffect, useRef } from 'react';
import type { ForwardedRef, RefObject } from 'react';
import { FMT_KEYS, bodyHasH1 } from './md-panes-helpers.js';
import type { EditorApi, FileDropCtx } from './md-panes-helpers.js';
import { LivePreview, SourceEditor } from './md-panes.jsx';
import type { TextSel } from './md-panes.jsx';
import type { AttachHost } from './attach-picker.jsx';
import type { Attachment } from './attach-common.js';

/** forwardRef 的 ref 实参 → 可读 .current 的对象 ref（回调 ref 走不到这条路）。 */
function asRefObject<T>(ref: ForwardedRef<T>): RefObject<T | null> | null {
  if (!ref || typeof ref === 'function') return null;
  return ref;
}

export interface MdPanesProps {
  mode?: string;
  title?: string;
  body?: string;
  previewHtml?: string;
  onTitle?: (v: string, kind?: string) => void;
  onBody?: (b: string, kind?: string) => void;
  attachments?: Attachment[];
  docKey?: string;
  editorApiRef?: RefObject<EditorApi | null> | null;
  onFiles?: ((files: File[], ctx?: FileDropCtx) => void) | null;
  onTextSel?: ((sel: TextSel | null) => void) | null;
  onSave?: (() => void) | null;
  onUndo?: (() => void) | null;
  onRedo?: (() => void) | null;
  onCloseSelMenu?: (() => void) | null;
  hideTitle?: boolean;
  attachHost?: AttachHost | null;
}

/** 实时预览 / 源码 / 阅读 */
export const MdPanes = forwardRef<HTMLElement, MdPanesProps>(function MdPanes(
  {
    mode,
    title = '',
    body = '',
    previewHtml = '',
    onTitle,
    onBody,
    attachments = [],
    docKey = 'draft',
    editorApiRef = null,
    onFiles = null,
    onTextSel = null,
    onSave = null,
    onUndo = null,
    onRedo = null,
    onCloseSelMenu = null,
    hideTitle = false,
    attachHost = null,
  },
  articleRef
) {
  // 调用方没传 editorApiRef 时也要有个落点（useImperativeHandle 不收 null）
  const fallbackApiRef = useRef<EditorApi | null>(null);
  const apiRef = editorApiRef ?? fallbackApiRef;
  // 同样：滚动根元素的 ref 以对象形态给到 LivePreview 读 .current
  const localRootRef = useRef<HTMLElement | null>(null);
  const rootRef = asRefObject(articleRef) ?? localRootRef;

  // 文档级快捷键集中接管（window 捕获阶段）：
  // 受控 textarea 的原生 undo 栈会被程序化改写冲掉，且原生撤销与我们的
  // 历史栈会互相打架——统一在这里拦截，编辑器区的按键行为才稳定可预期。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      // DOM 事件边界：target 声明为 EventTarget，closest 只在元素上才有
      const t = e.target as Element | null;
      if (!t || typeof t.closest !== 'function') return;
      const k = e.key.toLowerCase();
      const inEditorText = t.closest('.mdw-editor,.mdw-lp-src,.mdw-lp-title,.mdw-title-input');
      if (k === 'f' && mode !== 'edit') {
        // 实时预览/阅读态的查找（源码态由编辑器自己接管）；只要焦点在工作台内即可
        if (!t.closest('.mdw')) return;
        e.preventDefault();
        apiRef.current?.openFind?.();
        return;
      }
      if (!inEditorText) {
        // 预览态划选后按格式键：切编辑态并套格式（Notion/Typora 行为）
        const fmtOp = FMT_KEYS[k];
        if (mode === 'split' && fmtOp) {
          if (apiRef.current?.formatSelection?.(fmtOp)) e.preventDefault();
        }
        return;
      }
      if (k === 's') {
        e.preventDefault();
        onSave?.();
        return;
      }
      if (k === 'z') {
        // 只在页面接了自定义历史时拦截（#156）——没接的页面（如外部只读视图）
        // 回落浏览器原生撤销，别把原生 textarea 撤销也一起 preventDefault 掉
        const h = e.shiftKey ? onRedo : onUndo;
        if (!h) return;
        e.preventDefault();
        h();
        return;
      }
      if (k === 'y') {
        if (!onRedo) return;
        e.preventDefault();
        onRedo();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onSave, onUndo, onRedo, mode, editorApiRef]);

  // 源码态：偶尔切过去改标记（入口在「更多」菜单里，不再占页头）
  if (mode === 'edit') {
    return (
      <div className="mdw-split mode-edit">
        <SourceEditor
          title={title}
          body={body}
          onTitle={onTitle}
          onBody={onBody}
          editorApiRef={apiRef}
          onFiles={onFiles}
          onTextSel={onTextSel}
        />
      </div>
    );
  }

  // 只读文档（外部绑定）：没有模式可切，直接渲染阅读视图。
  // 「阅读」不再是用户可选模式（#47 撤掉），只作为不可写文档的兜底呈现。
  if (!onBody && !onTitle) {
    return (
      <div className="mdw-split mode-read">
        <div className="mdw-pane mdw-preview">
          <div className="mdw-reader">
            {/* 阅读态此前不渲染标题，与 live/源码两态断裂；题头与正文同轴同宽。
                正文自带 `# 标题` 时不再画外部题头——文档的 body 本来就含首行标题，
                两个都画就是同一行字出现两次（阅读态看起来像渲染 bug）。 */}
            {title && !bodyHasH1(body) ? (
              <h1 className="mdw-reader-title">{title}</h1>
            ) : null}
            <article ref={articleRef} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mdw-split mode-split live">
      <LivePreview
        title={title}
        body={body}
        onTitle={onTitle}
        onBody={onBody}
        articleRef={rootRef}
        attachments={attachments}
        docKey={docKey}
        onFiles={onFiles}
        editorApiRef={apiRef}
        onTextSel={onTextSel}
        onCloseSelMenu={onCloseSelMenu}
        hideTitle={hideTitle}
        attachHost={attachHost}
      />
    </div>
  );
});

const MODES = [
  { id: 'split', label: '实时预览' },
  { id: 'edit', label: '源码' },
];

export function ModeSeg({ mode, onChange }: { mode?: string; onChange: (m: string) => void }) {
  return (
    <div className="seg" role="tablist" aria-label="编辑模式">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          className={mode === m.id ? 'on' : ''}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
