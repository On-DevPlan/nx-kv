// 对齐 remote（批量面板）：一次扫描全部仓库，把「可替换 / key 不一致 / 空 / 悬空」摊开。
//
// **为什么不做成每行一个 remote 按钮**：判断该换哪条 remote 的全部依据都在数据里
// （git remote -v + 登记里采纳的那条 + key 派生），可 40 个仓库就要点 40 次弹窗、
// 每次自己重新判断一遍。所以面板一次扫完：一屏看完所有仓库的 remote 现状 + 建议，
// 单条对齐或「全部按建议对齐」。
//
// 边界：扫描只读本地 git 配置（git remote -v），不发网络请求——所以够快，开面板即跑。
// 远端存在性（git ls-remote，每条要几秒）是**按需**的：点某一行才查那一条。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useGuard, useToast, Modal } from '../../web/frontend/components/ui.jsx';

const STATUS = {
  replaceable: { text: '可替换', cls: 'warn' },
  empty: { text: '无 remote', cls: 'warn' },
  ghost: { text: '登记悬空', cls: 'bad' },
  offline: { text: '目录不可用', cls: 'bad' },
  ok: { text: '已对齐', cls: 'good' },
};
// 需要动手的排前面（先修坏的，再看能换的）
const RANK = { offline: 0, ghost: 1, empty: 2, replaceable: 3, ok: 4 };

export default function RemotePanel({ onClose, onChanged }) {
  const guard = useGuard();
  const toast = useToast();
  const [data, setData] = useState(null);      // scan 结果
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [onlyTodo, setOnlyTodo] = useState(true);
  const [openKey, setOpenKey] = useState('');  // 展开了候选的仓库 key
  const [checks, setChecks] = useState({});    // key -> { status, detail, url }

  const load = useCallback(async () => {
    setErr('');
    try {
      const d = await api('/api/repos/remote/scan');
      setData(d);
    } catch (e) {
      setErr(String((e && e.message) || e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const list = (data && data.repos) || [];
    const sorted = list.slice().sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9)
      || String(a.name).localeCompare(String(b.name)));
    return onlyTodo ? sorted.filter((r) => r.status !== 'ok') : sorted;
  }, [data, onlyTodo]);

  const todoCount = useMemo(
    () => ((data && data.repos) || []).filter((r) => r.status !== 'ok').length,
    [data]
  );
  const suggestList = useMemo(
    () => ((data && data.repos) || []).filter((r) => r.suggest && r.status !== 'ok'),
    [data]
  );

  const alignOne = (row, url) => guard(async () => {
    await api('/api/repos/remote/pick', { method: 'POST', body: { id: row.key, url } });
    toast(`已对齐「${row.name}」→ ${url}`);
    onChanged && onChanged();
    await load();
  });

  const alignAll = () => guard(async () => {
    if (!suggestList.length) return;
    const ok = await window.confirm(
      `按建议对齐 ${suggestList.length} 个仓库的 remote？\n`
      + '自定义 key 的仓库只改 remote，不覆盖 key。'
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api('/api/repos/remote/align', {
        method: 'POST',
        body: { items: suggestList.map((x) => ({ id: x.key, url: x.suggest.url })) },
      });
      toast(`已对齐 ${r.aligned}/${r.total} 条`
        + (r.failed && r.failed.length ? `；失败 ${r.failed.length} 条` : ''));
      onChanged && onChanged();
      await load();
    } finally {
      setBusy(false);
    }
  });

  // 单条存在性检查：git ls-remote 要几秒，先显示「检查中」
  const check = (row, url) => guard(async () => {
    setChecks((c) => ({ ...c, [row.key]: { url, status: 'checking', detail: '检查中…' } }));
    try {
      const d = await api('/api/repos/remote/check?id=' + encodeURIComponent(row.key)
        + (url ? '&url=' + encodeURIComponent(url) : ''));
      setChecks((c) => ({ ...c, [row.key]: d }));
    } catch (e) {
      setChecks((c) => ({ ...c, [row.key]: { url, status: 'unreachable', detail: String((e && e.message) || e) } }));
    }
  });

  const counts = (data && data.counts) || {};
  const chip = (label, n, cls) => (
    <span className={'rp-rm-chip ' + (cls || '')} key={label}>{label} <b>{n || 0}</b></span>
  );

  return (
    <Modal title="对齐 remote · 全部仓库" onClose={onClose}>
      <div className="rp-rm" data-testid="rp-remote-panel">
        <div className="rp-rm-head">
          <div className="rp-rm-sum">
            {data ? (
              <>
                {chip('全部', counts.total)}
                {chip('可替换', counts.replaceable, 'warn')}
                {chip('无 remote', counts.empty, 'warn')}
                {chip('登记悬空', counts.ghost, 'bad')}
                {chip('目录不可用', counts.offline, 'bad')}
                {chip('已对齐', counts.ok, 'good')}
              </>
            ) : <span className="muted">扫描中…</span>}
          </div>
          <div className="acts">
            <button className={'btn small ghost' + (onlyTodo ? ' on' : '')} onClick={() => setOnlyTodo((v) => !v)}>
              {onlyTodo ? `只看需处理（${todoCount}）` : '显示全部'}
            </button>
            <button className="btn small ghost" onClick={load} disabled={busy}>重新扫描</button>
            <button className="btn small" onClick={alignAll} disabled={busy || !suggestList.length}>
              全部按建议对齐{suggestList.length ? `（${suggestList.length}）` : ''}
            </button>
          </div>
        </div>

        <div className="rp-rm-hint muted">
          key 是本地身份，remote 是别人 clone 用的地址。建议按「origin 优先、同名里 SSH 优先」给，
          采纳哪条由你定——换一条即对齐（key 随之重算；自定义 key 只改 remote）。
        </div>

        {err ? <div className="rp-rm-err">{err}<button className="btn small ghost" onClick={load}>重试</button></div> : null}

        <div className="rp-rm-list">
          {rows.map((r) => {
            const st = STATUS[r.status] || { text: r.status, cls: '' };
            const open = openKey === r.key;
            const ck = checks[r.key];
            return (
              <div className={'rp-rm-row' + (open ? ' open' : '')} key={r.key}>
                <div className="rp-rm-main" onClick={() => setOpenKey(open ? '' : r.key)}>
                  <span className={'rp-rm-state ' + st.cls}>{st.text}</span>
                  <span className="rp-rm-name" title={r.path}>
                    {r.name}
                    {r.type === 'ref' ? <em className="rp-rm-tag">参考</em> : null}
                    {r.keyCustom ? <em className="rp-rm-tag">自定义 key</em> : null}
                  </span>
                  <span className="mono rp-rm-url" title={r.current || ''}>{r.current || '（未采纳）'}</span>
                  <span className="rp-rm-acts" onClick={(e) => e.stopPropagation()}>
                    {r.suggest ? (
                      <button className="btn small" title={`对齐到 ${r.suggest.url}`}
                        onClick={() => alignOne(r, r.suggest.url)}>对齐建议</button>
                    ) : null}
                    <button className="btn small ghost" onClick={() => setOpenKey(open ? '' : r.key)}>
                      {open ? '收起' : `候选 ${r.candidates.length}`}
                    </button>
                  </span>
                </div>
                {open ? (
                  <div className="rp-rm-detail">
                    <div className="muted rp-rm-reason">{r.reason}</div>
                    <div className="rp-remote-list">
                      {r.candidates.map((c) => (
                        <div className="rp-remote-item" key={c.name + '|' + c.url}>
                          <span className="rp-remote-name">{c.name}</span>
                          <span className="mono rp-remote-url">{c.url}</span>
                          <span className="rp-remote-kind">{c.kind}</span>
                          {c.current ? <span className="rp-remote-on">当前</span> : null}
                          <span className="acts">
                            {!c.current ? (
                              <button className="btn small" onClick={() => alignOne(r, c.url)}>对齐这条</button>
                            ) : null}
                            <button className="btn small ghost" onClick={() => check(r, c.url)}>检查</button>
                          </span>
                        </div>
                      ))}
                      {!r.candidates.length ? (
                        <div className="muted">这个仓库没有配置 remote —— 先在 git 里 git remote add</div>
                      ) : null}
                    </div>
                    {ck ? (
                      <div className="rp-remote-check">
                        <span className={'rp-status ' + (ck.status === 'exists' ? 'same' : ck.status === 'checking' ? 'checking' : 'new')}>
                          {ck.status === 'exists' ? '存在' : ck.status === 'missing' ? '不存在'
                            : ck.status === 'checking' ? '检查中' : '不可达'}
                        </span>
                        <span className="mono rp-remote-url">{ck.url}</span>
                        <span className="muted">{ck.detail}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {!rows.length && !err ? (
            <div className="rp-rm-empty muted">
              {data ? (onlyTodo ? '全部仓库的 remote 都已对齐' : '还没有登记仓库') : '扫描中…'}
            </div>
          ) : null}
        </div>

        <div className="form-acts">
          <button className="btn ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </Modal>
  );
}
