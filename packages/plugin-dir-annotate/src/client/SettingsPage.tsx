// 目录批注设置页（左下角侧栏条目）：控制插件在新建页里的默认行为。
import { useEffect, useState } from 'react';
import type { PluginClientApi } from '@nx-kv/plugin-sdk/client';

interface Settings {
  showHidden: boolean;
  includeDir: boolean;
  titlePrefix: string;
}

const DEFAULTS: Settings = { showHidden: false, includeDir: true, titlePrefix: '' };

export default function SettingsPage({ api }: { api: PluginClientApi }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const loaded = await api.rpc<Partial<Settings>>('getSettings');
      setSettings({ ...DEFAULTS, ...(loaded || {}) });
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.rpc<Partial<Settings>>('setSettings', settings);
      setSettings({ ...DEFAULTS, ...(saved || {}) });
      api.toast('已保存目录批注设置');
    } catch (e) {
      api.toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="rp-page da-page da-settings">
      <div className="page-head">
        <div className="title-block">
          <h2>目录批注设置</h2>
          <p className="muted da-sub">这些是插件自己的默认行为，保存在插件表里，按本机生效。</p>
        </div>
        <div className="acts">
          <button type="button" className="btn ghost sm" disabled={busy || loading} onClick={() => void load()}>
            刷新
          </button>
          <button type="button" className="btn primary sm" disabled={busy || loading} onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>

      {loading ? <div className="muted" style={{ padding: 12 }}>读取设置…</div> : null}
      {error ? (
        <div className="da-error">
          <span>读取失败：{error}</span>
          <button type="button" className="btn ghost sm" onClick={() => void load()}>重试</button>
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="da-setting-list">
          <label className="da-setting-row">
            <input
              type="checkbox"
              checked={settings.showHidden}
              onChange={(e) => setSettings((cur) => ({ ...cur, showHidden: e.target.checked }))}
            />
            <span className="da-setting-main">
              <b>显示隐藏文件</b>
              <span className="muted">目录树里显示以 . 开头的文件和目录（如 .env、.github）。</span>
            </span>
          </label>

          <label className="da-setting-row">
            <input
              type="checkbox"
              checked={settings.includeDir}
              onChange={(e) => setSettings((cur) => ({ ...cur, includeDir: e.target.checked }))}
            />
            <span className="da-setting-main">
              <b>带入当前目录</b>
              <span className="muted">生成任务时在正文里写「当前目录」，方便接手的人先定位。</span>
            </span>
          </label>

          <div className="da-setting-row da-setting-col">
            <b>任务标题前缀</b>
            <input
              type="text"
              className="da-setting-input"
              maxLength={40}
              placeholder="可空，如【批注】"
              value={settings.titlePrefix}
              onChange={(e) => setSettings((cur) => ({ ...cur, titlePrefix: e.target.value }))}
            />
            <span className="muted">生成的任务标题形如「前缀 + 目录批注 · 仓库名」。</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
