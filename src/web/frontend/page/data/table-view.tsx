// 单表浏览视图（data 页第二形态）—— #287 起换 **AG Grid Community**（开源 MIT 网格）：
// 排序 / 单元格直编 / 行选择都交给网格标准能力，调试面板不再自研表格交互。
// CRUD 走 /api/db/row-*（仅 serve --debug 开放；后端过 PRAGMA 白名单 + 参数绑定）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { CellValueChangedEvent, GridApi, GridReadyEvent, RowSelectionOptions } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import {
  deleteDbRow,
  fetchDbTable,
  insertDbRow,
  updateDbRow,
} from './api.js';
import type { DbRows, DbTableInfo } from './api.js';
import { Icon } from '../../components/icons.jsx';

/** 页大小与服务端 DATA_DEFAULT_LIMIT 对齐；翻页就是改 offset。 */
const PAGE_SIZE = 200;

export default function TableView({ table, onBack }: { table: DbTableInfo; onBack: () => void }) {
  const [data, setData] = useState<DbRows | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const gridApi = useRef<GridApi | null>(null);

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

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2500);
  };

  // ── 保存：单元格里改过的行按 __rowid__ 逐行 UPDATE ──
  const dirtyRef = useRef<Map<number, Record<string, string | number | null>>>(new Map());
  const onCellChanged = useCallback((e: CellValueChangedEvent) => {
    const rid = Number(e.data?.__rowid__);
    if (!Number.isFinite(rid)) return;
    const cur = dirtyRef.current.get(rid) || {};
    cur[e.colDef.field || ''] = e.newValue;
    dirtyRef.current.set(rid, cur);
  }, []);
  const saveEdits = useCallback(async () => {
    const entries = [...dirtyRef.current.entries()];
    if (!entries.length) return flash('没有改动');
    try {
      for (const [rid, changes] of entries) await updateDbRow(table.name, rid, changes);
      dirtyRef.current.clear();
      flash(`已保存 ${entries.length} 行改动`);
      await load(offset);
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  }, [table.name, offset, load]);

  // ── 新增行：网格加一行空的草稿行（ref 追踪），存草稿行 → INSERT 后从网格移除并刷新 ──
  const draftRef = useRef<Record<string, any>[]>([]);
  const addRow = useCallback(() => {
    const api: GridApi | undefined = gridApi.current || undefined;
    if (!api) return;
    const draft = { __new__: true, __draft__: `tmp-${Date.now()}-${draftRef.current.length}` };
    draftRef.current.push(draft);
    api.applyTransaction({ add: [draft], addIndex: data?.rows.length || 0 });
    flash('草稿行已加到末尾——填好后点「存草稿行」');
  }, [data]);

  const saveNewRows = useCallback(async () => {
    const api: GridApi | undefined = gridApi.current || undefined;
    if (!api) return;
    const drafts = draftRef.current;
    if (!drafts.length) return flash('没有待保存的草稿行');
    let saved = 0;
    try {
      const leftovers: Record<string, any>[] = [];
      for (const r of drafts) {
        const values: Record<string, string | number | null> = {};
        for (const c of (data?.columns || [])) {
          const v = r[c.name];
          if (v !== undefined && v !== null && v !== '') values[c.name] = v;
        }
        if (!Object.keys(values).length) {
          leftovers.push(r); // 全空草稿行留在网格里，不插
          continue;
        }
        await insertDbRow(table.name, values);
        saved++;
      }
      draftRef.current = leftovers;
      for (const r of drafts) if (!leftovers.includes(r)) api.applyTransaction({ remove: [r] });
      flash(`已插入 ${saved} 行`);
      if (saved) await load(offset);
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  }, [data, table.name, offset, load]);

  // ── 删除选中行 ──
  const delSelected = useCallback(async () => {
    const api: GridApi | undefined = gridApi.current || undefined;
    if (!api) return;
    const sel = api.getSelectedRows().filter((r) => r.__rowid__ !== undefined && !r.__new__);
    if (!sel.length) return flash('先选中一行（点行首勾选）');
    try {
      for (const r of sel) await deleteDbRow(table.name, Number(r.__rowid__));
      api.applyTransaction({ remove: sel });
      flash(`已删除 ${sel.length} 行`);
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  }, [table.name]);

  // 列定义：__rowid__ 只读展示在最左；其余列全部可直编
  const columnDefs = useMemo(() => {
    const cols = data?.columns || [];
    return [
      {
        field: '__rowid__',
        headerName: 'rowid',
        width: 90,
        editable: false,
        cellClass: 'dv-rowid',
      },
      ...cols.map((c) => ({
        field: c.name,
        headerName: c.type ? `${c.name}` : c.name,
        headerTooltip: `${c.name} ${c.type}`,
        editable: true,
        filter: true,
        sortable: true,
      })),
    ];
  }, [data]);

  const onGridReady = useCallback((e: GridReadyEvent) => { gridApi.current = e.api; }, []);
  const rowSelection: RowSelectionOptions = useMemo(
    () => ({ mode: 'singleRow', checkboxes: true, headerCheckbox: false }),
    [],
  );

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
        <span className="dv-tcount">{count} 行 · {table.columns.length} 列（双击单元格直编）</span>
        <div className="dv-search">
          <Icon name="search" size={12} title={undefined} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="全表快筛（AG Grid quick filter）"
            spellCheck="false"
            aria-label="快筛"
          />
        </div>
        <button type="button" className="dv-reload" onClick={() => load(offset)} title="重新加载" aria-label="重新加载">
          <Icon name="refresh" size={13} title={undefined} />
        </button>
      </div>
      {error && <div className="dv-error">失败：{error}</div>}
      {toast && <div className="dv-toast">{toast}</div>}
      <div className="dv-crud-bar">
        <button type="button" onClick={addRow} title="在网格末尾加一条草稿行">＋ 新增行</button>
        <button type="button" onClick={() => void saveNewRows()} title="把填好的草稿行插入表里">存草稿行</button>
        <button type="button" onClick={() => void saveEdits()} title="把改过内容的行写回表里">保存改动</button>
        <button type="button" onClick={() => void delSelected()} title="删除勾选的行">删除选中</button>
        <span className="dv-crud-hint">调试面板 · 组件：AG Grid Community（MIT）· 改表请先 db backup</span>
      </div>
      <div className="dv-grid-wrap ag-theme-quartz" key={`${table.name}:${offset}`}>
        {!data && !error && <div className="dv-empty muted">加载中…</div>}
        {data && (
          <AgGridReact
            columnDefs={columnDefs}
            rowData={data.rows}
            getRowId={(p) => String(p.data.__rowid__ ?? p.data.__draft__ ?? `row:${p.data.id ?? ''}`)}
            quickFilterText={q}
            onGridReady={onGridReady}
            onCellValueChanged={onCellChanged}
            rowSelection={rowSelection}
            defaultColDef={{ resizable: true, minWidth: 80 }}
            animateRows={false}
            suppressCellFocus={false}
          />
        )}
      </div>
      <div className="dv-pager">
        <span className="dv-range">第 {from}–{to} 行，共 {count} 行{q.trim() ? `（筛出 ${data?.rows.length || 0}）` : ''}</span>
        <button type="button" className="dv-page" disabled={!canPrev || loading} onClick={() => { const n = Math.max(0, offset - PAGE_SIZE); setOffset(n); load(n); }}>上一页</button>
        <button type="button" className="dv-page" disabled={!canNext || loading} onClick={() => { const n = offset + PAGE_SIZE; setOffset(n); load(n); }}>下一页</button>
      </div>
    </div>
  );
}
