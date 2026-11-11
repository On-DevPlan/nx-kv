// toast：页内轻提示（自动消失）。
//
// 全站唯一的轻提示出口——任何「操作成功 / 失败原因 / 已复制」都在这里出，
// 不许再用浏览器原生 alert（原生框样式不可控，且会阻塞线程）。
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './style.css';

/** 轻提示函数（全站 toast 的唯一形状）。 */
export type ToastFn = (msg: string) => void;

/** 失败即 toast 的异步守卫（对应 vanilla 版的 guard()）。 */
export type GuardFn = (fn: () => Promise<unknown>) => Promise<unknown>;

/** 一条在场提示。 */
interface ToastMsg {
  id: number;
  msg: string;
}

const ToastCtx = createContext<ToastFn | null>(null);

/** ToastProvider 入参。 */
export interface ToastProviderProps {
  children?: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [msgs, setMsgs] = useState<ToastMsg[]>([]);
  const idRef = useRef(0);

  const toast = useCallback<ToastFn>((msg) => {
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

export function useToast(): ToastFn {
  return useContext(ToastCtx) || ((m: string) => console.log(m));
}

// 操作守卫：包一层，失败自动 toast 错误信息（对应 vanilla 版的 guard()）
export function useGuard(): GuardFn {
  const toast = useToast();
  return useCallback<GuardFn>(async (fn) => {
    // catch 变量是 unknown：优先取 Error.message，其余 String() 兜底（与原口径一致）
    try { return await fn(); } catch (e) { toast(String((e as Error)?.message || e)); }
  }, [toast]);
}
