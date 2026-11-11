// 迁移回执 + 撤销（原型 §5 第 4 步）：toast 告知 + 撤销按钮；8s 内可撤。
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';

/** 一条撤销回执：文案 + POST /api/task/move 的 undo 参数。 */
export interface UndoInfo {
  label: string;
  /** 撤销请求体（外部数据边界：字段由迁移接口定义）。 */
  undoParams: Record<string, unknown>;
  /** 撤销失败后的回执（按钮不再显示） */
  failed?: boolean;
}

export interface UseUndoOptions {
  /** 撤销完成（或失败）后的回调，参数是结果标记 */
  onDone?: (reason: string) => void;
}

/**
 * useUndo(): {undo, node}
 *   undo(info) 弹出回执；info = {label, undoParams}
 *   用户点「撤销」→ POST /api/task/move 带 undo 参数；成功/失败都由调用方的
 *   onDone 回调收尾（刷新数据）。超时自动消失。
 */
export function useUndo({ onDone }: UseUndoOptions = {}) {
  const [info, setInfo] = useState<UndoInfo | null>(null);
  const [busy, setBusy] = useState(false);
  // 浏览器定时器 id 是 number（@types/node 的 setTimeout 会返回 Timeout，所以走 window）
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    setInfo(null);
    setBusy(false);
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const undo = useCallback(
    (next: UndoInfo) => {
      if (timer.current) window.clearTimeout(timer.current);
      setInfo(next);
      setBusy(false);
      timer.current = window.setTimeout(() => setInfo(null), 8000);
    },
    []
  );

  const doUndo = async () => {
    if (!info || busy) return;
    setBusy(true);
    try {
      await api('/api/task/move', { method: 'POST', body: { ...info.undoParams, undo: true } });
      clear();
      if (onDone) onDone('undo-ok');
    } catch (e) {
      setInfo({ ...info, label: '撤销失败: ' + ((e as Error).message || e), failed: true });
      setBusy(false);
    }
  };

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const node = info ? (
    <div className="undo-toast" role="status">
      <span>{info.label}</span>
      {!info.failed && (
        <button onClick={doUndo} disabled={busy}>{busy ? '撤销中…' : '撤销'}</button>
      )}
      <button className="x" aria-label="关闭回执" onClick={clear}>✕</button>
    </div>
  ) : null;

  return { undo, clear, node };
}
