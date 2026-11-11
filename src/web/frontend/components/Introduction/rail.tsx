// 简介 / 文档右侧滚动目录：竖轨 + 展开名单 + 补充文档。
// links 形状统一：[{ docId, label, note?, main? }]
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { IntroLink } from './use-intro.js';

/** 当前文档的一个标题（extractMdHeadings 的产出）。 */
export interface IntroHeading {
  id: string;
  text: string;
  level: number;
}

export interface IntroRailProps {
  headings?: IntroHeading[] | null;
  /** 滚动容器（文档正文的 scrollParent）；没有就不做位置同步。 */
  scrollRoot?: HTMLElement | null;
  links?: IntroLink[] | null;
  activeDocId?: string;
  onOpenDoc?: ((docId: string) => void) | null;
  onAddRef?: (() => void) | null;
}

function tickWidth(level: number): number {
  if (level <= 1) return 18;
  if (level === 2) return 12;
  return 8;
}

/** 章节位置快照（滚到 28px 以内的最后一个标题即视为「本章」）。 */
interface HeadingTop {
  id: string;
  y: number;
}

export default function IntroRail({
  headings = [],
  scrollRoot = null,
  links = [],
  activeDocId = '',
  onOpenDoc = null,
  onAddRef = null,
}: IntroRailProps) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState('');
  const items = useMemo(() => headings || [], [headings]);
  const docEntries = useMemo(() => links || [], [links]);

  useEffect(() => {
    const root = scrollRoot;
    if (!root || !items.length) return undefined;
    const tops = (): HeadingTop[] =>
      items
        .map((h) => {
          const el = root.querySelector(`#${CSS.escape(h.id)}`);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const rr = root.getBoundingClientRect();
          return { id: h.id, y: r.top - rr.top };
        })
        .filter((x): x is HeadingTop => !!x);
    const sync = () => {
      const list = tops();
      if (!list.length) return;
      // 列表已判空，首项必然存在
      const first = list[0]!;
      let cur = first.id;
      for (const x of list) {
        if (x.y <= 28) cur = x.id;
      }
      setActiveId(cur);
    };
    sync();
    root.addEventListener('scroll', sync, { passive: true });
    return () => root.removeEventListener('scroll', sync);
  }, [scrollRoot, items]);

  const jump = useCallback(
    (id: string) => {
      const root = scrollRoot;
      if (!root) return;
      const el = root.querySelector(`#${CSS.escape(id)}`);
      if (!el) {
        // 找不到锚点（如 h1 在实时预览里是标题块、没有 id）→ 回到顶部
        root.scrollTo({ top: 0, behavior: 'smooth' });
        setActiveId(id);
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
    },
    [scrollRoot]
  );

  if (!items.length && !docEntries.length && !onAddRef) return null;

  return (
    <aside className={'doc-rail' + (open ? ' open' : '')} aria-label="文档目录">
      <button
        type="button"
        className="doc-rail-menu"
        title={open ? '收起目录' : '展开目录'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span /><span /><span />
      </button>

      <div className="doc-rail-ticks" role="navigation" aria-label="章节">
        {items.map((h) => (
          <button
            key={h.id}
            type="button"
            className={'doc-rail-tick' + (activeId === h.id ? ' on' : '')}
            // 自定义属性（--tw 定刻线宽度）：CSSProperties 不认，只能在样式对象边界断言
            style={{ '--tw': `${tickWidth(h.level)}px` } as CSSProperties}
            title={h.text}
            aria-current={activeId === h.id ? 'true' : undefined}
            onClick={() => jump(h.id)}
          />
        ))}
      </div>

      {open && (
        <div className="doc-rail-panel">
          {items.length > 0 && (
            <div className="doc-rail-sec">
              <div className="doc-rail-sec-lab">本章</div>
              {items.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={'doc-rail-row' + (activeId === h.id ? ' on' : '')}
                  data-lv={h.level}
                  onClick={() => jump(h.id)}
                >
                  {h.text}
                </button>
              ))}
            </div>
          )}
          {(docEntries.length > 0 || onAddRef) && (
            <div className="doc-rail-sec">
              <div className="doc-rail-sec-lab">介绍文档</div>
              {docEntries.map((d) => (
                <button
                  key={d.docId}
                  type="button"
                  className={'doc-rail-row' + (d.docId === activeDocId ? ' on' : '')}
                  title={d.note || d.label}
                  disabled={!onOpenDoc}
                  onClick={() => onOpenDoc && onOpenDoc(d.docId)}
                >
                  {d.main ? '● ' : '○ '}
                  {d.label}
                </button>
              ))}
              {onAddRef && (
                <button type="button" className="doc-rail-add" onClick={onAddRef}>
                  ＋ 补充文档
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
