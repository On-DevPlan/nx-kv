// 验收条 ack 展开/夹紧状态（任务 #20：长总结被 line-clamp 截断）。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useAck({ id, taskRow, dockTab, dockOpen }) {
  const [ackOpen, setAckOpen] = useState(false);
  const [ackOverflow, setAckOverflow] = useState(false);
  const reviewSumRef = useRef(null);
  const ackLong = String(taskRow?.roundSummary || '').length > 140;

  useEffect(() => {
    setAckOpen(false);
    setAckOverflow(false);
  }, [id, taskRow?.roundSummary]);

  useLayoutEffect(() => {
    const el = reviewSumRef.current;
    if (!el) {
      setAckOverflow(false);
      return undefined;
    }
    // -webkit-line-clamp 下首帧 scrollHeight 偶发等于 clientHeight——用 ResizeObserver
    // + rAF 再量一次；长文案另有字符数兜底，避免按钮永远不出现。
    const measure = () => {
      if (ackOpen) return;
      setAckOverflow(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [ackOpen, taskRow?.roundSummary, taskRow?.completedAt, dockTab, dockOpen]);

  return { ackOpen, setAckOpen, ackOverflow, reviewSumRef, ackLong };
}
