// @ 附件选择面板（#108）：md 编辑器里打 @ 唤起——圆角下拉 + **搜索框** + ↑↓ 选择。
//
// 形状照斜杠菜单（.mdw-slash），多一个搜索：附件按名字搜（斜杠命令是少数几个，
// 附件可能几十条，名字像就搜）。
//
// 选中后由调用方插入**标准附件引用语法**（shared/attach.js 的 embedMarkdown：
// 图片 ![名](fileId)、其他 [名](fileId)），不发明新方言。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { endpointOf, normAttachment } from './attach-common.js';
import { caretLineCol } from '../../modules/md/md-edit-ops.js';
import { embedForAttachment } from '../../modules/md/attach-mention.js';

/**
 * @ 附件选择器的状态机（#108）：live 块编辑器与源码态共用。
 *
 * host：附件清单的取数描述（attach-common.endpointOf 的入参）。
 * onInsert({index, embed, at, caret})：调用方做正文替换（两处编辑器口径不同：
 * 块内替换 vs 全文替换）。
 */
export function useAttachPicker({ host, onInsert }) {
  const [menu, setMenu] = useState(null); // {index, at, caret, x, y, query, active, loading, error}
  const [items, setItems] = useState([]);
  const hostKey = host ? JSON.stringify(host) : '';

  const load = useCallback(async () => {
    if (!host) {
      setItems([]);
      return;
    }
    try {
      const ep = endpointOf(host.host, host);
      const r = await ep.list();
      setItems((r.attachments || []).map(normAttachment));
      setMenu((cur) => (cur ? { ...cur, loading: false, error: '' } : cur));
    } catch (e) {
      setItems([]);
      setMenu((cur) => (cur ? { ...cur, loading: false, error: String((e && e.message) || e) } : cur));
    }
  }, [hostKey]); // host 是对象 prop，用序列化后的 key 做依赖（每次渲染新对象）

  const open = useCallback(({ index, ta, at, caret }) => {
    if (!host || !ta) return;
    const rect = ta.getBoundingClientRect();
    const lineH = 20;
    const line = caretLineCol(ta.value, caret).line;
    const x = Math.min(window.innerWidth - 320, rect.left + 8);
    const y = Math.min(window.innerHeight - 340, rect.top + line * lineH - ta.scrollTop + 8);
    setMenu({ index, at, caret, x, y, query: '', active: 0, loading: true, error: '' });
    load();
  }, [hostKey, load]);

  const close = useCallback(() => setMenu((cur) => (cur ? null : cur)), []);

  const filtered = useMemo(() => {
    const q = String(menu?.query || '').trim().toLowerCase();
    if (!q) return items;
    return items.filter((a) => String(a.name || a.title || a.locator || '').toLowerCase().includes(q));
  }, [items, menu?.query]);

  const active = filtered.length
    ? Math.min(Math.max(0, menu?.active ?? 0), filtered.length - 1)
    : 0;

  const move = useCallback((delta, absolute) => {
    setMenu((cur) => {
      if (!cur) return cur;
      const n = filtered.length;
      if (!n) return cur;
      const next = absolute ? delta : ((cur.active + delta) % n + n) % n;
      return { ...cur, active: next };
    });
  }, [filtered.length]);

  const setQuery = useCallback((q) => {
    setMenu((cur) => (cur ? { ...cur, query: q, active: 0 } : cur));
  }, []);

  // 选中：把引用语法交给调用方替换正文（两处编辑器口径不同）
  const pick = useCallback((a) => {
    const cur = menu;
    setMenu(null);
    if (!a || !cur) return;
    const embed = embedForAttachment(a);
    if (!embed) return;
    onInsert({ index: cur.index, embed, at: cur.at, caret: cur.caret });
  }, [menu, onInsert]);

  return { menu, items: filtered, active, open, close, move, setQuery, pick };
}

export default function AttachPicker({
  items,
  query,
  onQuery,
  active,
  onHover,
  onPick,
  loading,
  error,
  position,
}) {
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // 打开即聚焦搜索框（面板自己接管键盘，↑↓/Enter/Esc 都在输入框上处理）
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 选中项滚进视野（长列表时）
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    root.querySelector('.mdw-atpick-item.on')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, items]);

  return (
    <div className="mdw-atpick" role="dialog" aria-label="选择附件" style={position}>
      <div className="mdw-atpick-search">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="搜索附件…"
          aria-label="搜索附件"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              onHover(e.key === 'ArrowDown' ? 1 : -1);
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (items[active]) onPick(items[active]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              onPick(null); // null = 取消
            }
          }}
        />
      </div>
      {loading ? (
        <div className="mdw-atpick-empty">读取附件…</div>
      ) : error ? (
        <div className="mdw-atpick-empty">读取失败：{error}</div>
      ) : !items.length ? (
        <div className="mdw-atpick-empty">{query ? '没有匹配的附件' : '这条任务还没有附件'}</div>
      ) : (
        <div className="mdw-atpick-list" ref={listRef}>
          {items.map((a, i) => (
            <button
              key={a.id || a.url || a.refId || a.taskId || i}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`mdw-atpick-item${i === active ? ' on' : ''}`}
              onMouseEnter={() => onHover(i, true)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(a);
              }}
            >
              <span className="lab">{a.name || a.title || a.locator || '附件'}</span>
              <span className="hint">
                {[a.kindLabel || a.badge, a.sizeText, a.areaLabel].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="mdw-atpick-cap">↑↓ 选择 · Enter 引用 · Esc 取消</div>
    </div>
  );
}
