// 任务页的「ack 定位轨」——反复 ack 反馈的长任务页里，一键跳到某一轮。
//
// 复用的是简介页那套定位轨（components/Introduction/rail.jsx 的 .doc-rail 视觉），
// 但**定位方式不同**：简介页按标题锚点跳，本轨按**块序号**跳。
// 原因见 modules/board/ack-nodes.js 的注释——实时预览态逐块渲染，同名标题在 DOM 里
// 拿到的是重复的同一个 id，按 id 跳永远落在第一轮；块序号（data-i）才唯一。
//
// 两种渲染态都要能用：
//   - 实时预览（.mdw-lp）：块有 data-i，按序号直接取
//   - 阅读态（.mdw-preview）：整篇一次性渲染，没有块元素，按「第 N 个 ack 标题」取
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ackNodeTitle } from '../../modules/board/ack-nodes.js';

/**
 * 在滚动容器里按块序号找到目标块。
 *
 * 两种渲染态的 DOM 形状不同：
 *   - 实时预览（.mdw-lp）：每块一个 .mdw-lp-block，带 data-i → 直接取
 *   - 阅读态（.mdw-preview）：整篇一次性渲染成一段 HTML，**没有块元素**；
 *     此时改用「第 N 个 ack 标题元素」定位（同名标题在阅读态是整篇共享 usedIds，
 *     id 各不相同，所以能按序号取到）
 *
 * @param {Element|null} root 滚动容器
 * @param {number} idx 块序号
 * @param {number} ackOrdinal 该轮是第几个 ack（0 基；阅读态按标题序号取）
 * @returns {Element|null}
 */
function blockAt(root, idx, ackOrdinal) {
  if (!root || idx < 0) return null;
  // 实时预览：每块带 data-i
  const live = root.querySelector(`.mdw-lp-block[data-i="${idx}"]`);
  if (live) return live;
  // 阅读态：整篇渲染 → 按「第 N 个 ack 标题」取
  const heads = [...root.querySelectorAll('h2')].filter(
    (h) => (h.textContent || '').trim() === '上一轮完成总结'
  );
  if (heads[ackOrdinal]) return heads[ackOrdinal];
  return null;
}

/**
 * @param {{nodes: {round:number, blockIndex:number, feedbackBlockIndex:number, ackText:string}[],
 *            scrollRoot: Element|null,
 *            onJump?: (node:object)=>void}} props
 */
export default function AckRail({ nodes = [], scrollRoot = null, onJump = null }) {
  const [open, setOpen] = useState(false);
  const [activeRound, setActiveRound] = useState(0);

  const items = useMemo(() => (nodes || []).map((n) => ({ ...n, title: ackNodeTitle(n) })), [nodes]);

  // 当前视口里最近的一个 ack 段 → 高亮对应节点
  useEffect(() => {
    const root = scrollRoot;
    if (!root || !items.length) return undefined;
    const sync = () => {
      const rootRect = root.getBoundingClientRect();
      let cur = 0;
      for (const it of items) {
        const el = blockAt(root, it.blockIndex, it.round - 1);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top - rootRect.top <= 40) cur = it.round;
      }
      setActiveRound(cur);
    };
    sync();
    root.addEventListener('scroll', sync, { passive: true });
    return () => root.removeEventListener('scroll', sync);
  }, [scrollRoot, items]);

  const jump = useCallback(
    (node) => {
      const root = scrollRoot;
      const el = root ? blockAt(root, node.blockIndex, node.round - 1) : null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveRound(node.round);
      }
      onJump?.(node);
    },
    [scrollRoot, onJump]
  );

  if (!items.length) return null;

  return (
    <aside className={'doc-rail ack-rail' + (open ? ' open' : '')} aria-label="验收轮次">
      <button
        type="button"
        className="doc-rail-menu"
        title={open ? '收起轮次' : '展开轮次'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span /><span /><span />
      </button>

      <div className="doc-rail-ticks" role="navigation" aria-label="验收轮次">
        {items.map((it) => (
          <button
            key={it.round}
            type="button"
            className={'doc-rail-tick' + (activeRound === it.round ? ' on' : '')}
            style={{ '--tw': '18px' }}
            title={it.title}
            aria-current={activeRound === it.round ? 'true' : undefined}
            onClick={() => jump(it)}
          />
        ))}
      </div>

      {open && (
        <div className="doc-rail-panel">
          <div className="doc-rail-sec">
            <div className="doc-rail-sec-lab">验收轮次</div>
            {items.map((it) => (
              <button
                key={it.round}
                type="button"
                className={'doc-rail-row' + (activeRound === it.round ? ' on' : '')}
                title={it.ackText}
                onClick={() => jump(it)}
              >
                第 {it.round} 轮
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
