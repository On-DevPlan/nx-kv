// 撤销删除弹窗（#208）：软删成功后屏幕中央弹一个 5 秒倒计时的小窗，
// 点「撤回」立即恢复（restore 回调由页面注入）；到点自动消失（任务保持软删，
// 可在回收站里找回）。多实例堆叠——连续删几条，每条都有独立的 5 秒窗口。
//
// 为什么做成全局 Provider（而不是页面局部组件）：删除入口在 task-ops（目录页/
// 组页共用），弹窗要跨页面稳定在场——与 ToastProvider 同一模式。
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** 一条撤销窗的数据（restore 由调用方闭包提供：调恢复 API + 刷新 + toast）。 */
export interface UndoDeleteItem {
  /** 展示标题（任务标题 / 编号） */
  title: string;
  /** 撤回动作：调恢复 API 并刷新列表。撤回成功后弹窗立即消失。 */
  restore: () => Promise<void>;
}

const LIFETIME_MS = 5000;

const UndoCtx = createContext<((item: UndoDeleteItem) => void) | null>(null);

interface StackItem extends UndoDeleteItem {
  key: number;
  /** 剩余毫秒（倒计时渲染用；interval 驱动） */
  remain: number;
}

export function UndoDeleteProvider({ children }: { children?: ReactNode }) {
  const [items, setItems] = useState<StackItem[]>([]);
  const itemsRef = useRef<StackItem[]>([]);
  const keyRef = useRef(0);

  const remove = (key: number) => {
    itemsRef.current = itemsRef.current.filter((x) => x.key !== key);
    setItems(itemsRef.current);
  };

  const push = (item: UndoDeleteItem) => {
    const key = ++keyRef.current;
    itemsRef.current = [...itemsRef.current, { ...item, key, remain: LIFETIME_MS }];
    setItems(itemsRef.current);
  };

  // 一个共享 interval 驱动所有在场窗口的倒计时（100ms 步进，数字平滑）
  useEffect(() => {
    if (!items.length) return undefined;
    const timer = setInterval(() => {
      const expired: number[] = [];
      itemsRef.current = itemsRef.current.map((x) => {
        const remain = x.remain - 100;
        if (remain <= 0) expired.push(x.key);
        return { ...x, remain };
      });
      if (expired.length) {
        itemsRef.current = itemsRef.current.filter((x) => !expired.includes(x.key));
      }
      setItems(itemsRef.current);
    }, 100);
    return () => clearInterval(timer);
  }, [items.length]);

  const undo = async (it: StackItem) => {
    try {
      await it.restore();
    } finally {
      remove(it.key);
    }
  };

  return (
    <UndoCtx.Provider value={push}>
      {children}
      {items.length > 0 && (
        <div className="undo-stack">
          {items.map((it) => (
            <div key={it.key} className="undo-pop">
              <span className="undo-msg">已删除「{it.title}」</span>
              <button type="button" className="undo-btn" onClick={() => void undo(it)}>
                撤回 <span className="undo-count">{Math.ceil(it.remain / 1000)}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </UndoCtx.Provider>
  );
}

/** 软删成功后调用：弹 5 秒撤销窗。restore 闭包由页面提供（含恢复 API + 刷新）。 */
export function useUndoDelete(): ((item: UndoDeleteItem) => void) | null {
  return useContext(UndoCtx);
}
