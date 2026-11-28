// 技能引用设置页（左下角侧栏条目）：配置额外技能目录。
//
// 仓库根 .claude/skills 始终生效；这里追加的目录可以是技能根 / .claude 目录 / 单个技能目录。
import { useEffect, useState } from 'react';
import type { PluginClientApi } from '@nx-kv/plugin-sdk/client';

interface Settings {
  extraDirs: string[];
}

const DEFAULTS: Settings = { extraDirs: [] };

function msgOf(e: unknown): string {
  return String((e as Error)?.message || e);
}

export default function SkillRefSettingsPage({ api }: { api: PluginClientApi }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [draftDir, setDraftDir] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const loaded = await api.rpc<Partial<Settings>>('getSettings');
      setSettings({
        extraDirs: Array.isArray(loaded?.extraDirs) ? loaded.extraDirs : [],
      });
    } catch (e) {
      setError(msgOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const addDir = () => {
    const dir = draftDir.trim();
    if (!dir) return;
    setSettings((cur) =>
      cur.extraDirs.includes(dir) ? cur : { extraDirs: [...cur.extraDirs, dir] },
    );
    setDraftDir('');
  };

  const removeDir = (dir: string) => {
    setSettings((cur) => ({ extraDirs: cur.extraDirs.filter((x) => x !== dir) }));
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.rpc<Partial<Settings>>('setSettings', settings);
      setSettings({
        extraDirs: Array.isArray(saved?.extraDirs) ? saved.extraDirs : settings.extraDirs,
      });
      api.toast('技能目录已保存');
    } catch (e) {
      api.toast(msgOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rp-page skr-page skr-settings">
      <div className="page-head">
        <div className="title-block">
          <h2><span className="plug-h2-ico">{api.renderIcon?.('star', 18)}</span>技能引用设置</h2>
          <p className="muted skr-sub">
            仓库根的 <code>.claude/skills</code> 始终会被扫描；这里可以追加其他目录，让它们也进入技能候选。
          </p>
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
        <div className="skr-error">
          <span>读取失败：{error}</span>
          <button type="button" className="btn ghost sm" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          <div className="skr-section">
            <div className="skr-section-head">
              <b>额外技能目录（{settings.extraDirs.length}）</b>
              <span className="muted">绝对路径；目录 / .claude 目录 / 单个技能目录都识别</span>
            </div>
            <div className="skr-dir-list">
              {settings.extraDirs.length === 0 ? (
                <div className="skr-empty">还没有额外目录。仓库根的 .claude/skills 仍在扫描。</div>
              ) : (
                settings.extraDirs.map((dir) => (
                  <div className="skr-dir-row" key={dir}>
                    <code className="skr-dir-path mono">{dir}</code>
                    <button type="button" className="btn ghost sm" onClick={() => removeDir(dir)}>
                      移除
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="skr-dir-add">
              <input
                className="skr-dir-input"
                value={draftDir}
                placeholder="例如 D:\my-skills 或 D:\other-repo\.claude"
                onChange={(e) => setDraftDir(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addDir();
                  }
                }}
              />
              <button type="button" className="btn ghost sm" disabled={!draftDir.trim()} onClick={addDir}>
                添加
              </button>
            </div>
          </div>

          <div className="skr-section">
            <div className="skr-section-head">
              <b>扫描规则</b>
            </div>
            <ul className="skr-rules">
              <li>
                仓库任务：读取任务所属仓库根的 <code>.claude/skills</code>；组任务按任务落库的仓库解析，任务在哪个
                repo 执行就加载哪个。
              </li>
              <li>
                每个技能目录需包含 <code>SKILL.md</code>；名称与说明默认读 frontmatter 的{' '}
                <code>name</code> / <code>description</code>。
              </li>
              <li>选中的技能按任务号绑定；领取任务时会渲染成插件提示词区块，要求 agent 强制加载。</li>
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
