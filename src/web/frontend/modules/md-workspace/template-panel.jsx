// 任务模板面板 —— 工作区里的一块（可拖动 / 拆分 / 拖出成浮窗 / 布局记忆），不是弹窗。
//
// 入口三处，都指向**同一个页签**（component: 'templates'，单例）：
//   · 顶栏设置（齿轮）→「任务模板」
//   · 目录面板「模板 ▾」→「管理模板…」
//   · 「＋ 面板」抽屉 / 深链 #/templates
//
// 数据仍是 App 层那一份 useTemplates（tpl）——这里增删/设默认后，目录面板的
// 「模板 ▾」与「＋ 新建页」的起始正文即时跟随，不会各持一份旧数据。
//
// 与旧弹窗的差别只在**壳**：没有遮罩、没有 ×、Esc 不再是「关闭」（面板关掉 = 关页签）；
// 内容形态照旧（列表 + 行内编辑 + 新增），但整块面板自己滚动，列表不再有 44vh 的高度上限。
//
// UX 约定（沿用弹窗版）：
//   - 头部副标题写明「新建页默认使用哪个模板」，默认不是列表里的一个抽象标记；
//   - 每行给正文前几行的等宽预览（2 行截断），不点编辑也能认出模板长相；
//   - 正文用 MD 编辑器（源码 + 实时预览 + 格式工具条），模板本身就该按 Markdown 的样子配置；
//   - 编辑 = 行内展开表单（不是删了重加）；内置模板只读（无编辑/删除钮）；
//   - 删除走 confirm（一键误触没后悔药）；名字输入框 Enter 直接提交。
import { useRef, useState } from 'react';
import { Icon } from '../../components/icons.jsx';
import { useToast } from '../../components/ui.jsx';
import { useApp } from '../../app-context.jsx';
import TemplateEditor from './template-editor.jsx';
// 面板由工作区 factory 直接渲染，样式不随某个视图 chunk 走 —— 自己 import
//（vite 对同一文件去重，目录视图也引了这份）。
import './style.css';

export default function TemplatePanel() {
  const app = useApp() || {};
  const tpl = app.tpl;
  const toast = useToast();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null); // 行内编辑中的模板 id
  const [draft, setDraft] = useState({ name: '', body: '' });
  const addNameRef = useRef(null);

  if (!tpl) {
    return (
      <div className="mdw-tpl-panel">
        <div className="pad muted">模板服务未就绪 —— 面板还在装载。</div>
      </div>
    );
  }

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

  const templates = tpl.templates || [];
  const defaultName = templates.find((t) => t.id === tpl.defaultId)?.name || '内置骨架';
  const broken = tpl.templates == null; // 未加载 / 加载失败 / 服务版本不支持

  // 加载失败 / 版本不支持时的说明：说清原因 + 给一条出路（重试 / 重启面板）
  const brokenHint = tpl.unsupported
    ? '本机面板服务较旧，没有模板接口 —— 重启面板（nx-kv serve）后重试'
    : '模板列表加载失败 —— 服务暂时无响应，可点「重试」再试一次';

  return (
    <div className="mdw-tpl-panel">
      <div className="mdw-tpl-panel-inner">
        <div className="mdw-tpl-panel-head">
          <span className="mdw-tpl-panel-title">任务模板</span>
          <span className={'mdw-tpl-panel-sub' + (broken ? ' bad' : '')}>
            {broken ? brokenHint : `新建页默认使用「${defaultName}」`}
          </span>
          <span className="grow" />
          {!broken && <span className="mdw-tpl-panel-count">{templates.length} 个模板</span>}
        </div>
        <div className="mdw-tpl-panel-note">
          模板 = 新建任务页的起始正文。这里的改动即时生效：目录面板的「模板 ▾」与「＋ 新建页」用的就是这份列表。
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
    </div>
  );
}
