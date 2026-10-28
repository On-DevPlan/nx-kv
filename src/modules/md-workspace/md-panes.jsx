import { forwardRef } from 'react';

/** 编辑 / 预览 / 分栏 内容区 */
export const MdPanes = forwardRef(function MdPanes(
  { mode, title, body, previewHtml, onTitle, onBody },
  articleRef
) {
  return (
    <div className={`mdw-split mode-${mode}`}>
      {mode !== 'preview' && (
        <div className="mdw-pane mdw-pane-edit">
          <input
            className="mdw-title-input"
            value={title}
            placeholder="任务标题"
            onChange={(e) => onTitle(e.target.value)}
          />
          <textarea
            className="mdw-editor"
            value={body}
            spellCheck={false}
            placeholder="用 Markdown 写任务——背景、验收、约束。"
            onChange={(e) => onBody(e.target.value)}
          />
        </div>
      )}
      {mode !== 'edit' && (
        <div className="mdw-pane mdw-preview">
          <article ref={articleRef} dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      )}
    </div>
  );
});

export function ModeSeg({ mode, onChange }) {
  return (
    <div className="seg">
      {['edit', 'preview', 'split'].map((m) => (
        <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={() => onChange(m)}>
          {{ edit: '编辑', preview: '预览', split: '分栏' }[m]}
        </button>
      ))}
    </div>
  );
}
