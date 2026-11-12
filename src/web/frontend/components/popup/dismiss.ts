// 弹层关闭的统一行为：Esc 关 + （可选）点弹层外关。
//
// 此前各弹窗手写同一套 document 监听（overlay PopMenu / RowMenu /
// migrate 对话框 / 快捷键 sheet……），Esc 与点外的细节（捕获阶段、
// stopPropagation、busy 时禁关）各抄各的，容易漂移。统一在这里：
//
//   useDismiss({ onDismiss, enabled, capture, stopProp, isInside })
//   - Esc           → onDismiss（stopProp=true 时拦住不让外层再收一次）
//   - mousedown     → isInside(e) 为假才算「点在外」→ onDismiss
//   - enabled=false → 不挂监听（busy / 未展开时传 false 即可）
import { useEffect } from 'react';

/** useDismiss 入参。`isInside` 只看真值（调用方常写 `ref.current && contains(...)`）。 */
export interface DismissOptions {
  onDismiss?: (() => void) | null;
  enabled?: boolean;
  capture?: boolean;
  stopProp?: boolean;
  isInside?: ((e: MouseEvent) => unknown) | null;
}

export function useDismiss({ onDismiss, enabled = true, capture = false, stopProp = false, isInside = null }: DismissOptions) {
  useEffect(() => {
    if (!enabled || !onDismiss) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (stopProp) e.stopPropagation();
      onDismiss();
    };
    const onDown = (e: MouseEvent) => {
      if (isInside && isInside(e)) return;
      onDismiss();
    };
    document.addEventListener('keydown', onKey, capture);
    if (isInside) document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, capture);
      if (isInside) document.removeEventListener('mousedown', onDown);
    };
  }, [onDismiss, enabled, capture, stopProp, isInside]);
}
