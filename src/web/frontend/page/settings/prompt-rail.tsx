// 提示词段落左轨（S5 UI 重设计）：一行 = 一段，**拖动排序与点击选段是同一个控件**。
//
// 为什么合并：旧实现里「输出顺序卡」和「区块 tabs」是两份 8 段清单，却是同一份
// 数据（数组下标即顺序），改顺序要滚到上面、改模板要滚到下面，两处状态各自理解。
//
// 顺序真相仍是数组（方案 §5.1）：drop → 重排 → PUT /api/prompt/order。
// 行首 1..n 只是**位次展示**，不提供数字输入——数字输入是「相等 / gap」两个
// 分支的唯一来源，方案明确不做。
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';

/** 注册表里的一段插件描述（GET /api/prompt/registry 的 plugins[]，声明派生）。 */
export interface PluginDesc {
  id: string;
  /** 数组下标 × 10（运行期 order，不是存储值） */
  order: number;
  tag: string;
  label: string;
  /** 文本态（= 生效模板正文），仅作兜底；模板编辑区读 blockTemplates */
  template: string;
  fields: { key: string; kind: string; label: string; desc?: string }[];
  /** 非空 = 该段会把数据写进交付上下文；空 = 只读段（不回写上下文） */
  writableKeys: string[];
}

/** 左轨一行需要的运行时信息（顺序 / 段名来自注册表，生效模板名来自设置）。 */
export interface RailSlot {
  plugin: PluginDesc;
  /** 当前生效模板名（内置 → 「系统内置」） */
  activeName: string;
  builtin: boolean;
}

export function PromptRail({
  slots,
  activeId,
  busy,
  onSelect,
  onReorder,
}: {
  slots: RailSlot[];
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onReorder: (next: PluginDesc[]) => void;
}) {
  // 拖拽源下标放 ref：dragstart 写、dragover 读，期间不重渲染。
  const dragFromRef = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<{ index: number; edge: 'before' | 'after' } | null>(null);

  const clear = () => {
    dragFromRef.current = null;
    setDropAt(null);
  };

  const rowOf = (target: EventTarget | null): HTMLElement | null => {
    const el = (target as Element | null)?.closest?.('.ppt-rail-row');
    return (el as HTMLElement | null) ?? null;
  };

  const listProps = {
    onDragOver(e: DragEvent<HTMLDivElement>) {
      if (dragFromRef.current == null) return;
      const el = rowOf(e.target);
      if (!el) return;
      const idx = Number(el.getAttribute('data-i'));
      if (!Number.isInteger(idx)) return;
      // preventDefault 是「允许放下」的唯一开关，缺了它 drop 永远不触发
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = el.getBoundingClientRect();
      const edge = e.clientY < rect.top + rect.height / 2 ? ('before' as const) : ('after' as const);
      setDropAt((cur) => (cur && cur.index === idx && cur.edge === edge ? cur : { index: idx, edge }));
    },
    onDragLeave(e: DragEvent<HTMLDivElement>) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null);
    },
    onDrop(e: DragEvent<HTMLDivElement>) {
      const from = dragFromRef.current;
      clear();
      if (from == null) return;
      // 落点直接按 drop 事件现算，不读 dropAt state：dragover → drop 的合成事件
      // 可能落在同一帧里（React 批处理还没 flush），读 state 会拿到上一轮的 null。
      const el = rowOf(e.target);
      if (!el) return;
      const idx = Number(el.getAttribute('data-i'));
      if (!Number.isInteger(idx)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const edge = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      // 插到 after 处 = 目标行原下标 + 1；源行在目标之前时先被抽走，整体左移一格
      let to = edge === 'before' ? idx : idx + 1;
      if (from < to) to -= 1;
      if (to === from) return;
      const next = slots.map((s) => s.plugin);
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      onReorder(next);
    },
    onDragEnd: clear,
  };

  return (
    <div className="ppt-rail">
      <div className="ppt-rail-head">
        <b>输出顺序</b>
        <span className="setp-note">拖动调序 · 点击编辑</span>
      </div>
      <div className="ppt-rail-list" role="listbox" aria-label="提示词段落（顺序即输出顺序）" {...listProps}>
        {slots.map((s, i) => {
          const p = s.plugin;
          const ro = p.writableKeys.length === 0;
          return (
            <div
              key={p.id}
              data-i={i}
              role="option"
              aria-selected={p.id === activeId}
              tabIndex={0}
              className={
                'ppt-rail-row' +
                (p.id === activeId ? ' is-on' : '') +
                (dropAt?.index === i && dropAt.edge === 'before' ? ' is-drop-before' : '') +
                (dropAt?.index === i && dropAt.edge === 'after' ? ' is-drop-after' : '') +
                (dragFromRef.current === i ? ' is-dragging' : '')
              }
              onClick={() => !busy && onSelect(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!busy) onSelect(p.id);
                }
              }}
            >
              <span
                className="ppt-rail-handle"
                draggable={!busy}
                title="拖动调整输出顺序"
                onClick={(e) => e.stopPropagation()}
                onDragStart={(e) => {
                  dragFromRef.current = i;
                  e.dataTransfer.effectAllowed = 'move';
                  try {
                    e.dataTransfer.setData('text/plain', String(i));
                  } catch {
                    /* 某些环境禁 setData：drop 判定不依赖它 */
                  }
                }}
              >
                ⠿
              </span>
              <span className="ppt-rail-pos">{i + 1}</span>
              <span className="ppt-rail-main" title={p.label}>
                <span className="ppt-rail-label">{p.label}</span>
                <span className="ppt-rail-active">
                  {s.builtin ? '系统内置' : s.activeName}
                </span>
              </span>
              {ro && (
                <span className="ppt-rail-ro" title="只读段：只出现在提示词里，不回写交付上下文">
                  只读
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
