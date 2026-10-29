// 仓库布局的导入导出全屏面板。
//
// **为什么是全屏覆盖层而不是弹窗**：导出要逐条挑仓库/看板，导入要展示逐条差异
// （新增/有差异/一致/本地未拥有）并支持全选与逐条勾选——这些内容在 880px 的
// Modal 里会挤成一团。仓库页内覆盖层（不新开 tab）既保住「不新增导航层级」的原则，
// 又给了足够的版面。
//
// 与后端的关系：面板只做「选择 + 展示」，所有判定都在 service 侧
//   GET  /api/repos/export                → 布局 JSON（v3，key 身份、无本地路径）
//   POST /api/repos/import/diff           → 逐条差异（零副作用）
//   POST /api/repos/import                → 按策略执行
// CLI 侧有完全同构的 `repo export` / `repo import --diff` / `repo import`。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useGuard, useToast } from '../../web/frontend/components/ui.jsx';

const STATUS_META = {
  new: { label: '新增', cls: 'new' },
  changed: { label: '有差异', cls: 'changed' },
  same: { label: '一致', cls: 'same' },
};

export default function TransferPanel({ onClose, onChanged, repos, boards }) {
  const guard = useGuard();
  const toast = useToast();
  const [tab, setTab] = useState('import'); // import | export

  // ---- 导出：选择范围 ----
  const [expRepos, setExpRepos] = useState({});   // key -> bool
  const [expBoards, setExpBoards] = useState({}); // key -> bool
  const [expNoUnassigned, setExpNoUnassigned] = useState(false);
  const [expResult, setExpResult] = useState('');

  // ---- 导入：来源与差异 ----
  const [impText, setImpText] = useState('');
  const [diff, setDiff] = useState(null);
  const [sel, setSel] = useState({});            // key -> bool
  const [boardSel, setBoardSel] = useState({});  // boardKey -> bool
  const [strategy, setStrategy] = useState('ours');
  const [cloneMode, setCloneMode] = useState('none');
  const [filter, setFilter] = useState('');      // '' | new | changed | same
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const devOrRef = useMemo(() => repos || [], [repos]);

  // ---------- 导出 ----------
  const allRepoKeys = useMemo(() => devOrRef.map((r) => r.key), [devOrRef]);
  const allBoardKeys = useMemo(() => (boards || []).map((b) => b.name), [boards]);

  const toggleAllRepos = (on) => {
    const next = {};
    for (const k of allRepoKeys) next[k] = on;
    setExpRepos(next);
  };
  const toggleAllBoards = (on) => {
    const next = {};
    for (const k of allBoardKeys) next[k] = on;
    setExpBoards(next);
  };
  const invertRepos = () => {
    const next = {};
    for (const k of allRepoKeys) next[k] = !expRepos[k];
    setExpRepos(next);
  };

  const doExport = () => guard(async () => {
    const repoKeys = Object.keys(expRepos).filter((k) => expRepos[k]);
    const boardNames = Object.keys(expBoards).filter((k) => expBoards[k]);
    // 全部勾选 = 不传过滤（导出全部，含未分组）
    const body = {
      repos: repoKeys.length && repoKeys.length !== allRepoKeys.length ? repoKeys : undefined,
      boards: boardNames.length && boardNames.length !== allBoardKeys.length
        ? boardNames.map((n) => `board/${n}`)
        : undefined,
      noUnassigned: expNoUnassigned,
    };
    const qs = new URLSearchParams();
    if (body.repos?.length) qs.set('repos', body.repos.join(','));
    if (body.boards?.length) qs.set('boards', body.boards.join(','));
    if (expNoUnassigned) qs.set('no-unassigned', '1');
    const d = await api('/api/repos/export' + (qs.toString() ? '?' + qs : ''));
    setExpResult(JSON.stringify(d, null, 2));
    toast(`已生成布局：${d.repos.length} 个仓库 / ${d.boards.length} 个看板`);
  });

  const downloadJson = () => {
    if (!expResult) return;
    const blob = new Blob([expResult], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nx-kv-layout-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---------- 导入 ----------
  const loadFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImpText(await f.text());
    setDiff(null);
    setResult(null);
  };

  const doDiff = () => guard(async () => {
    if (!impText.trim()) return;
    setBusy(true);
    try {
      const d = await api('/api/repos/import/diff', { method: 'POST', body: { json: impText } });
      setDiff(d);
      // 默认全选「新增」与「有差异」，一致的不必再处理
      const rs = {};
      for (const r of d.repos) rs[r.key] = r.status !== 'same';
      setSel(rs);
      const bs = {};
      for (const b of d.boards) bs[b.key] = b.status !== 'same';
      setBoardSel(bs);
      setResult(null);
      toast(`差异：新增 ${d.summary.new} · 有差异 ${d.summary.changed} · 一致 ${d.summary.same} · 本地未拥有 ${d.summary.missing}`);
    } finally {
      setBusy(false);
    }
  });

  const doImport = () => guard(async () => {
    const selection = Object.keys(sel).filter((k) => sel[k]);
    const boardSelection = Object.keys(boardSel).filter((k) => boardSel[k]);
    setBusy(true);
    try {
      const d = await api('/api/repos/import', {
        method: 'POST',
        body: {
          json: impText,
          strategy,
          clone: cloneMode,
          selection: selection.length ? selection : undefined,
          boards: boardSelection.length ? boardSelection : undefined,
        },
      });
      setResult(d);
      toast(`导入完成：新建 ${d.created.length} · 覆盖 ${d.updated.length} · 另存 ${d.duplicated.length}`);
      await doDiffQuiet();
      if (onChanged) await onChanged();
    } finally {
      setBusy(false);
    }
  });

  // 执行后静默刷新差异（不弹 toast）
  const doDiffQuiet = useCallback(async () => {
    try {
      const d = await api('/api/repos/import/diff', { method: 'POST', body: { json: impText } });
      setDiff(d);
      const rs = {};
      for (const r of d.repos) rs[r.key] = r.status !== 'same';
      setSel(rs);
    } catch { /* 忽略 */ }
  }, [impText]);

  const visibleRepos = useMemo(() => {
    if (!diff) return [];
    if (!filter) return diff.repos;
    return diff.repos.filter((r) => r.status === filter);
  }, [diff, filter]);

  // 克隆补齐：按 remote 克隆并用**占位的 key** 登记 → 组里的位置自动转正
  const cloneNow = (key, remote) => guard(async () => {
    if (!remote) return;
    setBusy(true);
    try {
      await api('/api/repos/clone', {
        method: 'POST',
        body: { remote, key, type: 'ref', depth: 1 },
      });
      toast(`已克隆: ${key}`);
      await doDiffQuiet();
      if (onChanged) await onChanged();
    } finally {
      setBusy(false);
    }
  });

  const toggleAllDiff = (on) => {
    const next = { ...sel };
    for (const r of visibleRepos) next[r.key] = on;
    setSel(next);
  };

  const counts = useMemo(() => {
    if (!diff) return null;
    const out = { new: 0, changed: 0, same: 0 };
    for (const r of diff.repos) out[r.status] = (out[r.status] || 0) + 1;
    return out;
  }, [diff]);

  return (
    <div className="rp-full" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rp-full-box">
        <div className="rp-full-head">
          <div className="rp-full-title">
            导入导出
            <span className="muted">以全局 key 为身份 · 不含本地路径 · 逐条选择与冲突方案</span>
          </div>
          <div className="rp-full-tabs">
            <button className={'rp-tab' + (tab === 'import' ? ' on' : '')} onClick={() => setTab('import')}>导入</button>
            <button className={'rp-tab' + (tab === 'export' ? ' on' : '')} onClick={() => setTab('export')}>导出</button>
          </div>
          <button className="btn small ghost" onClick={onClose}>关闭</button>
        </div>

        {tab === 'export' ? (
          <div className="rp-full-body">
            <div className="rp-full-col">
              <div className="rp-full-colhead">
                <span>导出范围</span>
                <span className="acts">
                  <button className="btn small ghost" onClick={() => toggleAllRepos(true)}>全选仓库</button>
                  <button className="btn small ghost" onClick={() => toggleAllRepos(false)}>全不选</button>
                  <button className="btn small ghost" onClick={invertRepos}>反选</button>
                </span>
              </div>
              <div className="rp-full-sel">
                {devOrRef.map((r) => (
                  <label className="rp-pick-item" key={r.key}>
                    <input type="checkbox" checked={!!expRepos[r.key]}
                      onChange={(e) => setExpRepos((m) => ({ ...m, [r.key]: e.target.checked }))} />
                    <span className={r.type === 'ref' ? 'rp-full-tag-ref' : ''}>{r.name}</span>
                    <span className="muted rp-full-key" title={r.key}>{r.key}</span>
                  </label>
                ))}
                {!devOrRef.length ? <div className="muted">还没有仓库</div> : null}
              </div>
              <div className="rp-full-colhead" style={{ marginTop: 10 }}>
                <span>看板</span>
                <span className="acts">
                  <button className="btn small ghost" onClick={() => toggleAllBoards(true)}>全选</button>
                  <button className="btn small ghost" onClick={() => toggleAllBoards(false)}>全不选</button>
                </span>
              </div>
              <div className="rp-full-sel">
                {(boards || []).map((b) => (
                  <label className="rp-pick-item" key={b.name}>
                    <input type="checkbox" checked={!!expBoards[b.name]}
                      onChange={(e) => setExpBoards((m) => ({ ...m, [b.name]: e.target.checked }))} />
                    <span>{b.name}</span>
                  </label>
                ))}
                {!boards?.length ? <div className="muted">还没有看板</div> : null}
              </div>
              <label className="rp-pick-item" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={expNoUnassigned} onChange={(e) => setExpNoUnassigned(e.target.checked)} />
                <span>不带未分组的仓库</span>
              </label>
              <div className="form-acts">
                <button className="btn" onClick={doExport}>生成布局</button>
                <button className="btn ghost" disabled={!expResult} onClick={downloadJson}>下载 JSON</button>
              </div>
            </div>
            <div className="rp-full-col">
              <div className="rp-full-colhead"><span>导出结果</span></div>
              <textarea className="rp-full-out" readOnly value={expResult} spellCheck="false"
                placeholder="点「生成布局」后在这里预览 JSON（可直接复制或下载）" />
            </div>
          </div>
        ) : (
          <div className="rp-full-body">
            <div className="rp-full-col">
              <div className="rp-full-colhead"><span>导入来源</span></div>
              <input type="file" accept=".json,application/json" onChange={loadFile} />
              <textarea className="rp-full-input" rows={7} spellCheck="false"
                placeholder="粘贴布局 JSON，或选一个 .json 文件"
                value={impText} onChange={(e) => { setImpText(e.target.value); setDiff(null); }} />
              <div className="form-acts">
                <button className="btn" disabled={!impText.trim() || busy} onClick={doDiff}>差异检查</button>
              </div>

              {diff ? (
                <>
                  <div className="rp-full-colhead" style={{ marginTop: 12 }}>
                    <span>冲突方案</span>
                  </div>
                  <div className="rp-strategy">
                    {[
                      ['ours', '保留本地', '本地已有的不动，只新建缺失的'],
                      ['overwrite', '强制覆盖', '用导入文件覆盖本地字段（key 不变）'],
                      ['duplicate', '另存新 key', '为冲突项新建 key-import-1/2/3，两条并存'],
                    ].map(([v, label, desc]) => (
                      <label className="rp-pick-item" key={v} title={desc}>
                        <input type="radio" name="strategy" checked={strategy === v} onChange={() => setStrategy(v)} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="rp-full-colhead" style={{ marginTop: 10 }}>
                    <span>克隆</span>
                  </div>
                  <select value={cloneMode} onChange={(e) => setCloneMode(e.target.value)}>
                    <option value="none">不克隆，只登记</option>
                    <option value="ref">克隆参考仓库</option>
                    <option value="dev">克隆开发仓库</option>
                    <option value="all">全部克隆</option>
                  </select>
                  <div className="form-acts">
                    <button className="btn" disabled={busy} onClick={doImport}>
                      执行导入（已选 {Object.values(sel).filter(Boolean).length}）
                    </button>
                  </div>
                </>
              ) : null}

              {result ? (
                <div className="rp-import-result">
                  <div>新建 {result.created.length} · 覆盖 {result.updated.length} · 另存 {result.duplicated.length} · 跳过 {result.skipped.length}</div>
                  <div className="muted">看板 新建 {result.boardsCreated} / 合并 {result.boardsMerged} · 参考关系 {result.links}</div>
                  {result.cloned.length ? <div>克隆 {result.cloned.length} 个</div> : null}
                  {result.unmatched.length ? (
                    <div className="rp-layout-warn">本地未拥有 {result.unmatched.length} 条（见下方差异表）</div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="rp-full-col rp-full-col-wide">
              {diff ? (
                <>
                  <div className="rp-full-colhead">
                    <span>
                      差异（新增 {counts.new} · 有差异 {counts.changed} · 一致 {counts.same}
                      {diff.summary.missing ? ` · 本地未拥有 ${diff.summary.missing}` : ''}）
                    </span>
                    <span className="acts">
                      <button className={'rp-chip' + (filter === '' ? ' on' : '')} onClick={() => setFilter('')}>全部</button>
                      <button className={'rp-chip' + (filter === 'new' ? ' on' : '')} onClick={() => setFilter('new')}>新增</button>
                      <button className={'rp-chip' + (filter === 'changed' ? ' on' : '')} onClick={() => setFilter('changed')}>有差异</button>
                      <button className={'rp-chip' + (filter === 'same' ? ' on' : '')} onClick={() => setFilter('same')}>一致</button>
                      <button className="btn small ghost" onClick={() => toggleAllDiff(true)}>全选</button>
                      <button className="btn small ghost" onClick={() => toggleAllDiff(false)}>全不选</button>
                    </span>
                  </div>
                  <div className="rp-diff-table-wrap">
                    <table className="rp-diff-table">
                      <thead>
                        <tr>
                          <th style={{ width: '32px' }}></th>
                          <th style={{ width: '90px' }}>状态</th>
                          <th>仓库 key</th>
                          <th>差异字段</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRepos.map((r) => (
                          <tr key={r.key} className={'rp-diff-row ' + STATUS_META[r.status]?.cls}>
                            <td>
                              <input type="checkbox" disabled={r.status === 'same'}
                                checked={!!sel[r.key]}
                                onChange={(e) => setSel((m) => ({ ...m, [r.key]: e.target.checked }))} />
                            </td>
                            <td><span className={'rp-status ' + STATUS_META[r.status]?.cls}>{STATUS_META[r.status]?.label}</span></td>
                            <td className="mono rp-diff-key">
                              {r.key}
                              {r.status === 'new' && r.canClone ? <span className="rp-can-clone" title="导入时可克隆">可克隆</span> : null}
                              {r.status === 'new' && r.canClone ? (
                                <button className="btn small ghost rp-clone-btn" title="现在就克隆到本地（用这个 key 登记 → 组里的占位自动补齐）"
                                  disabled={busy}
                                  onClick={() => cloneNow(r.key, r.incoming?.remote || '')}>
                                  克隆到本地
                                </button>
                              ) : null}
                            </td>
                            <td className="rp-diff-fields">
                              {r.fields.length ? r.fields.map((f) => (
                                <div key={f.field}>
                                  <b>{f.field}</b>: <span className="rp-was">{JSON.stringify(f.local)}</span>
                                  {' → '}
                                  <span className="rp-now">{JSON.stringify(f.incoming)}</span>
                                </div>
                              )) : <span className="muted">—</span>}
                            </td>
                          </tr>
                        ))}
                        {diff.missing.map((k) => (
                          <tr key={'miss-' + k} className="rp-diff-row missing">
                            <td></td>
                            <td><span className="rp-status missing">本地未拥有</span></td>
                            <td className="mono rp-diff-key">{k}</td>
                            <td className="rp-diff-fields muted">文件里被引用，但文件与本地都没有定义</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {diff.boards.length ? (
                    <div className="rp-diff-boards">
                      <div className="rp-full-colhead"><span>看板</span></div>
                      {diff.boards.map((b) => (
                        <label className="rp-pick-item" key={b.key}>
                          <input type="checkbox" checked={!!boardSel[b.key]}
                            onChange={(e) => setBoardSel((m) => ({ ...m, [b.key]: e.target.checked }))} />
                          <span className={'rp-status ' + STATUS_META[b.status]?.cls}>{STATUS_META[b.status]?.label}</span>
                          <span>{b.key}</span>
                          <span className="muted">（{b.incoming.repos.length} 个成员
                            {b.missingMembers.length ? `，本地未拥有 ${b.missingMembers.length}` : ''}）</span>
                        </label>
                      ))}
                      {/* 本地未拥有的成员逐个列出：组布局已照抄，缺的位置留着，可一键 clone 补齐 */}
                      {diff.boards.flatMap((b) => b.missingMembers || []).map((m) => (
                        <div className="rp-missing-item" key={m.key}>
                          <span className="rp-status missing">本地未拥有</span>
                          <span className="mono rp-missing-key">{m.key}</span>
                          {m.remote ? <span className="muted rp-missing-remote" title={m.remote}>{m.remote}</span> : null}
                          {m.clonable ? (
                            <button className="btn small" disabled={busy} onClick={() => cloneNow(m.key, m.remote)}>
                              克隆到本地
                            </button>
                          ) : (
                            <span className="muted" title="没有远程地址 —— 自行创建后用 repo key set 指定同一个 key">需手工创建</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="muted rp-full-empty">粘贴或选择一份布局 JSON，点「差异检查」后在这里逐条查看与勾选。</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
