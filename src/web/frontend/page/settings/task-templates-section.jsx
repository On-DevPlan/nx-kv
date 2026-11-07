// 设置面板「任务模板」模块：任务正文骨架（直接文字就是模板）。
//
// 与「提示词模板」严格分开：这里是新建任务时填的**正文骨架**（模板 body 只读，
// 用户只填槽位值，落库为纯字符串）；那边是领取任务时的系统提示词渲染配置
// （每个区块各自一份模板列表与生效项）。
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/toast/index.jsx';
import { Button } from '../../components/button/index.jsx';
import { useTemplates } from '../../modules/md/use-templates.js';
import { renderTemplateBody } from '../../modules/prompts/placeholders.js';
import TemplateEditor from '../../components/md/template-editor.jsx';

/** 模板正文编辑器（直接改文字）——草稿 + 显式保存（每次按键都存会把接口刷爆）。 */
function TemplateBodyEditor({ tpl, template }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // 草稿初始 = 渲染后的文字（出厂骨架里的 {{槽位}} 落到正文里）——
  // 用户看到什么、存回去的就是什么：文字就是模板。
  const [draft, setDraft] = useState(() =>
    renderTemplateBody(template.body || '', template.values || {}));
  const original = renderTemplateBody(template.body || '', template.values || {});
  const dirty = draft !== original;
  // 预览 = 新建页会拿到的正文（老模板里的 {{槽位}} 仍按 values 渲染，不露标记）
  const preview = useMemo(() => renderTemplateBody(draft, template.values || {}), [draft, template.values]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await tpl.update(template.id, { body: draft });
      toast(`已保存「${template.name}」`);
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="setp-row">
        <span>模板正文 · {template.name}</span>
        <span className="grow" />
        {dirty ? <span className="muted">未保存</span> : null}
        <Button variant="primary" disabled={busy || !dirty} onClick={save}>
          保存
        </Button>
      </div>
      <TemplateEditor value={draft} onChange={setDraft} onSubmit={save} rows={12} />
      {preview.trim() ? (
        <details className="setp-tpl-preview">
          <summary>预览新建任务正文</summary>
          <pre className="setp-tpl-preview-body">{preview}</pre>
        </details>
      ) : null}
    </>
  );
}

export default function TaskTemplatesSection({ openTemplates }) {
  const tpl = useTemplates();
  const templates = tpl.templates || [];
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    if (!templates.length) {
      setEditingId(null);
      return;
    }
    if (!editingId || !templates.some((t) => t.id === editingId)) {
      setEditingId(tpl.defaultId || templates[0].id);
    }
  }, [templates, tpl.defaultId, editingId]);

  if (tpl.unsupported) {
    return <div className="setp-note">当前服务比面板旧——重启面板后才有模板功能。</div>;
  }
  if (!templates.length) {
    return <div className="setp-note">还没有模板（内置默认模板加载中…）。</div>;
  }

  const current = templates.find((t) => t.id === editingId) || null;

  return (
    <div className="setp-tpl-split">
      <div className="setp-tpl-side">
        <div className="setp-row">
          <span>选用模板</span>
          <Button variant="secondary" onClick={() => openTemplates?.()}>
            管理…
          </Button>
        </div>
        <div className="setp-tpl-list" role="listbox" aria-label="任务模板">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={t.id === editingId}
              className={`setp-tpl-pick${t.id === editingId ? ' is-on' : ''}`}
              onClick={() => setEditingId(t.id)}
            >
              <span className="setp-tpl-name">{t.name}</span>
              {t.id === tpl.defaultId && <span className="setp-badge">默认</span>}
              {t.builtin && <span className="setp-badge">内置</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="setp-tpl-main">
        {current ? (
          // key=模板 id：切模板即重挂载，草稿随之重置（不跨模板保留半截改动）
          <TemplateBodyEditor key={current.id} tpl={tpl} template={current} />
        ) : (
          <div className="setp-note">从左侧选一个模板。</div>
        )}
      </div>
    </div>
  );
}
