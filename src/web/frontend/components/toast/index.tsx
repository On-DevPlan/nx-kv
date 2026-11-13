// toast：页内轻提示（自动消失）。
//
// 全站唯一的轻提示出口——任何「操作成功 / 失败原因 / 已复制」都在这里出，
// 不许再用浏览器原生 alert（原生框样式不可控，且会阻塞线程）。
//
// 去重与限高（#189）：同文案再次触发时**原地续时**，不再压一个新节点——
// 此前 Ctrl+S 连击会不断往栈里加「已保存」，提示条整体往上跳、看起来像抖动。
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './style.css';

/** 轻提示函数（全站 toast 的唯一形状）。 */
export type ToastFn = (msg: string) => void;

/** 失败即 toast 的异步守卫（对应 vanilla 版的 guard()）。 */
export type GuardFn = (fn: () => Promise<unknown>) => Promise<unknown>;

/** 一条提示的在场时长（ms）。 */
const LIFETIME_MS = 2800;

/** 同时最多挂几条：超出的挤掉最老的，保证提示区高度稳定。 */
const MAX_STACK = 3;

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
  // 在场列表的同步镜像：回调里判重、摘条都用它，不必等重渲染
  const msgsRef = useRef<ToastMsg[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  /** 给一条提示上表（已有计时器先清 = 续时）。 */
  const arm = useCallback((id: number) => {
    const prev = timersRef.current.get(id);
    if (prev) clearTimeout(prev);
    timersRef.current.set(id, setTimeout(() => {
      timersRef.current.delete(id);
      msgsRef.current = msgsRef.current.filter((x) => x.id !== id);
      setMsgs(msgsRef.current);
    }, LIFETIME_MS));
  }, []);

  const toast = useCallback<ToastFn>((msg) => {
    const list = msgsRef.current;
    const same = list.find((x) => x.msg === msg);
    if (same) {
      arm(same.id); // 同文案：续时，不新增节点（栈不长高 → 不跳）
      return;
    }
    const id = ++idRef.current;
    const next = [...list, { id, msg }];
    // 超限挤掉最老的：连带清计时器，否则它到点会去改一份已不在场的列表
    for (const gone of next.splice(0, Math.max(0, next.length - MAX_STACK))) {
      const t = timersRef.current.get(gone.id);
      if (t) clearTimeout(t);
      timersRef.current.delete(gone.id);
    }
    msgsRef.current = next;
    setMsgs(next);
    arm(id);
  }, [arm]);

  // 卸载时清表：计时器不该在 Provider 之外触 setState
  useEffect(() => () => {
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
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
