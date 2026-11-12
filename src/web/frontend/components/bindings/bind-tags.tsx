// 归属 tag 的通用渲染（文档页 / 仓库页共用）。
//
// 两条硬约束（来自面板实测）：
//   1. **单行钳制**——tag 行不换行，否则仓库表格的一行会被撑成多行、高矮参差；
//      放不下的 tag 隐藏，尾部出现「+N」（点击展开全览，或交给 onMore 跳详情）。
//   2. **省略号**——tag 内的名字超宽截断，悬停 title 看全名；超长仓库名再收窄。
//
// 钳制靠 useLayoutEffect 量 offsetLeft/offsetWidth：React 不管我们给子节点打的
// inline display:none（没有 style prop），所以量完直接隐藏不会被下一次渲染打回。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface BindTagItem {
  /** 稳定 key（refId + host 或 locator） */
  id: string;
  /** 显示名：文档页显示宿主名，仓库页显示文档标题 */
  label: string;
  kind: 'repo' | 'group';
  /** position=0 的主篇（不可解绑） */
  main?: boolean;
  /** 附加项的备注（渲染成「附加 · note」） */
  note?: string;
  /** 完整名字（悬停） */
  title?: string;
  /** 有则渲染 ×（解绑不删文档） */
  onRemove?: () => void;
}

export function BindTag({ t }: { t: BindTagItem }) {
  const role = t.main ? '主篇' : t.note ? `附加 · ${t.note}` : '附加';
  return (
    <span
      className={'nb-tag nb-' + t.kind + (t.main ? ' nb-main' : '')}
      data-btag={t.id}
      title={t.title || t.label}
    >
      <span className="k"><span className="dot" /></span>
      <span className={'role' + (t.main ? ' main' : '')}>{role}</span>
      <span className="name">{t.label}</span>
      {t.onRemove ? (
        <button
          type="button"
          className="x"
          title="解绑（文档本身不删除）"
          onClick={(e) => { e.stopPropagation(); t.onRemove?.(); }}
        >✕</button>
      ) : null}
    </span>
  );
}

/** 单行钳制容器：放不下的子项隐藏，尾部「+N」。 */
export function BindTags({ items, addLabel, onAdd, onMore, empty }: {
  items: BindTagItem[];
  addLabel?: string;
  onAdd?: () => void;
  /** 提供时「+N」直接回调（如开详情），否则点击就地展开/收起 */
  onMore?: () => void;
  /** 空态文案 */
  empty?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(0);

  const measure = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    // 宽 0 = 所在的 tab 还没显示（dock 里用 hidden 切换）：这时候量出来的
    // offsetLeft/offsetWidth 全是 0，按 limit 判定会把所有 tag 一次性隐藏。
    // 等它可见时 ResizeObserver 会再来一次，这里直接跳过。
    if (!box.clientWidth) return;
    const kids = Array.from(box.querySelectorAll<HTMLElement>(':scope > [data-btag]'));
    if (expanded) { kids.forEach((k) => { k.style.display = ''; }); setHidden(0); return; }
    kids.forEach((k) => { k.style.display = ''; });
    const addEl = box.querySelector<HTMLElement>(':scope > [data-badd]');
    const moreEl = box.querySelector<HTMLElement>(':scope > [data-bmore]');
    const reserve = (addEl?.offsetWidth || 0) + (moreEl?.offsetWidth || 0) + 6;
    const limit = box.clientWidth - (reserve > 6 ? reserve : 0) - 2;
    // 不能用 offsetLeft：它相对的是 offsetParent（表格里就是 <table>/<body>），
    // 拿到的是整页 X 坐标，和容器宽度一比必然超限 —— 表格里的 tag 会被全隐藏，
    // 只剩一个「+N」。统一换成「相对容器左沿的右边缘」。
    const left = box.getBoundingClientRect().left;
    let n = 0;
    for (const k of kids) {
      if (k.getBoundingClientRect().right - left > limit) { k.style.display = 'none'; n += 1; }
    }
    setHidden(n);
  }, [expanded]);

  useLayoutEffect(() => { measure(); }, [items, measure]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    return () => ro.disconnect();
  }, [measure]);

  const hasMore = hidden > 0 || expanded;
  return (
    <div className={'nb-tags' + (expanded ? ' open' : '')} ref={boxRef}>
      {items.map((t) => <BindTag key={t.id} t={t} />)}
      {!items.length && empty ? <span className="nb-empty">{empty}</span> : null}
      {hasMore && !onMore ? (
        <button
          type="button"
          className="nb-tag more"
          data-bmore
          title={expanded ? '收起' : '展开全部'}
          onClick={() => setExpanded((v) => !v)}
        >{expanded ? '收起' : `+${hidden}`}</button>
      ) : null}
      {hasMore && onMore ? (
        <button
          type="button"
          className="nb-tag more"
          data-bmore
          title="查看全部"
          onClick={onMore}
        >+{hidden || 0}</button>
      ) : null}
      {onAdd ? (
        <button type="button" className="nb-tag add" data-badd onClick={onAdd}>
          <b>＋</b>{addLabel || '加绑'}
        </button>
      ) : null}
    </div>
  );
}

/** 通用单行钳制包装（给既有 chip 族用，不改它们的样式）。 */
export function ClampRow({ className, children, moreTitle }: {
  className?: string;
  children: ReactNode;
  moreTitle?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(0);

  const measure = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const kids = Array.from(box.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !el.hasAttribute('data-bmore')
    );
    if (open) { kids.forEach((k) => { k.style.display = ''; }); setHidden(0); return; }
    kids.forEach((k) => { k.style.display = ''; });
    const limit = box.clientWidth - 46; // 给 +N 留位
    // 同 BindTags：offsetLeft 相对 offsetParent（表格里是整页坐标系），必须用 rect
    const left = box.getBoundingClientRect().left;
    let n = 0;
    for (const k of kids) {
      if (k.getBoundingClientRect().right - left > limit) { k.style.display = 'none'; n += 1; }
    }
    setHidden(n);
  }, [open]);

  useLayoutEffect(() => { measure(); }, [children, measure]);
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div className={'nb-clamp ' + (className || '') + (open ? ' open' : '')} ref={boxRef}>
      {children}
      {hidden > 0 || open ? (
        <button
          type="button"
          className="nb-more"
          data-bmore
          title={open ? '收起' : (moreTitle || '展开全部')}
          onClick={() => setOpen((v) => !v)}
        >{open ? '收起' : `+${hidden}`}</button>
      ) : null}
    </div>
  );
}
