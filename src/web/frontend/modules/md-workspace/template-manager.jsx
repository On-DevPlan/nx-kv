// 任务模板管理：增 / 删 / 改（行内编辑）/ 设默认。入口在侧边栏设置（齿轮 → 「任务模板…」）。
// 数据用 App 层持有的同一份 useTemplates 实例（tpl prop）——这里改完，
// MD 工作台的「模板 ▾」菜单与默认正文即时跟随。Esc / 点遮罩 / × 关闭。
//
// UX 约定：
//   - 头部副标题写明「新建页默认使用哪个模板」，默认不再是列表里的一个抽象标记；
//   - 每行给正文前几行的等宽预览（2 行截断），不点编辑也能认出模板长相；
//   - 正文用 MD 编辑器（源码 + 实时预览 + 格式工具条），不是裸 textarea——
//     模板本身就是 Markdown，配置它就该按 Markdown 的样子来；
//   - 编辑 = 行内展开表单（不是删了重加）；内置模板只读（无编辑/删除钮）；
//   - 删除走 confirm（一键误触没后悔药）；名字输入框 Enter 直接提交。
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icons.jsx';
import TemplateEditor from './template-editor.jsx';
// 组件从侧边栏（index chunk）就能打开，而 md-workspace 的样式由目录视图 chunk 携带——
// 挂载方不一定是加载过那份 CSS 的视图，所以这里自己 import（vite 对同一文件去重）。
import './style.css';

export default function TemplateManager({ tpl, onClose, toast }) {
  const ref = useRef(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null); // 行内编辑中的模板 id
  const [draft, setDraft] = useState({ name: '', body: '' });
  const addNameRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const act = (fn, okMsg) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast(okMsg);
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const addTemplate = act(async () => {
    if (!(name || '').trim()) {
      toast('先给模板起个名字');
      addNameRef.current?.focus();
      return;
    }
    await tpl.add(name.trim(), body, false);
    setName('');
    setBody('');
    addNameRef.current?.focus();
  }, '已新增模板');

  const startEdit = (t) => {
    setEditingId(t.id);
    setDraft({ name: t.name, body: t.body });
  };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = act(async () => {
    if (!(draft.name || '').trim()) {
      toast('模板名不能为空');
      return;
    }
    await tpl.update(editingId, { name: draft.name.trim(), body: draft.body });
    setEditingId(null);
  }, '已保存模板');

  const setDefault = (t) => act(() => tpl.setDefault(t.id), `默认模板已设为「${t.name}」`)();
  const removeTpl = (t) => {
    if (!confirm(`删除模板「${t.name}」？`)) return;
    act(() => tpl.remove(t.id), `已删除「${t.name}」`)();
  };

  const defaultName = (tpl.templates || []).find((t) => t.id === tpl.defaultId)?.name || '内置骨架';
  const templates = tpl.templates || [];
  const broken = tpl.templates == null; // 未加载 / 加载失败 / 服务版本不支持

  // 加载失败 / 版本不支持时的占位行：说清原因 + 给一条出路（重试 / 重启面板）
  const brokenHint = tpl.unsupported
    ? '本机面板服务较旧，没有模板接口 —— 重启面板（nx-kv serve）后重试'
    : '模板列表加载失败 —— 服务暂时无响应，可点「重试」再试一次';

  return createPortal(
    <div
      className="mdw-sheet-back"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mdw-sheet mdw-tpl" role="dialog" aria-modal="true" aria-label="任务模板管理" ref={ref}>
        <div className="mdw-sheet-head">
          <div className="mdw-tpl-head">
            <span className="mdw-sheet-title">任务模板</span>
            <span className={'mdw-tpl-sub' + (broken ? ' bad' : '')}>
              {broken ? brokenHint : `新建页默认使用「${defaultName}」`}
            </span>
          </div>
          <button type="button" className="mdw-sheet-x" onClick={onClose} aria-label="关闭任务模板管理">
            ×
          </button>
        </div>

        <div className="mdw-tpl-list">
          {templates.map((t) =>
            editingId === t.id ? (
              <div key={t.id} className="mdw-tpl-row editing">
                <input
                  className="mdw-tpl-name-in"
                  value={draft.name}
                  autoFocus
                  placeholder="模板名"
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
                />
                <TemplateEditor
                  value={draft.body}
                  onChange={(v) => setDraft((d) => ({ ...d, body: v }))}
                  onSubmit={saveEdit}
                  rows={12}
                />
                <div className="mdw-tpl-acts end">
                  <span className="mdw-tpl-hint">Ctrl/⌘ + Enter 保存</span>
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={cancelEdit}>
                    取消
                  </button>
                  <button type="button" className="btn sm primary" disabled={busy} onClick={saveEdit}>
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <div key={t.id} className="mdw-tpl-row">
                <div className="mdw-tpl-main">
                  <div className="mdw-tpl-name">
                    {t.name}
                    {t.id === tpl.defaultId && <span className="mdw-tpl-def">默认</span>}
                    {t.builtin && <span className="mdw-tpl-builtin">内置</span>}
                  </div>
                  <div className="mdw-tpl-prev">{String(t.body || '').trim() || '（空）'}</div>
                </div>
                <div className="mdw-tpl-acts">
                  {t.id !== tpl.defaultId && (
                    <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setDefault(t)}>
                      设为默认
                    </button>
                  )}
                  {!t.builtin && (
                    <button type="button" className="btn ghost sm" disabled={busy} onClick={() => startEdit(t)}>
                      编辑
                    </button>
                  )}
                  {!t.builtin && (
                    <button
                      type="button"
                      className="btn ghost sm danger"
                      disabled={busy}
                      title="删除此模板"
                      onClick={() => removeTpl(t)}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </div>
              </div>
            )
          )}
          {broken && (
            <div className="mdw-tpl-empty">
              <div className="mdw-tpl-retry">
                <button type="button" className="btn ghost sm" onClick={() => tpl.refetch()}>
                  重试
                </button>
              </div>
            </div>
          )}
          {!broken && !templates.length && (
            <div className="mdw-tpl-empty">还没有自定义模板；下面加一个，或直接用内置的。</div>
          )}
        </div>

        {!broken && (
          <div className="mdw-tpl-add">
            <div className="mdw-tpl-add-h">新增模板</div>
            <input
              ref={addNameRef}
              className="mdw-tpl-name-in"
              value={name}
              placeholder="模板名，如 缺陷修复 / 周报"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTemplate(); }}
            />
            <TemplateEditor
              value={body}
              onChange={setBody}
              onSubmit={addTemplate}
              rows={12}
              placeholder={'模板正文（Markdown）。\n留空则用内置骨架（## 背景 / ## 验收 / ## 约束 / ## 附件）。'}
            />
            <div className="mdw-tpl-add-acts">
              <span className="mdw-tpl-hint">首行写 `# 标题`，提交时它就是任务标题；Ctrl/⌘ + Enter 快速添加。</span>
              <button type="button" className="btn sm primary" disabled={busy} onClick={addTemplate}>
                添加
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
