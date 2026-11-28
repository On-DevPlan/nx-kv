// 目录批注页：repo topic 直接进目录；group topic 先选仓库；选文件加批注，最后生成任务草稿。
import { useEffect, useState } from 'react';
import type {
  PluginClientApi,
  PluginContextView,
  PluginFileView,
  PluginRepoView,
  PluginTreeEntry,
  PluginTreeView,
} from '@nx-kv/plugin-sdk/client';

interface Annotation {
  path: string;
  note: string;
}

interface Settings {
  showHidden: boolean;
  includeDir: boolean;
  titlePrefix: string;
}

const DEFAULT_SETTINGS: Settings = { showHidden: false, includeDir: true, titlePrefix: '' };

export default function AnnotatePage({ api }: { api: PluginClientApi }) {
  const [context, setContext] = useState<PluginContextView | null>(null);
  const [repo, setRepo] = useState<PluginRepoView | null>(null);
  const [tree, setTree] = useState<PluginTreeView | null>(null);
  const [file, setFile] = useState<PluginFileView | null>(null);
  const [note, setNote] = useState('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadContext = async () => {
    setLoading(true);
    setError('');
    let showHidden = settings.showHidden;
    try {
      // 设置由左下角设置页维护；拿不到（老宿主）就用默认值继续。
      const saved = await api.rpc<Partial<Settings>>('getSettings').catch(() => null);
      if (saved) {
        const merged = { ...DEFAULT_SETTINGS, ...saved };
        setSettings(merged);
        showHidden = merged.showHidden;
      }
    } catch {
      /* ignore */
    }
    try {
      const c = await api.host.get<PluginContextView>('/api/plugins/context', {
        topicKey: api.ctx.topicKey || api.ctx.topic?.key || '',
        groupKey: api.ctx.groupKey || api.ctx.topic?.groupKey || '',
        repoKey: api.ctx.repoKey || api.ctx.topic?.repoKey || '',
        cwd: api.ctx.cwd || api.ctx.topic?.cwd || '',
      });
      setContext(c);
      setRepo(null);
      setTree(null);
      setFile(null);
      if (c.topic.kind !== 'group' && c.repo) await pickRepo(c.repo, showHidden);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  };

  const pickRepo = async (next: PluginRepoView, showHidden = settings.showHidden) => {
    setRepo(next);
    setFile(null);
    try {
      const t = await api.host.get<PluginTreeView>('/api/plugins/tree', {
        repoKey: next.key,
        path: '',
        showHidden,
      });
      setTree(t);
    } catch (e) {
      api.toast(String((e as Error).message || e));
    }
  };

  const loadTree = async (path: string) => {
    if (!repo) return;
    try {
      const t = await api.host.get<PluginTreeView>('/api/plugins/tree', {
        repoKey: repo.key,
        path,
        showHidden: settings.showHidden,
      });
      setTree(t);
    } catch (e) {
      api.toast(String((e as Error).message || e));
    }
  };

  const openFile = async (entry: PluginTreeEntry) => {
    if (!repo) return;
    try {
      const f = await api.host.get<PluginFileView>('/api/plugins/file', { repoKey: repo.key, path: entry.path });
      setFile(f);
    } catch (e) {
      api.toast(String((e as Error).message || e));
    }
  };

  const addNote = () => {
    if (!file) {
      api.toast('先从左侧选择一个文件');
      return;
    }
    const text = note.trim();
    if (!text) {
      api.toast('批注不能为空');
      return;
    }
    setAnnotations((cur) => [...cur, { path: file.path, note: text }]);
    setNote('');
  };

  const generate = () => {
    if (!context || !repo) return;
    if (!annotations.length) {
      api.toast('还没有批注');
      return;
    }
    const isGroup = context.topic.kind === 'group';
    const groupName = context.group?.name || context.topic.groupName || '';
    const lines = [
      '## 目录批注',
      '',
      `- 仓库：${repo.name}（${repo.key}）`,
      ...(isGroup ? [`- 组：${groupName || '-'}（${context.topic.groupKey}）`] : []),
      ...(isGroup ? [] : [`- 主题：${context.topic.name || '-'}（${context.topic.kind}）`]),
      ...(settings.includeDir && tree?.path ? [`- 当前目录：${tree.path}`] : []),
      '',
      '### 文件批注',
      '',
      ...annotations.map((a) => `- \`${a.path}\`\n  - ${a.note.replace(/\n/g, '\n    ')}`),
    ];
    const base = isGroup
      ? `目录批注 · ${groupName || repo.name} / ${repo.name}`
      : `目录批注 · ${context.topic.name || repo.name}`;
    const title = `${settings.titlePrefix || ''}${base}`;
    // 组主题下插件自选了仓库：草稿归属跟着所选仓库走（宿主缺省用组页当前成员）
    api.createDraft({ title, body: lines.join('\n') }, isGroup ? { project: repo.key } : undefined);
  };

  useEffect(() => {
    void loadContext();
  }, []);

  const segments = (tree?.path || '').split('/').filter(Boolean);

  return (
    <div className="rp-page da-page">
      <div className="page-head">
        <div className="title-block">
          <h2><span className="plug-h2-ico">{api.renderIcon?.('folder', 18)}</span>目录批注</h2>
          <p className="muted da-sub">
            {context?.topic?.name || '未定位主题'}
            {context?.topic?.kind === 'group' ? ' · 组' : context?.topic?.kind === 'repo' ? ' · 仓库' : ''}
            {repo ? ` · ${repo.name}` : ''}
          </p>
        </div>
        <div className="acts">
          <button type="button" className="btn ghost sm" onClick={() => void loadContext()}>
            刷新
          </button>
          <button type="button" className="btn primary sm" disabled={!annotations.length} onClick={generate}>
            生成任务（{annotations.length}）
          </button>
        </div>
      </div>

      {loading ? <div className="muted" style={{ padding: 12 }}>读取目录上下文…</div> : null}
      {error ? (
        <div className="da-error">
          <span>读取失败：{error}</span>
          <button type="button" className="btn ghost sm" onClick={() => void loadContext()}>重试</button>
        </div>
      ) : null}

      {!loading && !error && context && context.topic.kind === 'group' && !repo ? (
        <div className="da-repos">
          <div className="da-repos-title">选择一个仓库</div>
          {context.repos.map((r) => (
            <div className="da-repo-card" key={r.key}>
              <div className="da-repo-main">
                <div className="da-repo-name">{r.name}</div>
                <div className="da-repo-key">{r.key}</div>
                <div className="da-repo-desc">{r.description || '（无描述）'}</div>
              </div>
              <button type="button" className="btn primary sm" onClick={() => void pickRepo(r)}>
                选择
              </button>
            </div>
          ))}
          {!context.repos.length ? <div className="muted">这个组还没有成员仓库。</div> : null}
        </div>
      ) : null}

      {!loading && !error && repo ? (
        <div className="da-split">
          <div className="da-tree">
            <div className="da-tree-head">
              <b className="da-tree-repo">{repo.name}</b>
              <span className="da-tree-actions">
                {context?.topic.kind === 'group' ? (
                  <button type="button" className="btn ghost xs" onClick={() => { setRepo(null); setTree(null); setFile(null); }}>
                    切换仓库
                  </button>
                ) : null}
                <button type="button" className="btn ghost xs" disabled={!tree?.path} onClick={() => void loadTree(segments.slice(0, -1).join('/'))}>
                  上一级
                </button>
              </span>
            </div>
            <div className="da-crumb">
              <button type="button" className="da-crumb-item" onClick={() => void loadTree('')}>{repo.name}</button>
              {segments.map((seg, i) => (
                <span key={`${seg}-${i}`}>
                  <span className="da-crumb-sep">/</span>
                  <button type="button" className="da-crumb-item" onClick={() => void loadTree(segments.slice(0, i + 1).join('/'))}>
                    {seg}
                  </button>
                </span>
              ))}
            </div>
            <div className="da-tree-list">
              {tree?.entries.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  className={'da-tree-row' + (entry.type === 'file' && file?.path === entry.path ? ' active' : '')}
                  onClick={() => (entry.type === 'dir' ? void loadTree(entry.path) : void openFile(entry))}
                >
                  <span className={`da-kind ${entry.type}`}>{entry.type === 'dir' ? '目录' : '文件'}</span>
                  <span className="da-entry-name">{entry.name}</span>
                  {entry.type === 'file' && entry.size ? <span className="da-entry-size">{formatSize(entry.size)}</span> : null}
                </button>
              ))}
              {tree && !tree.entries.length ? <div className="muted" style={{ padding: 10 }}>空目录</div> : null}
              {tree?.truncated ? <div className="muted" style={{ padding: 10 }}>目录项过多，已截断到前 500 项。</div> : null}
            </div>
          </div>

          <div className="da-right">
            <div className="da-file">
              {file ? (
                <>
                  <div className="da-file-head">
                    <code>{file.path}</code>
                    <span className="muted">{formatSize(file.size)}{file.truncated ? ' · 已截断' : ''}</span>
                  </div>
                  {file.binary ? (
                    <div className="muted" style={{ padding: 12 }}>二进制文件，无法预览。</div>
                  ) : (
                    <pre className="da-pre">{file.content}</pre>
                  )}
                </>
              ) : (
                <div className="muted" style={{ padding: 12 }}>从左侧目录选择文件，再写批注。</div>
              )}
            </div>

            <div className="da-note-box">
              <textarea
                className="da-note"
                rows={3}
                value={note}
                placeholder={file ? `给 ${file.path} 写一条批注…` : '先选文件'}
                disabled={!file}
                onChange={(e) => setNote(e.target.value)}
              />
              <button type="button" className="btn primary sm" disabled={!file} onClick={addNote}>
                添加批注
              </button>
            </div>

            <div className="da-annotations">
              <div className="da-ann-title">已添加批注（{annotations.length}）</div>
              {annotations.map((a, i) => (
                <div className="da-ann-row" key={`${a.path}-${i}`}>
                  <div className="da-ann-main">
                    <code>{a.path}</code>
                    <p>{a.note}</p>
                  </div>
                  <button
                    type="button"
                    className="iconbtn"
                    onClick={() => setAnnotations((cur) => cur.filter((_, idx) => idx !== i))}
                  >
                    删除
                  </button>
                </div>
              ))}
              {!annotations.length ? <div className="muted">还没有批注。</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
