// 数据库视图（#/data）：当前项目库的**全部内容**可视化——
// 首屏 = 库文件 / schema 版本 / 每张表的行数占比条；点表卡进单表浏览（table-view.tsx）。
//
// 数据只读：走 GET /api/db/data（CLI db data 同一契约），不触发导入、不升级、不写库。
// 表排序按行数降序（大表在前），占比条一眼看出数据都堆在哪几张表里。
import { useCallback, useEffect, useMemo, useState } from 'react';
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { fetchDbOverview } from './api.js';
import type { DbOverview } from './api.js';
import TableView from './table-view.js';
import { Icon } from '../../components/icons.jsx';
import './style.css';

export default function DataView() {
  const [data, setData] = useState<DbOverview | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await fetchDbOverview());
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 行数降序（大表在前）；点击表卡回概览时保留同一份概览数据不重拉
  const tables = useMemo(
    () => [...(data?.tables || [])].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    [data],
  );
  const total = useMemo(() => tables.reduce((n, t) => n + t.count, 0), [tables]);
  const max = useMemo(() => tables.reduce((m, t) => Math.max(m, t.count), 0), [tables]);
  const activeInfo = active ? tables.find((t) => t.name === active) || null : null;

  if (activeInfo) {
    return <TableView table={activeInfo} onBack={() => setActive(null)} />;
  }

  return (
    <div className="dv-page">
      <RouteBreadcrumb />
      <div className="dv-head">
        <span className="dv-title">数据库</span>
        <button type="button" className="dv-reload" onClick={load} title="重新读取库概览" aria-label="重新读取库概览">
          <Icon name="refresh" size={13} title={undefined} />
        </button>
      </div>
      {error && <div className="dv-error">读取失败：{error}</div>}
      {data && (
        <div className="dv-meta">
          <span className="dv-path" title={data.path}>{data.path}</span>
          <span className="dv-chip">schema v{data.userVersion}{data.currentSchemaVersion !== data.userVersion ? `（代码 v${data.currentSchemaVersion}）` : ''}</span>
          <span className="dv-chip">{tables.length} 张表</span>
          <span className="dv-chip">{total} 行</span>
          <span className="dv-note">只读视图：不写库、不迁移；全表 SQL 检索用 CLI scripts/db-inspect.mjs</span>
        </div>
      )}
      <div className="dv-cards">
        {tables.map((t) => (
          <button
            key={t.name}
            type="button"
            className="dv-card"
            onClick={() => setActive(t.name)}
            title={`${t.name}：${t.count} 行 · ${t.columns.length} 列`}
          >
            <div className="dv-card-h">
              <span className="dv-card-name">{t.name}</span>
              <span className="dv-card-count">{t.count}</span>
            </div>
            <div className="dv-card-bar" aria-hidden="true">
              <i style={{ width: max ? `${Math.max(2, Math.round((t.count * 100) / max))}%` : '0%' }} />
            </div>
            <div className="dv-card-sub">{t.columns.length} 列{t.columns.length <= 8 ? ` · ${t.columns.map((c) => c.name).join(' ')}` : ''}</div>
          </button>
        ))}
      </div>
      {data && !tables.length && (
        <div className="dv-empty muted">
          空库（没有表）——跑 <code>nx-kv db migrate</code> 建表后再来看
        </div>
      )}
    </div>
  );
}
