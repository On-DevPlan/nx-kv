// 目录要求表单里的路径选择器：复用插件的 `/api/plugins/tree`，列表 + 当前目录筛选。
import { useEffect, useMemo, useState } from 'react';
import type { PluginClientApi, PluginTreeView } from '@nx-kv/plugin-sdk/client';

interface Props {
  api: PluginClientApi;
  repoKey: string;
  repoName: string;
  showHidden: boolean;
  onToggleHidden: (next: boolean) => void;
  /** path 为空 = 仓库根；title 是给「标题还没填」时的兜底。 */
  onPick: (path: string, title?: string) => void;
  onClose: () => void;
}

function msgOf(e: unknown): string {
  return String((e as Error)?.message || e);
}

function baseName(path: string): string {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts[parts.length - 1] || String(path || '');
}

export default function PathPicker({ api, repoKey, repoName, showHidden, onToggleHidden, onPick, onClose }: Props) {
  const [tree, setTree] = useState<PluginTreeView | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (path: string, hidden = showHidden) => {
    setLoading(true);
    setError('');
    try {
      const next = await api.host.get<PluginTreeView>('/api/plugins/tree', {
        repoKey,
        path,
        showHidden: hidden,
      });
      setTree(next);
    } catch (e) {
      setError(msgOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load('');
    // 选择器每次打开都从仓库根开始；路径 / 显示隐藏项在组件内自行维护。
    // eslint 规则未启用 exhaustive-deps，这里显式只跑一次。
  }, []);

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = tree?.entries || [];
    if (!needle) return rows;
    return rows.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [tree, query]);

  const segments = useMemo(() => String(tree?.path || '').split('/').filter(Boolean), [tree]);

  return (
    <div className="daq-picker">
      <div className="daq-picker-head">
        <b>选择目录 / 文件</b>
        <input
          className="daq-input daq-tree-filter"
          value={query}
          placeholder="筛选当前目录…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
        />
        <label className="daq-check">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => {
              const next = e.target.checked;
              onToggleHidden(next);
              void load(tree?.path || '', next);
            }}
          />
          隐藏项
        </label>
        <button type="button" className="btn ghost xs" onClick={onClose}>
          关闭
        </button>
      </div>

      <div className="daq-crumb">
        <button type="button" className="daq-crumb-item" onClick={() => void load('')}>
          {repoName || '仓库根'}
        </button>
        {segments.map((seg, i) => (
          <span key={`${seg}-${i}`}>
            <span className="daq-crumb-sep">/</span>
            <button
              type="button"
              className="daq-crumb-item"
              onClick={() => void load(segments.slice(0, i + 1).join('/'))}
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {loading ? <div className="daq-empty">读取目录…</div> : null}
      {error ? (
        <div className="daq-empty">
          读取失败：{error}
          <button type="button" className="btn ghost xs" onClick={() => void load(tree?.path || '')}>
            重试
          </button>
        </div>
      ) : null}
      {!loading && !error && tree ? (
        <div className="daq-tree-list">
          {entries.map((entry) => (
            <div className="daq-tree-row" key={entry.path}>
              <button
                type="button"
                className="daq-tree-name"
                onClick={() =>
                  entry.type === 'dir'
                    ? void load(entry.path)
                    : onPick(entry.path, baseName(entry.path))
                }
              >
                <span className={`da-kind ${entry.type}`}>{entry.type === 'dir' ? '目录' : '文件'}</span>
                <span className="daq-tree-text">{entry.name}</span>
              </button>
              <button
                type="button"
                className="btn ghost xs"
                onClick={() => onPick(entry.path, baseName(entry.path))}
              >
                选用
              </button>
            </div>
          ))}
          {entries.length === 0 ? (
            <div className="daq-empty">{query ? `没有匹配「${query}」的项。` : '空目录'}</div>
          ) : null}
          {tree.truncated ? <div className="daq-empty">目录项过多，已截断。</div> : null}
        </div>
      ) : null}

      <div className="daq-picker-acts">
        <button
          type="button"
          className="btn ghost xs"
          onClick={() => onPick(tree?.path || '', baseName(tree?.path || ''))}
        >
          选用当前目录
        </button>
        <span className="daq-hint">选中后仍可手动修改路径。</span>
      </div>
    </div>
  );
}
