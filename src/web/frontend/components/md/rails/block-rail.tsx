// 块侧栏（BlockNote 口径）：鼠标悬停/进入某块时，在左侧留白露出
// 「⋮⋮ 把手 + ＋ 插入」，把手可**拖拽排序**、点击弹出**块菜单**
// （转换为 / 上移 / 下移 / 复制 / 删除）。
//
// 为什么值得单列一个组件：块级操作此前只能靠「斜杠命令在块内改前缀」或
// 「切源码手改」，没有「对着这一块操作」的入口。参考仓库 blocknote 的
// SideMenu 把这两件事收敛成一个悬停出现的小侧栏，本组件按同一分工实现。
//
// 事件边界：侧栏在 .mdw-lp-block 容器**内部**（绝对定位，不参与排版），
// 而容器本身是 role=button（点它进编辑态）——所有交互事件都要就地 stop，
// 否则点一下把手会连带把块切成编辑态。
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { TURN_INTO } from '../../../modules/md/md-edit-ops.js';
import { MenuPortal, openMenuAt, useMenu } from '../shell/tool-bar.jsx';

export interface BlockRailProps {
  index: number;
  total: number;
  /** 拖拽源下标（与列表级 dragover/drop 共享同一个 ref） */
  dragIndexRef: { current: number | null };
  onInsertAfter: (i: number) => void;
  onMove: (from: number, to: number) => void;
  onTurn: (i: number, turnId: string) => void;
  onDuplicate: (i: number) => void;
  onDelete: (i: number) => void;
}

export default function BlockRail({
  index,
  total,
  dragIndexRef,
  onInsertAfter,
  onMove,
  onTurn,
  onDuplicate,
  onDelete,
}: BlockRailProps) {
  const menu = useMenu();

  const stop = (e: ReactMouseEvent<HTMLDivElement> | ReactKeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  const run = (fn: () => void) => {
    menu.setOpen(false);
    fn();
  };

  return (
    <div
      className="mdw-block-rail"
      onMouseDown={stop}
      onClick={stop}
      onKeyDown={stop}
      onDragStart={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="mdw-rail-btn grip"
        draggable
        aria-label="块菜单（可拖拽排序）"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        title="拖拽排序 · 点击打开块菜单"
        onDragStart={(e) => {
          dragIndexRef.current = index;
          e.dataTransfer.effectAllowed = 'move';
          // 某些浏览器（Firefox）没有 setData 就不启动拖拽
          e.dataTransfer.setData('text/plain', String(index));
        }}
        onDragEnd={() => { dragIndexRef.current = null; }}
        onClick={(e) => openMenuAt(menu, e, 'left')}
      >
        ⠿
      </button>
      <button
        type="button"
        className="mdw-rail-btn add"
        aria-label="在下方插入新块"
        title="在下方插入新块"
        onClick={() => run(() => onInsertAfter(index))}
      >
        ＋
      </button>

      <MenuPortal menu={menu} className="mdw-block-menu">
        <div className="mdw-fmt-menu-cap">转换为</div>
        {TURN_INTO.map((t) => (
          <button
            key={t.id}
            type="button"
            role="menuitem"
            className="mdw-fmt-menu-item"
            onClick={() => run(() => onTurn(index, t.id))}
          >
            {t.label}
            <span className="hint">{t.hint}</span>
          </button>
        ))}
        <div className="mdw-fmt-menu-sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          className="mdw-fmt-menu-item"
          disabled={index <= 0}
          onClick={() => run(() => onMove(index, index - 1))}
        >
          上移
          <span className="hint">Alt+↑</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="mdw-fmt-menu-item"
          disabled={index >= total - 1}
          onClick={() => run(() => onMove(index, index + 1))}
        >
          下移
          <span className="hint">Alt+↓</span>
        </button>
        <div className="mdw-fmt-menu-sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          className="mdw-fmt-menu-item"
          onClick={() => run(() => onDuplicate(index))}
        >
          复制块
        </button>
        <button
          type="button"
          role="menuitem"
          className="mdw-fmt-menu-item danger"
          onClick={() => run(() => onDelete(index))}
        >
          删除块
        </button>
      </MenuPortal>
    </div>
  );
}
