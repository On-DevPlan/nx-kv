// 撤销删除弹窗（#208）：软删成功后屏幕中央弹一个固定 5 秒的小窗，
// 鼠标悬浮在窗口上时暂停计时（不消失），移开后继续走；满 5 秒渐出消失
//（任务保持软删，可在回收站里找回）。多实例堆叠——连续删几条，每条都有独立窗口。
//
// 为什么做成全局 Provider（而不是页面局部组件）：删除入口在 task-ops / task-actions
// 等多处（目录页/组页/任务页/进程页共用），弹窗要跨页面稳定在场——与 ToastProvider 同一模式。
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** 一条撤销窗的数据（restore 由调用方闭包提供：调恢复 API + 刷新 + toast）。 */
export interface UndoDeleteItem {
  /** 展示标题（任务标题 / 编号） */
  title: string;
  /** 撤回动作：调恢复 API 并刷新列表。撤回成功后弹窗立即消失。 */
  restore: () => Promise<void>;
}

/** 在场时长（毫秒）；悬浮时暂停。 */
const LIFETIME_MS = 5000;
/** 渐出动画时长（毫秒），与 CSS .undo-pop--out 过渡一致。 */
const FADE_MS = 260;

const UndoCtx = createContext<((item: UndoDeleteItem) => void) | null>(null);

interface StackItem extends UndoDeleteItem {
  key: number;
  /** 剩余毫秒；进入渐出阶段后改计 FADE_MS */
  remain: number;
  /** 渐出中：透明度过渡已启动，计满后摘除 */
  fading: boolean;
}

export function UndoDeleteProvider({ children }: { children?: ReactNode }) {
  const [items, setItems] = useState<StackItem[]>([]);
  const itemsRef = useRef<StackItem[]>([]);
  const keyRef = useRef(0);
  // 悬浮中的窗口 key：暂停倒计时
  const hoveredRef = useRef<Set<number>>(new Set());

  const remove = (key: number) => {
    hoveredRef.current.delete(key);
    itemsRef.current = itemsRef.current.filter((x) => x.key !== key);
    setItems(itemsRef.current);
  };

  const push = (item: UndoDeleteItem) => {
    const key = ++keyRef.current;
    itemsRef.current = [...itemsRef.current, { ...item, key, remain: LIFETIME_MS, fading: false }];
    setItems(itemsRef.current);
  };

  // 一个共享 interval 驱动所有在场窗口的计时（100ms 步进）：
  // 悬浮中的暂停；计满进入渐出（FADE_MS），渐出计满摘除。
  useEffect(() => {
    if (!items.length) return undefined;
    const timer = setInterval(() => {
      const gone: number[] = [];
      itemsRef.current = itemsRef.current.map((x) => {
        // 渐出阶段不计悬浮（鼠标多半还在上面，也不能一直挂着）
        if (x.fading) {
          const remain = x.remain - 100;
          if (remain <= 0) gone.push(x.key);
          return { ...x, remain };
        }
        if (hoveredRef.current.has(x.key)) return x;
        const remain = x.remain - 100;
        if (remain <= 0) return { ...x, remain: FADE_MS, fading: true };
        return { ...x, remain };
      });
      if (gone.length) {
        itemsRef.current = itemsRef.current.filter((x) => !gone.includes(x.key));
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
            <div
              key={it.key}
              className={'undo-pop' + (it.fading ? ' undo-pop--out' : '')}
              onMouseEnter={() => hoveredRef.current.add(it.key)}
              onMouseLeave={() => hoveredRef.current.delete(it.key)}
            >
              <span className="undo-msg">已删除「{it.title}」</span>
              <button type="button" className="undo-btn" onClick={() => void undo(it)}>
                撤回
              </button>
            </div>
          ))}
        </div>
      )}
    </UndoCtx.Provider>
  );
}

/** 软删成功后调用：弹 5 秒撤销窗（悬浮暂停；满时渐出）。restore 闭包由页面提供。 */
export function useUndoDelete(): ((item: UndoDeleteItem) => void) | null {
  return useContext(UndoCtx);
}
