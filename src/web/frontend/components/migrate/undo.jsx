// 迁移回执 + 撤销（原型 §5 第 4 步）：toast 告知 + 撤销按钮；8s 内可撤。
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';

/**
 * useUndo(): {undo, node}
 *   undo(info) 弹出回执；info = {label, undoParams}
 *   用户点「撤销」→ POST /api/task/move 带 undo 参数；成功/失败都由调用方的
 *   onDone 回调收尾（刷新数据）。超时自动消失。
 */
export function useUndo({ onDone } = {}) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const clear = useCallback(() => {
    setInfo(null);
    setBusy(false);
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const undo = useCallback(
    (next) => {
      if (timer.current) clearTimeout(timer.current);
      setInfo(next);
      setBusy(false);
      timer.current = setTimeout(() => setInfo(null), 8000);
    },
    []
  );

  const doUndo = async () => {
    if (!info || busy) return;
    setBusy(true);
    try {
      await api('/api/task/move', { method: 'POST', body: { ...info.undoParams, undo: true } });
      clear();
      onDone && onDone('undo-ok');
    } catch (e) {
      setInfo({ ...info, label: '撤销失败: ' + (e.message || e), failed: true });
      setBusy(false);
    }
  };

  useEffect(() => () => timer.current && clearTimeout(timer.current), []);

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
