// 新建页行为：宿主通用面板（不是插件 UI）。
// 两件事分开呈现：①「＋ 新建页」点击后执行哪一项（单选）；② 下拉里显示哪些入口（多选）。
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/toast/index.jsx';
import { Button } from '../components/button/index.jsx';
import { Icon } from '../components/icons.jsx';
import { api } from '../api/client.js';
import { usePretaskEntries } from '../modules/pretask/use-pretask.js';
import type { PretaskEntry } from '../modules/pretask/types.js';
import './style.css';

interface VisibilityConfig {
  scopeKey?: string;
  topic?: string;
  group?: string;
  repo?: string;
  label?: string;
}

interface Row {
  entryId: string;
  label: string;
  pluginName: string;
  kind: 'draft' | 'panel';
  visible: boolean;
}

interface VisibilityPayload {
  scopeKey: string;
  entries: { entryId: string; visible: boolean; sortOrder: number; isDefault?: boolean }[];
  defaultEntryId?: string;
}

export default function PluginVisibilityPanel({ config }: { config?: VisibilityConfig }) {
  const toast = useToast();
  const scopeKey = String(config?.scopeKey || '');
  const scope = {
    topic: config?.topic || '',
    group: config?.group || '',
    repo: config?.repo || '',
  };
  const entriesState = usePretaskEntries(scope, { all: true });
  const [rows, setRows] = useState<Row[]>([]);
  // '' = 不指定，按插件声明的默认入口回落
  const [defaultEntryId, setDefaultEntryId] = useState('');
  const [busy, setBusy] = useState(false);

  const entrySig = useMemo(
    () => entriesState.entries.map((e: PretaskEntry) => `${e.id}:${e.visible !== false}`).join('|'),
    [entriesState.entries],
  );

  useEffect(() => {
    if (!scopeKey) return;
    let alive = true;
    api<VisibilityPayload>(`/api/plugins/visibility?scopeKey=${encodeURIComponent(scopeKey)}`)
      .then((payload) => {
        if (!alive) return;
        const saved = new Map((payload.entries || []).map((r) => [r.entryId, r]));
        const next = entriesState.entries.map((e) => {
          const row = saved.get(e.id);
          return {
            entryId: e.id,
            label: e.label,
            pluginName: e.pluginName || e.pluginId,
            kind: e.kind,
            visible: row ? row.visible : e.visible !== false,
          };
        });
        const order = new Map((payload.entries || []).map((r) => [r.entryId, r.sortOrder]));
        next.sort((a, b) => (order.get(a.entryId) ?? 9999) - (order.get(b.entryId) ?? 9999));
        setRows(next);
        setDefaultEntryId(String(payload.defaultEntryId || ''));
      })
      .catch((e) => alive && toast(String((e as Error).message || e)));
    return () => {
      alive = false;
    };
  }, [scopeKey, entrySig, toast]);

  const move = (index: number, delta: number) => {
    setRows((cur) => {
      const next = [...cur];
      const target = index + delta;
      if (target < 0 || target >= next.length) return cur;
      const tmp = next[index]!;
      next[index] = next[target]!;
      next[target] = tmp;
      return next;
    });
  };

  const toggleVisible = (entryId: string, visible: boolean) => {
    setRows((cur) => cur.map((r) => (r.entryId === entryId ? { ...r, visible } : r)));
    // 默认项被隐藏 → 回到「不指定」，避免保存一个不会触发的默认
    if (!visible && defaultEntryId === entryId) setDefaultEntryId('');
  };

  const save = async () => {
    if (!scopeKey) return;
    setBusy(true);
    try {
      await api('/api/plugins/visibility', {
        method: 'PATCH',
        body: {
          scopeKey,
          entries: rows.map((r, index) => ({ entryId: r.entryId, visible: r.visible, sortOrder: index })),
        },
      });
      await api('/api/plugins/default', {
        method: 'POST',
        body: { scopeKey, entryId: defaultEntryId },
      });
      await entriesState.refetch();
      toast('已保存新建页行为');
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  if (!scopeKey) {
    return <div className="muted" style={{ padding: 20 }}>缺少 scopeKey，无法配置新建页行为。</div>;
  }

  return (
    <div className="rp-page plugin-vis-page">
      <div className="page-head">
        <div className="title-block">
          <h2><Icon name="list" size={16} /> 新建页行为 · {config?.label || scopeKey}</h2>
          <p className="muted">
            决定主按钮「＋ 新建页」直接做什么，以及下拉菜单里能选哪些插件入口。
          </p>
        </div>
        <div className="acts">
          <Button variant="secondary" small disabled={busy} onClick={() => void entriesState.refetch()}>
            刷新
          </Button>
          <Button variant="primary" small disabled={busy || !rows.length} onClick={() => void save()}>
            保存
          </Button>
        </div>
      </div>

      {entriesState.unsupported ? (
        <div className="muted" style={{ padding: 16 }}>当前服务比面板旧——重启 serve 后才有插件入口。</div>
      ) : null}
      {entriesState.error && !entriesState.unsupported ? (
        <div className="muted" style={{ padding: 16 }}>读取入口失败：{entriesState.error}</div>
      ) : null}
      {!rows.length && !entriesState.loading ? (
        <div className="muted" style={{ padding: 16 }}>没有可用入口（先在设置 → 插件里启用插件）。</div>
      ) : null}

      {rows.length ? (
        <>
          <section className="plugin-vis-section">
            <div className="plugin-vis-sec-head">
              <b>点「＋ 新建页」时执行</b>
              <span className="muted">单选。草稿入口会直接生成正文并打开编辑页；面板入口会直接打开插件页。</span>
            </div>
            <div className="plugin-vis-list" role="radiogroup" aria-label="新建页默认入口">
              <label className="plugin-vis-row">
                <span className="plugin-vis-check">
                  <input
                    type="radio"
                    name="plugin-vis-default"
                    checked={!defaultEntryId}
                    onChange={() => setDefaultEntryId('')}
                  />
                  <span className="plugin-vis-name">不指定（空白任务页）</span>
                  <span className="plugin-vis-plugin">点「＋ 新建页」直接创建空白任务页并进入编辑</span>
                </span>
              </label>
              {rows.map((row) => (
                <label className="plugin-vis-row" key={`default:${row.entryId}`}>
                  <span className="plugin-vis-check">
                    <input
                      type="radio"
                      name="plugin-vis-default"
                      checked={defaultEntryId === row.entryId}
                      disabled={!row.visible}
                      onChange={() => setDefaultEntryId(row.entryId)}
                    />
                    <span className="plugin-vis-name">{row.label}</span>
                    <span className="plugin-vis-kind">{row.kind === 'panel' ? '面板' : '草稿'}</span>
                    <span className="plugin-vis-plugin">{row.pluginName}</span>
                    {!row.visible ? <span className="plugin-vis-off">已在下方隐藏，不会生效</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </section>

          <details className="plugin-vis-section plugin-vis-advanced">
            <summary className="plugin-vis-sec-head">
              <b>高级：下拉菜单里显示哪些入口</b>
              <span className="muted">一般不点开也不影响「＋ 新建页」；勾选 = 出现在「新建页 ▾」里，取消只影响本主题。</span>
            </summary>
            <div className="plugin-vis-list">
              {rows.map((row, index) => (
                <div className="plugin-vis-row" key={`show:${row.entryId}`}>
                  <label className="plugin-vis-check">
                    <input
                      type="checkbox"
                      checked={row.visible}
                      onChange={(e) => toggleVisible(row.entryId, e.target.checked)}
                    />
                    <span className="plugin-vis-name">{row.label}</span>
                    <span className="plugin-vis-kind">{row.kind === 'panel' ? '面板' : '草稿'}</span>
                    <span className="plugin-vis-plugin">{row.pluginName}</span>
                    <span className="plugin-vis-id">{row.entryId}</span>
                  </label>
                  <span className="plugin-vis-move">
                    <button type="button" className="iconbtn" title="上移" disabled={index === 0} onClick={() => move(index, -1)}>
                      <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
                        <Icon name="chevron-down" size={14} />
                      </span>
                    </button>
                    <button type="button" className="iconbtn" title="下移" disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                      <Icon name="chevron-down" size={14} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
