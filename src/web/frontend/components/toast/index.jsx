// toast：页内轻提示（自动消失）。
//
// 全站唯一的轻提示出口——任何「操作成功 / 失败原因 / 已复制」都在这里出，
// 不许再用浏览器原生 alert（原生框样式不可控，且会阻塞线程）。
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import './style.css';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [msgs, setMsgs] = useState([]);
  const idRef = useRef(0);

  const toast = useCallback((msg) => {
    const id = ++idRef.current;
    setMsgs((m) => [...m, { id, msg }]);
    setTimeout(() => setMsgs((m) => m.filter((x) => x.id !== id)), 2800);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-stack">
        {msgs.map((m) => <div key={m.id} className="toast show">{m.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx) || ((m) => console.log(m));
}

// 操作守卫：包一层，失败自动 toast 错误信息（对应 vanilla 版的 guard()）
export function useGuard() {
  const toast = useToast();
  return useCallback(async (fn) => {
    try { return await fn(); } catch (e) { toast(String((e && e.message) || e)); }
  }, [toast]);
}
