// 模板正文编辑器：源码 + 实时预览。
//
// 模板本身就是 Markdown —— 配置它就该有个像样的编辑器，而不是裸 textarea。
// 复用工作台那两样东西（md-edit-ops 的格式操作、md-parse 的渲染器），所以
// 模板里看到的排版与任务页一致；但不引 md-panes 那个重组件（它带着标题栏、
// 附件、查找、slash 菜单），侧边栏入口不该为它背上整包体积。
import { useMemo, useRef, useState } from 'react';
import { runFormat } from './md-edit-ops.js';
import { renderMarkdownHtml } from './md-parse.js';

const TOOLS = [
  { op: 'bold', label: 'B', title: '粗体 Ctrl/⌘B', cls: 'b' },
  { op: 'italic', label: 'I', title: '斜体 Ctrl/⌘I', cls: 'i' },
  { op: 'code', label: '</>', title: '行内代码 Ctrl/⌘E', cls: 'code' },
  { op: 'link', label: '链', title: '链接 Ctrl/⌘K', cls: 'link' },
  { op: 'ul', label: '列表', title: '无序列表', cls: 'ul' },
  { op: 'todo', label: '待办', title: '待办勾选', cls: 'todo' },
  { op: 'quote', label: '引用', title: '引用', cls: 'quote' },
  { op: 'h2', label: 'H2', title: '二级标题', cls: 'h2' },
  { op: 'h3', label: 'H3', title: '三级标题', cls: 'h3' },
];

// 快捷键 → 格式操作（与工作台一致：B/I/E/K）
const KEY_OPS = { b: 'bold', i: 'italic', e: 'code', k: 'link' };

const MODES = [
  { id: 'split', label: '并排' },
  { id: 'edit', label: '源码' },
  { id: 'preview', label: '预览' },
];

export default function TemplateEditor({
  value,
  onChange,
  onSubmit,          // Ctrl/⌘+Enter（提交表单）
  placeholder = '模板正文（Markdown）',
  rows = 10,
}) {
  const taRef = useRef(null);
  const [mode, setMode] = useState('split');
  const html = useMemo(() => renderMarkdownHtml(value), [value]);

  /** 套格式：md-edit-ops 是纯函数（读 textarea → 算新值），写回后恢复选区 */
  const apply = (op) => {
    const r = runFormat(taRef.current, op);
    if (!r) return;
    onChange(r.value);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      try { ta.setSelectionRange(r.start, r.end); } catch { /* 元素可能已卸载 */ }
    });
  };

  const onKeyDown = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'enter') {
      e.preventDefault();
      onSubmit?.();
      return;
    }
    const op = KEY_OPS[k];
    if (!op) return;
    e.preventDefault();
    apply(op);
  };

  return (
    <div className="mdw-tpl-ed">
      <div className="mdw-tpl-ed-bar">
        {TOOLS.map((t) => (
          <button
            key={t.op}
            type="button"
            className={`mdw-fmt-btn ${t.cls}`}
            title={t.title}
            onMouseDown={(e) => e.preventDefault()} // 别把焦点从 textarea 抢走
            onClick={() => apply(t.op)}
          >
            {t.label}
          </button>
        ))}
        <span className="grow" />
        <div className="mdw-tpl-ed-modes" role="group" aria-label="编辑视图">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={'mdw-tpl-ed-mode' + (mode === m.id ? ' on' : '')}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`mdw-tpl-ed-panes mode-${mode}`}>
        {mode !== 'preview' && (
          <textarea
            ref={taRef}
            className="mdw-tpl-ed-src"
            value={value}
            rows={rows}
            spellCheck={false}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
        )}
        {mode !== 'edit' && (
          <div className="mdw-tpl-ed-prev" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
}
