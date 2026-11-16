// 插件顺序拖动卡（S4，方案 §5.2）：复用 md 编辑器 use-block-drag 的手法
// （dragover 上/下半区判落点 + 插入线），零新依赖。drop → 重排数组 →
// PUT /api/prompt/order → 父组件重新 GET 刷新。不提供数字输入框——
// 数字输入是「相等 / gap」这两个分支的唯一来源（§5.1）。
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';

/** 注册表里的一段插件描述（GET /api/prompt/registry 的 plugins[]）。 */
export interface PluginDesc {
  id: string;
  order: number;
  tag: string;
  label: string;
  template: string;
  fields: { key: string; kind: string; label: string; desc?: string }[];
  writableKeys: string[];
}

export function PluginOrderCard({
  plugins,
  busy,
  onChange,
}: {
  plugins: PluginDesc[];
  busy: boolean;
  onChange: (next: PluginDesc[]) => void;
}) {
  // 拖拽源下标放 ref 而不是 state：dragstart 里写、dragover 里读，期间不重渲染。
  const dragFromRef = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<{ index: number; edge: 'before' | 'after' } | null>(null);

  const clear = () => {
    dragFromRef.current = null;
    setDropAt(null);
  };

  const rowOf = (target: EventTarget | null): HTMLElement | null => {
    const el = (target as Element | null)?.closest?.('.ppt-order-row');
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
      const at = dropAt;
      clear();
      if (from == null || !at) return;
      e.preventDefault();
      // 插到 after 处 = 目标行原下标 + 1；源行在目标之前时先被抽走，整体左移一格
      let to = at.edge === 'before' ? at.index : at.index + 1;
      if (from < to) to -= 1;
      if (to === from) return;
      const next = [...plugins];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      onChange(next);
    },
    onDragEnd: clear,
  };

  return (
    <div className="ppt-order-card">
      <div className="ppt-order-head">
        <b>输出顺序</b>
        <span className="setp-note">拖动调整段落输出顺序；顺序只存数组，保存后 CLI 渲染顺序同步变化</span>
      </div>
      <div className="ppt-order-list" {...listProps}>
        {plugins.map((p, i) => (
          <div
            key={p.id}
            data-i={i}
            className={
              'ppt-order-row' +
              (dropAt?.index === i && dropAt.edge === 'before' ? ' is-drop-before' : '') +
              (dropAt?.index === i && dropAt.edge === 'after' ? ' is-drop-after' : '') +
              (dragFromRef.current === i ? ' is-dragging' : '')
            }
          >
            <span
              className="ppt-order-handle"
              draggable={!busy}
              onDragStart={() => {
                dragFromRef.current = i;
              }}
              title="拖动调整顺序"
            >
              ⠿
            </span>
            <span className="ppt-order-pos">{p.order}</span>
            <span className="ppt-order-label">{p.label}</span>
            <code className="ppt-order-tag">{p.tag}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
