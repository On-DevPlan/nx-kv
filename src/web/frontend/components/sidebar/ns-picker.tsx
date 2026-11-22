// 命名空间切换器（#181）：按用户给的参考 UI 重做——
// 「▦ 当前空间 ▾」按钮 → 弹出面板：顶部「筛选分组…」输入框、每行图标 + 名称 + 计数 +
// 当前项高亮 ✓、底部「＋ 新建分组 / 管理命名空间…」。拖拽到按钮即加入当前空间。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons.jsx';
import { ACTIVE_KEY, ALL_TOPICS_KEY } from './model.js';
import type { SidebarNs } from '../../types.js';

export interface NsPickerProps {
  namespaces?: SidebarNs[];
  focusNs?: string;
  onFocus: (focus: string) => void;
  onNewNs: () => void;
  onManage: () => void;
  onAddCurrent?: () => void;
  onDropHere?: (key: string) => void;
}

interface Item { key: string; label: string; count?: number; icon: string; builtin?: boolean }

export default function NsPicker({ namespaces = [], focusNs = '', onFocus, onNewNs, onManage, onAddCurrent, onDropHere }: NsPickerProps) {
  const list = Array.isArray(namespaces) ? namespaces : [];
  const effective = focusNs || list[0]?.id || '';
  const current = list.find((n) => n.id === effective);
  const label = effective === ACTIVE_KEY ? '运行中' : effective === ALL_TOPICS_KEY ? '全部 topic' : current?.name || '全部 topic';
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const items = useMemo<Item[]>(() => [
    ...list.map((n) => ({ key: n.id, label: n.name, count: n.items.length, icon: 'board' })),
    { key: ALL_TOPICS_KEY, label: '全部 topic', icon: 'list', builtin: true },
    { key: ACTIVE_KEY, label: '运行中（有任务）', icon: 'progress', builtin: true },
  ], [list]);
  const shown = q.trim()
    ? items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()))
    : items;

  const select = (key: string) => { onFocus(key); setOpen(false); setQ(''); };
  return (
    <span
      className='ns-picker'
      ref={rootRef}
      onDragOver={(e) => { if (onDropHere) e.preventDefault(); }}
      onDrop={(e) => {
        if (!onDropHere) return;
        e.preventDefault();
        const key = e.dataTransfer.getData('text/plain');
        if (key) onDropHere(key);
      }}
    >
      <button
        type='button'
        className={'ns-picker-btn' + (open ? ' is-open' : '')}
        title={`当前命名空间：${label}（点击切换；拖条目到这里可加入）`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name='board' size={14} />
        <span className='ns-picker-label'>{label}</span>
        <Icon name='chevron' size={11} />
      </button>
      {open ? (
        <span className='ns-picker-pop' role='menu'>
          <label className='ns-picker-search'>
            <Icon name='search' size={13} />
            <input
              value={q}
              placeholder='筛选分组…'
              autoFocus
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && shown.length) select(shown[0]!.key);
              }}
            />
          </label>
          <span className='ns-picker-list'>
            {shown.length ? shown.map((it) => (
              <button
                key={it.key}
                type='button'
                role='menuitem'
                className={'ns-picker-item' + (it.key === effective ? ' is-current' : '')}
                onClick={() => select(it.key)}
              >
                <Icon name={it.icon} size={13} />
                <span className='ns-picker-item-name'>{it.label}</span>
                {it.count !== undefined ? <span className='ns-picker-count'>{it.count}</span> : null}
                {it.key === effective ? <span className='ns-picker-check' aria-hidden>✓</span> : null}
              </button>
            )) : <span className='ns-picker-empty'>没有匹配的命名空间</span>}
          </span>
          <span className='ns-picker-foot'>
            <button type='button' onClick={() => { setOpen(false); onNewNs(); }}>＋ 新建分组</button>
            <button type='button' onClick={() => { setOpen(false); onManage(); }}>管理命名空间…</button>
          </span>
        </span>
      ) : null}
      {current && onAddCurrent ? (
        <button type='button' className='ns-picker-add' title={`向「${label}」添加仓库或分组`} onClick={onAddCurrent}>＋</button>
      ) : null}
    </span>
  );
}
