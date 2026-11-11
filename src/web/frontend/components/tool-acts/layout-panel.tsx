// 工具区编排面板（#141）：完全对齐 nx-ft UX——预览条可拖、行上/下半落点、
// 「更多」卡片收纳；点击只留给显隐；↑↓ / Alt+↑↓ 作兜底。
import { useRef, useState } from 'react';
import type {
  Dispatch,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  SetStateAction,
} from 'react';
import { defaultLayout, inMoreOf, metaOf, onBarOf } from './modules.js';
import type { LayoutItem } from './modules.js';
import { isLocked, moveModule, nudgeModule, setFlag } from './dnd.js';

/** 编排面板入参（layout 是当前生效布局，保存才回写）。 */
export interface ToolActsLayoutPanelProps {
  kind: string;
  layout: LayoutItem[];
  setLayout: Dispatch<SetStateAction<LayoutItem[]>>;
  onClose: () => void;
}

/** 列表落点：插到哪一项前/后。 */
interface ListHit {
  anchorId: string | null;
  after: boolean;
}

/** 拖拽中的源（判定只读它）。 */
interface DragSource {
  id: string;
  onBar: boolean;
}

export default function ToolActsLayoutPanel({ kind, layout, setLayout, onClose }: ToolActsLayoutPanelProps) {
  // 面板改副本；保存才回写（与 nx-ft 同口径）
  const [work, setWork] = useState<LayoutItem[]>(() => layout.map((x) => ({ ...x })));
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [srcId, setSrcId] = useState<string | null>(null);
  const dragRef = useRef<DragSource | null>(null); // 判定只读 ref，state 只用来画

  const barRows = work.filter((x) => onBarOf(kind, x));
  const moreRows = work.filter((x) => inMoreOf(kind, x));
  const movableBar = barRows.filter((x) => !isLocked(kind, x.id));

  const live = (): DragSource | null => {
    const s = dragRef.current;
    return s && !isLocked(kind, s.id) ? s : null;
  };
  const begin = (e: ReactDragEvent<HTMLElement>, item: LayoutItem) => {
    if (isLocked(kind, item.id)) return;
    dragRef.current = { id: item.id, onBar: onBarOf(kind, item) };
    setSrcId(item.id);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.id);
    }
  };
  const finish = () => {
    dragRef.current = null;
    setSrcId(null);
    setDropKey(null);
  };

  const dropAt = (s: DragSource, target: { anchorId?: string | null; after?: boolean; visible?: boolean }) => {
    setWork((w) => moveModule(kind, w, {
      ...target,
      id: s.id,
      // 从「更多」拖上工具栏 → 显式 visible:true
      visible: s.onBar === false ? true : target.visible,
    }));
  };

  // 列表落点：按行中点判前/后（间隙落容器也不误判成末位）
  const hitList = (e: ReactDragEvent<HTMLElement>): ListHit => {
    const y = e.clientY;
    for (const el of e.currentTarget.querySelectorAll('[data-row-id]')) {
      const r = el.getBoundingClientRect();
      // DOM 事件边界：querySelectorAll 返回 Element，data-row-id 只挂在 div 上
      const rowId = (el as HTMLElement).dataset.rowId ?? null;
      if (y < r.top) return { anchorId: rowId, after: false };
      if (y <= r.bottom) {
        return { anchorId: rowId, after: y > r.top + r.height / 2 };
      }
    }
    return { anchorId: null, after: false };
  };

  const overBar = (e: ReactDragEvent<HTMLDivElement>) => {
    const s = live();
    if (!s) return;
    e.preventDefault();
    const hit = hitList(e);
    setDropKey(!hit.anchorId ? 'zone:bar:end'
      : hit.anchorId === s.id ? null
      : `row:${hit.anchorId}:${hit.after ? 'after' : 'before'}`);
  };
  const dropBar = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const hit = hitList(e);
    const s = live();
    finish();
    if (s) dropAt(s, { anchorId: hit.anchorId, after: hit.after, visible: true });
  };
  const leaveBar = (e: ReactDragEvent<HTMLDivElement>) => {
    // DOM 事件边界：relatedTarget 声明为 EventTarget|null，contains 只要 Node
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropKey((k) => (k && k.startsWith('zone:') ? null : k));
  };

  const overMore = (e: ReactDragEvent<HTMLDivElement>) => {
    const s = live();
    if (!s || metaOf(kind, s.id).noHide) return;
    e.preventDefault();
    setDropKey('menu');
  };
  const dropMore = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const s = live();
    finish();
    if (s && !metaOf(kind, s.id).noHide) {
      setWork((w) => setFlag(w, s.id, { visible: false }));
    }
  };
  const leaveMore = (e: ReactDragEvent<HTMLDivElement>) => {
    // DOM 事件边界：同上
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropKey((k) => (k === 'menu' ? null : k));
  };

  const afterHitX = (e: ReactDragEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return (e.clientX - r.left) / (r.width || 1) > 0.5;
  };
  const overChip = (x: LayoutItem, e: ReactDragEvent<HTMLSpanElement>) => {
    const s = live();
    if (!s || s.id === x.id) return;
    e.preventDefault();
    setDropKey(`chip:${x.id}:${afterHitX(e) ? 'after' : 'before'}`);
  };
  const dropChip = (x: LayoutItem, e: ReactDragEvent<HTMLSpanElement>) => {
    const after = afterHitX(e);
    e.preventDefault();
    const s = live();
    finish();
    if (s) dropAt(s, { anchorId: x.id, after, visible: true });
  };

  const toggleVis = (id: string) => {
    if (metaOf(kind, id).noHide) return;
    setWork((w) => {
      const cur = w.find((m) => m.id === id);
      const nextVis = !(cur && onBarOf(kind, cur));
      return setFlag(w, id, { visible: nextVis });
    });
  };

  const nudge = (item: LayoutItem, dir: number) => setWork((w) => nudgeModule(kind, w, item.id, dir));
  const onRowKey = (item: LayoutItem, e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); nudge(item, -1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(item, 1); }
  };

  const save = () => { setLayout(work); onClose(); };
  const reset = () => setWork(defaultLayout(kind));

  const rowCls = (item: LayoutItem, onBar: boolean) => {
    const hint = dropKey === `row:${item.id}:before` ? ' drop-before'
      : dropKey === `row:${item.id}:after` ? ' drop-after' : '';
    return [
      'tlp-row',
      onBar ? '' : 'off',
      isLocked(kind, item.id) ? 'lock' : '',
      srcId === item.id ? 'dragging' : '',
      hint,
    ].filter(Boolean).join(' ');
  };

  return (
    <div className="tlp-panel" role="dialog" aria-label="自定义工具栏">
      <div className="tlp-head">
        <b>自定义工具栏</b>
        <span className="tlp-head-sub">拖拽排序；关显隐 → 收入「更多」</span>
      </div>

      <div className="tlp-body">
        <div className="tlp-section tlp-span">
          <div className="tlp-section-label">预览（可直接拖动这里的按钮排序）</div>
          <div className="tlp-preview" role="list" data-testid="tlp-preview">
            {barRows.map((x) => {
              const chipHint = dropKey === `chip:${x.id}:before` ? ' drop-before'
                : dropKey === `chip:${x.id}:after` ? ' drop-after' : '';
              return (
                <span
                  key={x.id}
                  className={[
                    'tlp-chip',
                    metaOf(kind, x.id).section === 'primary' ? 'primary' : '',
                    srcId === x.id ? 'dragging' : '',
                    chipHint,
                  ].filter(Boolean).join(' ')}
                  draggable={!isLocked(kind, x.id)}
                  role="listitem"
                  onDragStart={(e) => begin(e, x)}
                  onDragEnd={finish}
                  onDragOver={(e) => overChip(x, e)}
                  onDrop={(e) => dropChip(x, e)}
                >
                  {metaOf(kind, x.id).label || x.id}
                </span>
              );
            })}
          </div>
        </div>

        <div className="tlp-section">
          <div className="tlp-section-label">工具栏 · 拖进来即排序（行上/下半 = 前/后）</div>
          <div
            className={'tlp-list' + (dropKey === 'zone:bar:end' ? ' drop-on' : '')}
            role="list"
            onDragOver={overBar}
            onDragLeave={leaveBar}
            onDrop={dropBar}
          >
            {movableBar.length === 0 && barRows.every((x) => isLocked(kind, x.id)) ? (
              <div className="tlp-empty">空 —— 把「更多」里的项拖到这里</div>
            ) : null}
            {barRows.map((item) => {
              const m = metaOf(kind, item.id);
              const i = movableBar.findIndex((x) => x.id === item.id);
              return (
                <div
                  key={item.id}
                  className={rowCls(item, true)}
                  draggable={!isLocked(kind, item.id)}
                  data-row-id={item.id}
                  tabIndex={isLocked(kind, item.id) ? undefined : 0}
                  role="listitem"
                  aria-label={`${m.label || item.id}：拖动排序，Alt+上下换位`}
                  onKeyDown={(e) => onRowKey(item, e)}
                  onDragStart={(e) => begin(e, item)}
                  onDragEnd={finish}
                >
                  <span className="tlp-hnd" title={isLocked(kind, item.id) ? '锁定' : '拖动排序'}>
                    {isLocked(kind, item.id) ? '·' : '⋮⋮'}
                  </span>
                  <input
                    type="checkbox"
                    checked
                    disabled={!!m.noHide}
                    onChange={() => toggleVis(item.id)}
                    title={m.noHide ? '不可隐藏' : '收入「更多」'}
                  />
                  <span className="tlp-nm">
                    {m.label || item.id}
                    {m.noHide ? <span className="tlp-sub">固定显示</span> : null}
                  </span>
                  {!isLocked(kind, item.id) ? (
                    <span className="tlp-acts">
                      <button type="button" className="btn ghost sm" disabled={i <= 0} title="上移" onClick={() => nudge(item, -1)}>↑</button>
                      <button type="button" className="btn ghost sm" disabled={i < 0 || i >= movableBar.length - 1} title="下移" onClick={() => nudge(item, 1)}>↓</button>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="tlp-section">
          <div className="tlp-section-label">更多菜单（拖到上方 = 显示到工具栏；拖回这里 = 收入更多）</div>
          <div
            className={'tlp-list tlp-menu' + (dropKey === 'menu' ? ' dropping' : '')}
            role="list"
            onDragOver={overMore}
            onDragLeave={leaveMore}
            onDrop={dropMore}
          >
            {moreRows.map((item) => {
              const m = metaOf(kind, item.id);
              return (
                <div
                  key={item.id}
                  className={rowCls(item, false)}
                  draggable
                  role="listitem"
                  onDragStart={(e) => begin(e, item)}
                  onDragEnd={finish}
                >
                  <span className="tlp-hnd" title="拖到上方工具栏 = 显示">⋮⋮</span>
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggleVis(item.id)}
                    title="显示到工具栏"
                  />
                  <span className="tlp-nm">{m.label || item.id}</span>
                </div>
              );
            })}
            <div className="tlp-drop-hint" role="presentation">
              {dropKey === 'menu'
                ? '松手 = 收入「更多」'
                : moreRows.length
                  ? '把项拖到上方工具栏区域 = 显示到工具栏'
                  : '工具栏上的按钮拖到这里即可收入「更多」'}
            </div>
          </div>
        </div>
      </div>

      <div className="tlp-foot">
        <span className="tlp-equiv">保存到本机 localStorage（每种工具区各存一份）</span>
        <button type="button" className="btn ghost sm" onClick={reset}>恢复默认</button>
        <button type="button" className="btn ghost sm" onClick={onClose}>取消</button>
        <button type="button" className="btn sm primary" onClick={save}>保存</button>
      </div>
    </div>
  );
}
