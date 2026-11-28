// 回收站（#208）：topic 主页「更多 → 回收站」打开的弹层。
// 列出本队列的软删任务（GET /api/localtasks/tasks?deleted=true），每行可
// 「恢复」（restore API）或「彻底清除」（purge，不可逆——放在行尾 ⋯ 里防误触）。
import { useCallback, useEffect, useState } from 'react';
import { fetchTrashTasks, restoreTrashTask, purgeTrashTask } from './api.js';

interface TrashRow {
  scope?: TrashScope;
  id: number;
  status: string;
  title: string;
  createdAt: string;
  deletedAt: string;
}

export interface TrashScope {
  cwd?: string;
  key?: string;
}

export interface TrashModalProps {
  /** 队列定位（组页跨成员队列：传多个，列表合并去重） */
  scopes: TrashScope[];
  onClose: () => void;
  /** 恢复/清除后回调（父页面刷新队列数据） */
  onChanged?: () => void;
}

export default function TrashModal({ scopes, onClose, onChanged }: TrashModalProps) {
  const [rows, setRows] = useState<TrashRow[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setErr('');
    try {
      const seen = new Set<string>();
      const merged: TrashRow[] = [];
      for (const scope of scopes) {
        const qs = new URLSearchParams();
        if (scope.cwd) qs.set('cwd', scope.cwd);
        if (scope.key) qs.set('key', scope.key);
        qs.set('deleted', 'true');
        const out = await fetchTrashTasks(qs.toString());
        for (const t of (out.tasks ?? []) as TrashRow[]) {
          const k = `${scope.cwd || scope.key}:${t.id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          merged.push({ ...t, scope });
        }
      }
      setRows(merged);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
      setRows([]);
    }
  }, [scopes]);

  useEffect(() => { void load(); }, [load]);

  const restore = async (row: TrashRow) => {
    const id = row.id;
    setBusy(id);
    try {
      await restoreTrashTask({ ...(row.scope || {}), id });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const purge = async (row: TrashRow) => {
    const id = row.id;
    setBusy(id);
    try {
      await purgeTrashTask({ ...(row.scope || {}), id, purge: true });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="trash-mask" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="trash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="trash-head">
          <span className="trash-title">回收站</span>
          <span className="trash-hint">软删除的任务在这找回；「彻底清除」不可逆</span>
          <button type="button" className="trash-close" aria-label="关闭回收站" onClick={onClose}>×</button>
        </div>
        <div className="trash-body">
          {rows === null && <div className="trash-empty">加载中…</div>}
          {rows !== null && err && <div className="trash-empty is-err">{err}</div>}
          {rows !== null && !err && rows.length === 0 && (
            <div className="trash-empty">回收站是空的——删除的任务会出现这里，5 秒内可直接在删除提示里撤回</div>
          )}
          {rows !== null && rows.map((r) => (
            <div key={r.id} className="trash-row">
              <span className="trash-id">#{r.id}</span>
              <span className="trash-task-title">{r.title || `#${r.id}`}</span>
              <span className="trash-time">{r.deletedAt}</span>
              <span className="trash-acts">
                <button type="button" className="btn small ghost" disabled={busy === r.id}
                  onClick={() => void restore(r)}>恢复</button>
                <button type="button" className="btn small ghost danger" disabled={busy === r.id}
                  title="彻底清除（不可恢复）"
                  onClick={() => void purge(r)}>彻底清除</button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
