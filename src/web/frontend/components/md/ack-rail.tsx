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
//
// 轨可拖动（任务 #55）：汉堡钮是拖把——按住拖整条轨（Pointer Events，>4px 算拖、
// 否则算点击），双击回默认钉位；落点经 modules/board/ack-rail-pos 钳制并
// 存 localStorage，重开面板还在。拖动实现已抽到 components/use-rail-drag.ts，
// 文档页的目录轨共用同一份（同一套 `.doc-rail` 视觉，行为不该分叉）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ackNodeTitle } from '../../modules/board/ack-nodes.js';
import { useRailDrag } from '../use-rail-drag.js';

/** 一轮 ack 节点（extractAckNodes 的出站形状里本轨用到的字段）。 */
export interface AckRailNode {
  round: number;
  blockIndex: number;
  feedbackBlockIndex?: number;
  ackText: string;
  title?: string;
  [k: string]: any;
}

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
function blockAt(root: Element | null, idx: number, ackOrdinal: number): Element | null {
  if (!root || idx < 0) return null;
  // 实时预览：每块带 data-i
  const live = root.querySelector(`.mdw-lp-block[data-i="${idx}"]`);
  if (live) return live;
  // 阅读态：整篇渲染 → 按「第 N 个 ack 标题」取。两种形态都可能在场（#144：
  // 历史正文是 h2「上一轮完成总结」，新追加轮次是 callout 标题「第 N 轮 · 完成总结」），
  // 收集后按 DOM 顺序排——与正文出现顺序一致。
  const marks = [
    ...Array.from(root.querySelectorAll('h2')).filter(
      (h) => (h.textContent || '').trim() === '上一轮完成总结'
    ),
    ...Array.from(root.querySelectorAll('.md-callout-t')).filter((t) =>
      /完成总结/.test(t.textContent || '')
    ),
  ].sort((a, b) =>
    // 4 = Node.DOCUMENT_POSITION_FOLLOWING（jsx 的 eslint 环境没有 Node 全局，用常量值）
    a.compareDocumentPosition(b) & 4 ? -1 : 1
  );
  const hit = marks[ackOrdinal];
  if (hit) return hit;
  return null;
}

interface AckRailProps {
  nodes?: AckRailNode[];
  scrollRoot?: Element | null;
  onJump?: ((node: AckRailNode & { title: string }) => void) | null;
}

/**
 * @param {{nodes: {round:number, blockIndex:number, feedbackBlockIndex:number, ackText:string}[],
 *            scrollRoot: Element|null,
 *            onJump?: (node:object)=>void}} props
 */
export default function AckRail({ nodes = [], scrollRoot = null, onJump = null }: AckRailProps) {
  const [open, setOpen] = useState(false);
  const [activeRound, setActiveRound] = useState(0);
  // 拖动（汉堡钮 = 拖把）：落点钳制 / 持久化 / 双击复位都在 use-rail-drag 里，
  // 文档页的目录轨共用同一份实现
  const { railRef, pos, dragging, draggedRef, handleProps } = useRailDrag();

  const items = useMemo(
    // ack-nodes 仍是 JS 模块：ackNodeTitle 的返回被推成 any，契约就是节点标题
    () => (nodes || []).map((n) => ({ ...n, title: ackNodeTitle(n) as string })),
    [nodes]
  );

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
    (node: AckRailNode & { title: string }) => {
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
    <aside
      ref={railRef}
      className={'doc-rail ack-rail' + (open ? ' open' : '') + (dragging ? ' dragging' : '')}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      aria-label="验收轮次"
    >
      <button
        type="button"
        className="doc-rail-menu"
        title={open ? '收起轮次（双击回默认位）' : '展开轮次 · 按住拖动 · 双击回默认位'}
        aria-expanded={open}
        onClick={() => {
          if (draggedRef.current) {
            draggedRef.current = false; // 这下 click 是拖动结束带出来的，别当点击
            return;
          }
          setOpen((v) => !v);
        }}
        {...handleProps}
      >
        <span /><span /><span />
      </button>
      <div className="doc-rail-ticks" role="navigation" aria-label="验收轮次">
        {items.map((it) => (
          <button
            key={it.round}
            type="button"
            className={'doc-rail-tick' + (activeRound === it.round ? ' on' : '')}
            // CSS 自定义属性（--tw 是刻度宽度），CSSProperties 不含自定义键
            style={{ '--tw': '18px' } as CSSProperties}
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
