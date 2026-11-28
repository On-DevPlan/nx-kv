// 任务编辑页底部「目录要求」面板。
//
// 数据分两层：
//   · 条目（目录 / 文件 + 标题 + 要求正文）按仓库保存；
//   · 本主题启用哪些条目按 topicKey 保存（默认不启用）。
// 领取时插件自己把启用条目渲染成提示词，全局模板只取 {{prompt}}。
//
// 目录 / 文件不靠手输：表单里直接复用插件的 `/api/plugins/tree` 浏览仓库，
// 列表与树都带筛选，方便快速定位。
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  PluginClientApi,
  PluginContextView,
} from '@nx-kv/plugin-sdk/client';
import PathPicker from './PathPicker.js';
import PathSuggest from './PathSuggest.js';

interface Requirement {
  id: string;
  repoKey: string;
  dir: string;
  title: string;
  detail: string;
  position: number;
}

interface RequirementList {
  repoKey: string;
  repoName?: string;
  entries?: Requirement[];
}

interface FormState {
  id: string;
  dir: string;
  title: string;
  detail: string;
}

const EMPTY_FORM: FormState = { id: '', dir: '', title: '', detail: '' };

function msgOf(e: unknown): string {
  return String((e as Error)?.message || e);
}

function repoNameOf(context: PluginContextView | null, repoKey: string): string {
  if (!context || !repoKey) return repoKey;
  const hit = context.repos.find((r) => r.key === repoKey) || (context.repo?.key === repoKey ? context.repo : null);
  if (hit) return hit.name;
  if (context.topic.repoKey === repoKey && context.topic.repoName) return context.topic.repoName;
  return repoKey;
}

export default function RequirementsPanel({ api }: { api: PluginClientApi }) {
  const topicKey = String(api.ctx.topicKey || api.ctx.topic?.key || api.ctx.location?.dirKey || '');
  const initialRepo = String(api.ctx.repoKey || api.ctx.topic?.repoKey || '');
  // 宿主的任务行每次刷新都是新对象 → api 也会重建；这里始终取最新的 api，
  // 但初始化只在「主题 / 归属仓库」真正变化时触发——否则轮询刷新会把正在填的表单冲掉。
  const apiRef = useRef(api);
  apiRef.current = api;

  const [context, setContext] = useState<PluginContextView | null>(null);
  const [repoKey, setRepoKey] = useState(initialRepo);
  const [repoName, setRepoName] = useState(initialRepo);
  const [entries, setEntries] = useState<Requirement[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [managing, setManaging] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const shownEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) => [e.title, e.dir, e.detail].join(' ').toLowerCase().includes(needle));
  }, [entries, query]);

  const resetPicker = () => {
    setPickerOpen(false);
  };

  const loadRepo = async (repo: string, name: string) => {
    const [list, picked] = await Promise.all([
      apiRef.current.rpc('requirementsList', { repoKey: repo }) as Promise<RequirementList>,
      apiRef.current.rpc('topicRequirementsGet', { topicKey }) as Promise<{ ids?: string[] }>,
    ]);
    const rows = Array.isArray(list?.entries) ? list.entries : [];
    const ids = new Set(
      (Array.isArray(picked?.ids) ? picked.ids : []).filter((id) => rows.some((row) => row.id === id)),
    );
    setRepoKey(repo);
    setRepoName(name || String(list?.repoName || '') || repo);
    setEntries(rows);
    setSelected(ids);
    setQuery('');
    setManaging(false);
    setFormOpen(false);
    setForm(EMPTY_FORM);
    resetPicker();
  };

  const init = async () => {
    setLoading(true);
    setError('');
    try {
      const [c, settings] = await Promise.all([
        apiRef.current.host.get<PluginContextView>('/api/plugins/context', {
          topicKey,
          groupKey: apiRef.current.ctx.groupKey || '',
          repoKey: initialRepo,
          cwd: apiRef.current.ctx.cwd || '',
        }),
        apiRef.current.rpc('getSettings').catch(() => null) as Promise<{ showHidden?: boolean } | null>,
      ]);
      setContext(c);
      setShowHidden(!!settings?.showHidden);
      let next = initialRepo || c.topic.repoKey || c.repo?.key || '';
      if (!next && c.topic.kind === 'group' && c.repos.length === 1) next = c.repos[0]?.key || '';
      if (!next) {
        setRepoKey('');
        setRepoName('');
        setEntries([]);
        setSelected(new Set());
        return;
      }
      await loadRepo(next, repoNameOf(c, next));
    } catch (e) {
      setError(msgOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void init();
    // 只在主题 / 归属仓库变化时重新初始化（组任务切换真实 repo 会同时变）。
    // api 的 identity 会随任务行刷新变化，不能进依赖——否则每次轮询都会重置表单。
  }, [topicKey, initialRepo]);

  const switchRepo = async (repo: string) => {
    if (!repo) return;
    setBusy(true);
    setError('');
    try {
      await loadRepo(repo, repoNameOf(context, repo));
    } catch (e) {
      setError(msgOf(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePicker = () => {
    setPickerOpen((cur) => !cur);
  };

  const pickPath = (path: string, fallbackTitle = '') => {
    const value = path || '.';
    setForm((cur) => ({
      ...cur,
      dir: value,
      title: cur.title.trim() ? cur.title : fallbackTitle,
    }));
    resetPicker();
  };

  // 单个条目的启用 / 停用：点击即写本主题的启用列表，不做多选 + 批量保存。
  const toggleEnable = async (id: string) => {
    if (!topicKey) {
      api.toast('当前任务没有主题定位，无法保存');
      return;
    }
    if (busy) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setBusy(true);
    setBusyId(id);
    try {
      const r = (await api.rpc('topicRequirementsSave', {
        topicKey,
        ids: [...next],
      })) as { ids?: string[] };
      setSelected(new Set(Array.isArray(r?.ids) ? r.ids : [...next]));
    } catch (e) {
      api.toast(msgOf(e));
    } finally {
      setBusy(false);
      setBusyId('');
    }
  };

  const startAdd = () => {
    setManaging(true);
    setForm(EMPTY_FORM);
    setFormOpen(true);
    resetPicker();
  };

  const startEdit = (entry: Requirement) => {
    setManaging(true);
    setForm({ id: entry.id, dir: entry.dir, title: entry.title, detail: entry.detail });
    setFormOpen(true);
    resetPicker();
  };

  const closeForm = () => {
    setFormOpen(false);
    setForm(EMPTY_FORM);
    resetPicker();
  };

  const saveEntry = async () => {
    if (!repoKey) return;
    if (busy) return;
    const dir = form.dir.trim();
    const title = form.title.trim();
    const detail = form.detail.trim();
    if (!dir || !title || !detail) {
      api.toast('路径、标题、要求正文都要填');
      return;
    }
    setBusy(true);
    try {
      const r = (await api.rpc('requirementsSave', {
        repoKey,
        id: form.id || undefined,
        dir,
        title,
        detail,
      })) as { entries?: Requirement[] };
      setEntries(Array.isArray(r?.entries) ? r.entries : []);
      api.toast(form.id ? '目录要求已更新' : '目录要求已添加');
      closeForm();
    } catch (e) {
      api.toast(msgOf(e));
    } finally {
      setBusy(false);
    }
  };

  const removeEntry = async (id: string) => {
    if (!repoKey || busy) return;
    if (!window.confirm('删除这条目录要求？已启用它的主题会失去该条（其他条目不受影响）。')) return;
    setBusy(true);
    try {
      const r = (await api.rpc('requirementsRemove', { repoKey, id })) as { entries?: Requirement[] };
      setEntries(Array.isArray(r?.entries) ? r.entries : []);
      setSelected((cur) => {
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
      api.toast('目录要求已删除');
    } catch (e) {
      api.toast(msgOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="daq-empty">读取目录要求…</div>;
  if (error) {
    return (
      <div className="daq-empty">
        读取失败：{error}
        <button type="button" className="btn ghost sm" onClick={() => void init()}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="daq-panel">
      <div className="daq-head">
        <b>目录要求{repoName ? ` · ${repoName}` : ''}</b>
        <span className="daq-count">
          本主题已启用 {selected.size} / {entries.length}
        </span>
        <span className="daq-spacer" />
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void init()}>
          刷新
        </button>
      </div>

      <div className="daq-hint">
        启用列表按主题保存（同一主题下的任务共享）；条目本身按仓库保存。默认不启用，点每行右侧「启用」即时保存到本主题。
      </div>

      {!repoKey ? (
        context?.topic.kind === 'group' && context.repos.length > 0 ? (
          <div className="daq-pick">
            <span>选择仓库：</span>
            <select value="" disabled={busy} onChange={(e) => void switchRepo(e.target.value)}>
              <option value="">请选择</option>
              {context.repos.map((repo) => (
                <option key={repo.key} value={repo.key}>
                  {repo.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="daq-empty">当前主题没有关联仓库，先在仓库页或组页选定仓库。</div>
        )
      ) : (
        <>
          {entries.length > 0 ? (
            <div className="daq-filter">
              <input
                className="daq-input"
                value={query}
                placeholder="筛选条目：标题 / 路径 / 要求…"
                onChange={(e) => setQuery(e.target.value)}
              />
              {query ? (
                <button type="button" className="btn ghost xs" onClick={() => setQuery('')}>
                  清除
                </button>
              ) : null}
            </div>
          ) : null}

          <div className={`daq-list${entries.length === 0 ? ' is-empty' : ''}`}>
            {entries.length === 0 ? (
              <div className="daq-empty">
                这个仓库还没有目录要求条目。点「管理条目」新增，例如「docs 目录的文档必须随代码更新」。
                <button type="button" className="btn ghost sm" onClick={startAdd}>
                  新增第一条
                </button>
              </div>
            ) : shownEntries.length === 0 ? (
              <div className="daq-empty">没有匹配「{query}」的条目。</div>
            ) : (
              shownEntries.map((entry) => {
                const enabled = selected.has(entry.id);
                return (
                  <div className="daq-row" key={entry.id}>
                    <div className="daq-main">
                      <span className="daq-title">{entry.title}</span>
                      <span className="daq-dir">{entry.dir}</span>
                      <span className="daq-detail">{entry.detail}</span>
                    </div>
                    <span className="daq-side">
                      <span className={`daq-state${enabled ? ' on' : ''}`}>
                        {enabled ? '已启用' : '未启用'}
                      </span>
                      <span className="daq-row-acts">
                        <button
                          type="button"
                          className={`btn ${enabled ? 'ghost' : 'primary'} xs`}
                          disabled={busy || !topicKey}
                          onClick={() => void toggleEnable(entry.id)}
                        >
                          {busyId === entry.id ? '保存中…' : enabled ? '停用' : '启用'}
                        </button>
                        {managing ? (
                          <>
                            <button type="button" className="btn ghost xs" onClick={() => startEdit(entry)}>
                              编辑
                            </button>
                            <button type="button" className="btn ghost xs" onClick={() => void removeEntry(entry.id)}>
                              删除
                            </button>
                          </>
                        ) : null}
                      </span>
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="daq-manage">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setManaging((cur) => !cur);
                closeForm();
              }}
            >
              {managing ? '收起管理' : '管理条目'}
            </button>
            {managing ? (
              <>
                <button type="button" className="btn ghost sm" onClick={startAdd}>
                  新增条目
                </button>
                <span className="daq-hint">条目属于仓库，同一仓库的所有主题共用。</span>
              </>
            ) : null}
          </div>

          {formOpen ? (
            <form
              className="daq-form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveEntry();
              }}
            >
              <div className="daq-form-row">
                <PathSuggest
                  api={api}
                  repoKey={repoKey}
                  showHidden={showHidden}
                  value={form.dir}
                  disabled={busy}
                  hidden={pickerOpen}
                  onChange={(next) => setForm((cur) => ({ ...cur, dir: next }))}
                  onPick={pickPath}
                  onBrowse={togglePicker}
                />
                <button type="button" className="btn ghost sm" disabled={busy} onClick={togglePicker}>
                  {pickerOpen ? '收起浏览' : '完整浏览…'}
                </button>
              </div>
              <input
                className="daq-input"
                value={form.title}
                maxLength={80}
                placeholder="标题（如：docs 文档必须随代码更新）"
                onChange={(e) => setForm((cur) => ({ ...cur, title: e.target.value }))}
              />
              <textarea
                className="daq-textarea"
                rows={3}
                value={form.detail}
                maxLength={4000}
                placeholder="要求正文：完成本任务后要检查 / 更新什么，交付前达到什么状态…"
                onChange={(e) => setForm((cur) => ({ ...cur, detail: e.target.value }))}
              />

              {pickerOpen ? (
                <PathPicker
                  api={api}
                  repoKey={repoKey}
                  repoName={repoName}
                  showHidden={showHidden}
                  onToggleHidden={setShowHidden}
                  onPick={pickPath}
                  onClose={resetPicker}
                />
              ) : null}

              <div className="daq-form-acts">
                <button type="button" className="btn ghost sm" onClick={closeForm} disabled={busy}>
                  取消
                </button>
                <button type="submit" className="btn primary sm" disabled={busy}>
                  {form.id ? '保存修改' : '添加条目'}
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}
