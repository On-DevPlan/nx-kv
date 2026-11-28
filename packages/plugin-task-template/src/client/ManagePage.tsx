// 插件自管理页（左下角「任务模板」条目）：模板列表 + 新建/编辑/设默认/排序/删除。
// 这是插件自己的内部 setting，宿主只提供 PluginClientApi。
import { useEffect, useState } from 'react';
import type { PluginClientApi } from '@nx-kv/plugin-sdk/client';

interface TemplateView {
  id: string;
  name: string;
  body: string;
  builtin: boolean;
  default: boolean;
  scope: string[];
  vars: Record<string, string>;
  sortOrder: number;
  slots: { key: string; label: string }[];
}

interface TemplateData {
  defaultId: string;
  templates: TemplateView[];
}

const NEW_BODY = `## 背景


## 验收
- [ ] …

## 约束
- …`;

export default function ManagePage({ api }: { api: PluginClientApi }) {
  const [data, setData] = useState<TemplateData | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState('');

  const apply = (result: any) => {
    if (result && Array.isArray(result.templates)) {
      setData({ defaultId: String(result.defaultId || ''), templates: result.templates });
    }
  };

  const load = async () => {
    setBusy(true);
    try {
      const d = await api.rpc('listTemplates');
      setData(d);
    } catch (e) {
      api.toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startNew = () => setEditing({ id: '', name: '', body: NEW_BODY });
  const startEdit = (t: TemplateView) => setEditing({ id: t.id, name: t.name, body: t.body });
  const cancelEdit = () => setEditing(null);

  const save = async () => {
    if (!editing || busy) return;
    if (!editing.name.trim()) {
      api.toast('模板名不能为空');
      return;
    }
    setBusy(true);
    try {
      const result = editing.id
        ? await api.rpc('updateTemplate', { id: editing.id, name: editing.name.trim(), body: editing.body })
        : await api.rpc('addTemplate', { name: editing.name.trim(), body: editing.body });
      apply(result);
      setEditing(null);
      api.toast(editing.id ? '模板已保存' : '模板已创建');
    } catch (e) {
      api.toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (t: TemplateView) => {
    if (busy) return;
    setBusy(true);
    try {
      apply(await api.rpc('setDefault', { id: t.id }));
      api.toast(`插件默认模板已设为「${t.name}」`);
    } catch (e) {
      api.toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: TemplateView) => {
    if (busy) return;
    setBusy(true);
    try {
      apply(await api.rpc('removeTemplate', { id: t.id }));
      setConfirmId('');
      api.toast(`已删除「${t.name}」`);
    } catch (e) {
      api.toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, delta: number) => {
    if (!data || busy) return;
    const ids = data.templates.map((t) => t.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    if (data.templates[index]?.builtin || data.templates[target]?.builtin) return;
    const next = [...ids];
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    setBusy(true);
    try {
      apply(await api.rpc('reorder', { ids: next }));
    } catch (e) {
      api.toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const templates = data?.templates || [];

  return (
    <div className="rp-page tpl-page">
      <div className="page-head">
        <div className="title-block">
          <h2><span className="plug-h2-ico">{api.renderIcon?.('template', 18)}</span>任务模板</h2>
          <p className="muted tpl-head-note">
            新建任务时的正文骨架。主题没有单独配置「新建页行为」时，插件默认模板是回落项；带 {'{{槽位}}'} 的模板会先进入参数填写页。
          </p>
        </div>
        <div className="acts">
          <button type="button" className="btn primary sm" disabled={busy} onClick={startNew}>
            新建模板
          </button>
        </div>
      </div>

      {editing ? (
        <div className="tpl-editor">
          <input
            className="tpl-name-input"
            value={editing.name}
            placeholder="模板名（如：缺陷修复 / 调研任务）"
            onChange={(e) => setEditing((cur) => (cur ? { ...cur, name: e.target.value } : cur))}
          />
          <textarea
            className="tpl-fill-input tpl-body-input"
            value={editing.body}
            onChange={(e) => setEditing((cur) => (cur ? { ...cur, body: e.target.value } : cur))}
          />
          <div className="tpl-editor-foot">
            <button type="button" className="btn ghost sm" disabled={busy} onClick={cancelEdit}>取消</button>
            <button type="button" className="btn primary sm" disabled={busy} onClick={() => void save()}>
              {editing.id ? '保存' : '创建'}
            </button>
          </div>
        </div>
      ) : null}

      {busy && !templates.length ? <div className="muted" style={{ padding: 8 }}>读取模板…</div> : null}

      <div className="tpl-mng-list">
        {templates.map((t, index) => (
          <div className="tpl-mng-row" key={t.id}>
            <span className="tpl-mng-grip" aria-hidden>⋮</span>
            <div className="tpl-mng-main">
              <div className="tpl-mng-line">
                <span className="tpl-mng-name">{t.name}</span>
                {t.default ? <span className="tpl-badge">插件默认</span> : null}
                {t.builtin ? <span className="tpl-badge soft">内置</span> : null}
                {t.slots.length ? <span className="tpl-badge soft">{t.slots.length} 个槽位</span> : null}
              </div>
              <div className="tpl-card-sum">{summaryOf(t.body) || '（空模板）'}</div>
            </div>
            <div className="tpl-mng-acts">
              {!t.builtin ? (
                <button type="button" className="iconbtn" title="编辑" disabled={busy} onClick={() => startEdit(t)}>
                  编辑
                </button>
              ) : null}
              {!t.default ? (
                <button type="button" className="iconbtn" title="设为插件默认（主题未配置时回落）" disabled={busy} onClick={() => void setDefault(t)}>
                  设默认
                </button>
              ) : null}
              <button type="button" className="iconbtn" title="上移" disabled={busy || t.builtin} onClick={() => void move(index, -1)}>
                ↑
              </button>
              <button type="button" className="iconbtn" title="下移" disabled={busy || t.builtin} onClick={() => void move(index, 1)}>
                ↓
              </button>
              {!t.builtin ? (
                confirmId === t.id ? (
                  <>
                    <button type="button" className="iconbtn" disabled={busy} onClick={() => void remove(t)}>确认删除</button>
                    <button type="button" className="iconbtn" disabled={busy} onClick={() => setConfirmId('')}>取消</button>
                  </>
                ) : (
                  <button type="button" className="iconbtn" disabled={busy} onClick={() => setConfirmId(t.id)}>删除</button>
                )
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function summaryOf(body: string): string {
  return String(body || '')
    .split('\n')
    .map((line) => line.trim().replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, ''))
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ');
}
