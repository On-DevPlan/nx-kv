// 目录要求表单的路径输入：一边输入一边在下方弹出「小看板」，直接点选目录 / 文件。
//
// 复用插件的 `/api/plugins/tree`：按输入里的父目录取一层子项，用最后一段做包含筛选。
// 完整的树浏览仍走 PathPicker（「完整浏览」按钮）。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginClientApi, PluginTreeEntry, PluginTreeView } from '@nx-kv/plugin-sdk/client';

interface Props {
  api: PluginClientApi;
  repoKey: string;
  showHidden: boolean;
  value: string;
  disabled?: boolean;
  /** 完整文件树打开时先收起小看板，避免两层浮层重叠。 */
  hidden?: boolean;
  onChange: (next: string) => void;
  onPick: (path: string, title?: string) => void;
  onBrowse: () => void;
}

function msgOf(e: unknown): string {
  return String((e as Error)?.message || e);
}

function isAbsolutePath(value: string): boolean {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(value.trim());
}

/** 输入拆成「父目录 + 当前段」：`src/co` → dir=src, needle=co。 */
function splitPath(value: string): { dir: string; needle: string } {
  const text = String(value || '').replace(/\\/g, '/').trim();
  const at = text.lastIndexOf('/');
  if (at < 0) return { dir: '', needle: text };
  return { dir: text.slice(0, at), needle: text.slice(at + 1) };
}

export default function PathSuggest({
  api,
  repoKey,
  showHidden,
  value,
  disabled = false,
  hidden = false,
  onChange,
  onPick,
  onBrowse,
}: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<PluginTreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cache = useRef(new Map<string, PluginTreeView>());

  const parsed = useMemo(() => splitPath(value), [value]);
  const absolute = isAbsolutePath(value);

  useEffect(() => {
    if (!open || !repoKey || disabled || hidden || absolute) {
      setEntries([]);
      setLoading(false);
      setError('');
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      const key = `${showHidden ? '1' : '0'}:${parsed.dir}`;
      const cached = cache.current.get(key);
      const request = cached
        ? Promise.resolve(cached)
        : api.host.get<PluginTreeView>('/api/plugins/tree', {
            repoKey,
            path: parsed.dir,
            showHidden,
          });
      request
        .then((tree) => {
          cache.current.set(key, tree);
          if (!alive) return;
          const needle = parsed.needle.toLowerCase();
          setEntries(
            (tree.entries || [])
              .filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
              .slice(0, 12),
          );
        })
        .catch((e) => {
          if (alive) setError(msgOf(e));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 140);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, value, showHidden, repoKey, disabled, hidden, absolute, parsed.dir, parsed.needle, api]);

  const showPanel = open && !hidden && !disabled && !absolute;

  return (
    <div className="daq-path-field">
      <input
        className="daq-input"
        value={value}
        maxLength={500}
        disabled={disabled}
        placeholder="目录或文件（输入即筛选，如 docs、src/index.ts）"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
      />
      {showPanel ? (
        <div className="daq-suggest" onMouseDown={(e) => e.preventDefault()}>
          <div className="daq-suggest-head">
            <span className="daq-suggest-dir">{parsed.dir ? `${parsed.dir}/` : '仓库根'}</span>
            <span className="daq-suggest-count">{loading ? '读取…' : `${entries.length} 项`}</span>
            <span className="daq-spacer" />
            <button
              type="button"
              className="btn ghost xs"
              onClick={() => {
                setOpen(false);
                onBrowse();
              }}
            >
              完整浏览
            </button>
          </div>
          {error ? <div className="daq-suggest-empty">读取失败：{error}</div> : null}
          {!error
            ? entries.map((entry) => (
                <button
                  type="button"
                  className="daq-suggest-row"
                  key={entry.path}
                  onClick={() => {
                    onPick(entry.path, entry.name);
                    setOpen(false);
                  }}
                >
                  <span className={`da-kind ${entry.type}`}>{entry.type === 'dir' ? '目录' : '文件'}</span>
                  <span className="daq-suggest-name">{entry.name}</span>
                  <span className="daq-suggest-path">{entry.path}</span>
                </button>
              ))
            : null}
          {!loading && !error && entries.length === 0 ? (
            <div className="daq-suggest-empty">没有匹配项；可直接输入路径或点「完整浏览」。</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
