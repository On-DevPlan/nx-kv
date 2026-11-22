// 侧栏分区（namespace）头行（#167）——从 index.tsx 拆出的纯渲染组件。
// 折叠 / 置顶星标 / 计数；拖拽（分区排序 / 收编条目）沿用 Sidebar 的统一 handler。
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Icon } from '../icons.jsx';
import type { SideRow } from './model.js';
import type { DropZone } from './drag.js';

export interface NsHeadRowProps {
  row: SideRow;
  kbFocus: boolean;
  dropHint: { id: string; zone: DropZone } | null;
  onOpen: () => void;                 // 行点击 = 折叠切换
  onToggle: () => void;               // chevron = 折叠切换
  onMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  onDragStart: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDragEnd: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDragOver: (e: ReactDragEvent<HTMLButtonElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: ReactDragEvent<HTMLButtonElement>) => void;
}

export default function NsHeadRow(p: NsHeadRowProps) {
  const { row, dropHint } = p;
  return (
    <button
      key={'ns:' + row.key}
      className={'trow ns-head' + (row.pinned ? ' pinned' : '') + (p.kbFocus ? ' kb-focus' : '')}
      onClick={p.onOpen}
      onContextMenu={p.onMenu}
      draggable
      onDragStart={p.onDragStart}
      onDragEnd={p.onDragEnd}
      onDragOver={p.onDragOver}
      onDragLeave={p.onDragLeave}
      onDrop={p.onDrop}
      data-drop={dropHint?.id === row.key ? dropHint?.zone : undefined}
      title={`${row.name} · ${row.count} 个条目（分区：拖动排序；把条目拖进来即归入）`}
    >
      <span
        className="tw" role="button" tabIndex={-1} aria-label="折叠分区"
        onClick={(e) => { e.stopPropagation(); p.onToggle(); }}
      >
        <Icon name="chevron" size={10} />
      </span>
      <span className="gico"><Icon name="flow" /></span>
      <span className="nm">
        {row.pinned ? <span className="ns-pin" aria-hidden>★</span> : null}
        {row.name}
      </span>
      {row.pending > 0 && <span className="cnt">{row.pending}</span>}
      <span
        className="more" role="button" tabIndex={-1} aria-label="分区菜单"
        onClick={p.onMenu}
      >
        <Icon name="dots" size={13} />
      </span>
    </button>
  );
}
