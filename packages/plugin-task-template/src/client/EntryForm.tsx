// 槽位填写中间页（插件自带 UI）：填完调 pretask.draft，再交给宿主创建真实任务。
import { useState } from 'react';
import type { PluginClientApi } from '@nx-kv/plugin-sdk/client';

export default function EntryForm({ api }: { api: PluginClientApi }) {
  const entry = api.entry;
  const slots = entry?.slots || [];
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const slot of slots) out[slot.key] = String(entry?.values?.[slot.key] ?? slot.default ?? '');
    return out;
  });
  const [busy, setBusy] = useState(false);

  if (!entry) {
    return (
      <div className="rp-page tpl-fill-page">
        <div className="muted" style={{ padding: 20 }}>参数会话已失效——请从「新建任务」下拉重新选择模板。</div>
      </div>
    );
  }

  const submit = async (direct = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const draft = await api.draft(entry.id, values);
      // 中间页完成默认进入等待态；「进入编辑页」显式保留草稿态，保存时再转待领取。
      await api.createDraft(draft, { submit: direct, status: direct ? 'pending' : 'plan' });
    } catch (e) {
      api.toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rp-page tpl-fill-page">
      <div className="page-head">
        <div className="title-block">
          <h2><span className="plug-h2-ico">{api.renderIcon?.('template', 18)}</span>填写模板参数</h2>
          <p className="muted tpl-head-note">
            「{entry.label}」· 全部可选，留空即为空白。生成的是纯文本任务，编辑页不会再出现槽位框。
          </p>
        </div>
        <div className="acts">
          <button type="button" className="btn ghost sm" onClick={() => api.closePage()}>
            返回
          </button>
        </div>
      </div>

      <div className="tpl-fill-body">
        {slots.length === 0 ? (
          <div className="muted tpl-fill-empty">这条模板没有参数槽位，可直接进入任务编辑。</div>
        ) : (
          slots.map((slot) => (
            <label key={slot.key} className="tpl-fill-field">
              <span className="tpl-fill-label">{slot.label || slot.key}</span>
              <textarea
                className="tpl-fill-input"
                value={values[slot.key] ?? ''}
                placeholder={slot.hint || `填写「${slot.label || slot.key}」（可留空）`}
                onChange={(e) => setValues((cur) => ({ ...cur, [slot.key]: e.target.value }))}
                rows={4}
              />
            </label>
          ))
        )}
      </div>

      <div className="tpl-fill-foot">
        <button type="button" className="btn ghost sm" onClick={() => api.closePage()}>
          返回
        </button>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void submit(false)}>
          进入编辑页（草稿）
        </button>
        <button type="button" className="btn primary sm" disabled={busy} onClick={() => void submit(true)}>
          直接提交
        </button>
      </div>
    </div>
  );
}
