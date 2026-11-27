// 单表浏览视图（data 页的第二形态）：列头 + 行窗口 + 翻页 + 本地快筛。
//
// 窗口数据（一次 ≤ limit 行）从 /api 来；搜索在**已加载的窗口内**过滤——
// 这是「看看数据长什么样」的检视器，不是全表搜索引擎（全表检索走 CLI db-inspect --sql）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchDbTable } from './api.js';
import type { DbRows, DbTableInfo } from './api.js';
import { Icon } from '../../components/icons.jsx';

/** 页大小与服务端 DATA_DEFAULT_LIMIT 对齐；翻页就是改 offset。 */
const PAGE_SIZE = 200;

/** 单元格显示文本：null/undefined → 「NULL」，其余 String 化（对象 JSON 一下）。 */
function cellText(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** 单行是否命中快筛：任意列的显示文本包含关键字（大小写不敏感）。 */
function hitRow(row: Record<string, any>, q: string): boolean {
  for (const v of Object.values(row)) {
    if (cellText(v).toLowerCase().includes(q)) return true;
  }
  return false;
}

export default function TableView({ table, onBack }: { table: DbTableInfo; onBack: () => void }) {
  const [data, setData] = useState<DbRows | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');

  const load = useCallback(async (off: number) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchDbTable(table.name, PAGE_SIZE, off));
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setLoading(false);
    }
  }, [table.name]);

  useEffect(() => { setOffset(0); setQ(''); load(0); }, [load]);

  // 快筛只作用于**当前窗口**的行；q 为空不筛
  const rows = useMemo(() => {
    const all = data?.rows || [];
    const qs = q.trim().toLowerCase();
    return qs ? all.filter((r) => hitRow(r, qs)) : all;
  }, [data, q]);

  const count = data?.count ?? table.count;
  const from = count === 0 ? 0 : offset + 1;
  const to = offset + (data?.rows.length || 0);
  const canPrev = offset > 0;
  const canNext = !!data && offset + data.rows.length < count;

  return (
    <div className="dv-table">
      <div className="dv-thead">
        <button type="button" className="dv-back" onClick={onBack} title="返回表概览" aria-label="返回表概览">
          <Icon name="back" size={14} title={undefined} />
        </button>
        <span className="dv-tname" title={table.name}>{table.name}</span>
        <span className="dv-tcount">{count} 行 · {table.columns.length} 列</span>
        <div className="dv-search">
          <Icon name="search" size={12} title={undefined} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`在已加载的 ${data?.rows.length || 0} 行里筛（全表检索用 CLI db-inspect --sql）`}
            spellCheck="false"
            aria-label="在当前窗口内筛选"
          />
        </div>
        <button type="button" className="dv-reload" onClick={() => load(offset)} title="重新加载" aria-label="重新加载">
          <Icon name="refresh" size={13} title={undefined} />
        </button>
      </div>
      {error && <div className="dv-error">加载失败：{error}</div>}
      <div className="dv-rows" key={`${table.name}:${offset}`}>
        {!data && !error && <div className="dv-empty muted">加载中…</div>}
        {data && !rows.length && (
          <div className="dv-empty muted">{q.trim() ? '窗口内没有匹配的行' : '这张表还没有数据'}</div>
        )}
        {rows.length > 0 && (
          <table className="dv-grid">
            <thead>
              <tr>
                {data!.columns.map((c) => (
                  <th key={c.name} title={`${c.name} ${c.type}`}>
                    {c.name}
                    {c.type && <span className="dv-coltype">{c.type}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={offset + i}>
                  {data!.columns.map((c) => {
                    const txt = cellText(r[c.name]);
                    return (
                      <td key={c.name} className={r[c.name] === null || r[c.name] === undefined ? 'null' : ''} title={txt}>
                        {txt}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="dv-pager">
        <span className="dv-range">第 {from}–{to} 行，共 {count} 行{q.trim() ? `（筛出 ${rows.length}）` : ''}</span>
        <button type="button" className="dv-page" disabled={!canPrev || loading} onClick={() => { const n = Math.max(0, offset - PAGE_SIZE); setOffset(n); load(n); }}>上一页</button>
        <button type="button" className="dv-page" disabled={!canNext || loading} onClick={() => { const n = offset + PAGE_SIZE; setOffset(n); load(n); }}>下一页</button>
      </div>
    </div>
  );
}
