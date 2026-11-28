// 目录批注设置页（左下角侧栏条目）：控制插件在新建页里的默认行为。
import { useEffect, useState } from 'react';
import type { PluginClientApi } from '@nx-kv/plugin-sdk/client';

interface Settings {
  showHidden: boolean;
  includeDir: boolean;
  titlePrefix: string;
  promptHead: string;
  promptTail: string;
}

/** 与服务端 requirements.ts 的 DEFAULT_PROMPT_HEAD / TAIL 保持同文本。 */
const DEFAULT_PROMPT_HEAD = `〔目录要求 · {{repoName}}〕
本主题启用了 {{entryCount}} 条目录维护要求。完成本任务后，必须逐条检查并更新对应目录 / 文件中的内容与文档，确保交付时保持最新：`;
const DEFAULT_PROMPT_TAIL = `若某条要求本次确实不适用或无法完成，必须在完成总结里逐条说明原因，不得静默跳过。`;

const DEFAULTS: Settings = {
  showHidden: false,
  includeDir: true,
  titlePrefix: '',
  promptHead: DEFAULT_PROMPT_HEAD,
  promptTail: DEFAULT_PROMPT_TAIL,
};

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
          <h2><span className="plug-h2-ico">{api.renderIcon?.('folder', 18)}</span>目录批注设置</h2>
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

          <div className="da-setting-row da-setting-col">
            <b>目录要求 · 提示词开头</b>
            <textarea
              className="da-setting-area"
              rows={4}
              maxLength={4000}
              value={settings.promptHead}
              onChange={(e) => setSettings((cur) => ({ ...cur, promptHead: e.target.value }))}
            />
            <span className="muted">
              {'支持 {{repoName}} / {{entryCount}}；留空保存时回退出厂默认。'}
            </span>
            <button
              type="button"
              className="btn ghost xs"
              onClick={() => setSettings((cur) => ({ ...cur, promptHead: DEFAULT_PROMPT_HEAD }))}
            >
              恢复默认
            </button>
          </div>

          <div className="da-setting-row da-setting-col">
            <b>目录要求 · 提示词结尾</b>
            <textarea
              className="da-setting-area"
              rows={3}
              maxLength={4000}
              value={settings.promptTail}
              onChange={(e) => setSettings((cur) => ({ ...cur, promptTail: e.target.value }))}
            />
            <span className="muted">追加在条目列表之后；留空保存时回退出厂默认。</span>
            <button
              type="button"
              className="btn ghost xs"
              onClick={() => setSettings((cur) => ({ ...cur, promptTail: DEFAULT_PROMPT_TAIL }))}
            >
              恢复默认
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
