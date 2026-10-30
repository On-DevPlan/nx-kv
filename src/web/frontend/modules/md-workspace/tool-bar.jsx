// MD 工作台工具区：左模式/格式工具，右动作按钮贴齐最右
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/icons.jsx';
import { ModeSeg } from './md-panes.jsx';
import { TURN_INTO } from './md-edit-ops.js';

const FMT_MAIN = [
  { op: 'bold', label: 'B', title: '粗体 Ctrl/⌘B', cls: 'b' },
  { op: 'italic', label: 'I', title: '斜体 Ctrl/⌘I', cls: 'i' },
  { op: 'code', label: '</>', title: '行内代码 Ctrl/⌘E', cls: 'code' },
  { op: 'link', label: '链', title: '链接 Ctrl/⌘K', cls: 'link' },
];

const FMT_MORE = [
  { op: 'ul', label: '列表', title: '无序列表', cls: 'ul' },
  { op: 'todo', label: '待办', title: '待办勾选', cls: 'todo' },
  { op: 'quote', label: '引用', title: '引用', cls: 'quote' },
];

function FmtBtn({ f, onFormat }) {
  return (
    <button
      type="button"
      className={`mdw-fmt-btn ${f.cls}`}
      title={f.title}
      onClick={() => onFormat?.(f.op)}
    >
      {f.label}
    </button>
  );
}

function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return { open, setOpen, ref };
}

export default function ToolBar({
  mode,
  onMode,
  showMark,
  submitLabel,
  onImg,
  onAtt,
  onImport,
  onNew,
  onMark,
  onDraft,
  onSubmit,
  onProg,
  onOverview,
  onFormat,
  onTurn,
}) {
  const canFormat = mode === 'edit' || mode === 'split';
  const liveOrEdit = mode !== 'preview';
  const fmtMore = useMenu();
  const actMore = useMenu();

  useEffect(() => {
    fmtMore.setOpen(false);
    actMore.setOpen(false);
  }, [mode]);

  const secondary = [
    mode !== 'split' && { id: 'import', label: '导入', run: onImport },
    { id: 'new', label: '新任务', run: onNew },
    showMark && mode !== 'split' && { id: 'mark', label: '标注', run: onMark },
    mode !== 'split' && { id: 'draft', label: '存草稿', run: onDraft },
    { id: 'overview', label: '总览', run: onOverview },
  ].filter(Boolean);

  return (
    <div className="mdw-toolbar">
      <div className="mdw-toolbar-left">
        <ModeSeg mode={mode} onChange={onMode} />
        {canFormat && (
          <div className="mdw-fmt" role="group" aria-label="格式">
            {FMT_MAIN.map((f) => (
              <FmtBtn key={f.op} f={f} onFormat={onFormat} />
            ))}
            <span className="mdw-fmt-sep" aria-hidden />
            <div className="mdw-fmt-turn" role="group" aria-label="转变为">
              {TURN_INTO.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="mdw-fmt-btn turn"
                  title={`${t.label}（${t.key}）`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onTurn?.(t.id)}
                >
                  <kbd>{t.key}</kbd>
                  <span className="mdw-fmt-turn-lab">{t.label}</span>
                </button>
              ))}
            </div>
            <div className="mdw-fmt-wide" role="presentation">
              {FMT_MORE.map((f) => (
                <FmtBtn key={f.op} f={f} onFormat={onFormat} />
              ))}
            </div>
            <div className="mdw-fmt-more" ref={fmtMore.ref}>
              <button
                type="button"
                className={`mdw-fmt-btn more${fmtMore.open ? ' on' : ''}`}
                title="更多格式"
                aria-expanded={fmtMore.open}
                aria-haspopup="menu"
                onClick={() => fmtMore.setOpen((v) => !v)}
              >
                ···
              </button>
              {fmtMore.open && (
                <div className="mdw-fmt-menu" role="menu">
                  {FMT_MORE.map((f) => (
                    <button
                      key={f.op}
                      type="button"
                      role="menuitem"
                      className="mdw-fmt-menu-item"
                      onClick={() => {
                        onFormat?.(f.op);
                        fmtMore.setOpen(false);
                      }}
                    >
                      {f.label}
                      <span className="hint">{f.title}</span>
                    </button>
                  ))}
                  <div className="mdw-fmt-menu-sep" role="separator" />
                  {TURN_INTO.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitem"
                      className="mdw-fmt-menu-item"
                      onClick={() => {
                        onTurn?.(t.id);
                        fmtMore.setOpen(false);
                      }}
                    >
                      {t.key} {t.label}
                      <span className="hint">转变</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {liveOrEdit && (
          <div className="mdw-tools" role="group" aria-label="编辑工具">
            <button type="button" className="iconbtn" title="插入图片" onClick={onImg}>
              <Icon name="pin" size={14} />
            </button>
            <button type="button" className="iconbtn" title="添加附件" onClick={onAtt}>
              <Icon name="list" size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="mdw-actions" role="group" aria-label="任务操作">
        <div className="mdw-actions-wide">
          {secondary.map((a) => (
            <button key={a.id} type="button" className="btn ghost sm" onClick={a.run}>
              {a.label}
            </button>
          ))}
        </div>
        <div className="mdw-actions-more" ref={actMore.ref}>
          <button
            type="button"
            className={`btn ghost sm${actMore.open ? ' on' : ''}`}
            title="更多操作"
            aria-expanded={actMore.open}
            aria-haspopup="menu"
            onClick={() => actMore.setOpen((v) => !v)}
          >
            更多
          </button>
          {actMore.open && (
            <div className="mdw-fmt-menu mdw-act-menu" role="menu">
              {secondary.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="menuitem"
                  className="mdw-fmt-menu-item"
                  onClick={() => {
                    a.run?.();
                    actMore.setOpen(false);
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="btn sm primary" onClick={onSubmit}>{submitLabel}</button>
        <span className="sep" aria-hidden />
        <button type="button" className="btn ghost sm" onClick={onProg}>进程</button>
      </div>
    </div>
  );
}
