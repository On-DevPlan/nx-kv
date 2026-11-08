// @ 附件选择面板（#108/#109）：md 编辑器里打 @ 唤起——圆角下拉 + **搜索框** + ↑↓ 选择。
//
// 形状照斜杠菜单（.mdw-slash），多一个搜索：附件按名字搜（斜杠命令是少数几个，
// 附件可能几十条，名字像就搜）。
//
// #109 验收反馈补齐：
//   · 附件不止「已有的文件」——面板底部有「＋ 添加附件」，打开共享选择弹窗
//     （AttachModal：本机文件 / 外部链接 / 任务引用 / 文档引用），加完即刷新清单；
//   · 任务条目显示**标题**（#seq 标题），超宽省略、悬浮看全名，
//     条目尾部 ↗ 在主区右侧并排打开原文（旁路）方便对照。
//
// 选中后由调用方插入**标准附件引用语法**（shared/attach.js 的 embedMarkdown：
// 图片 ![名](fileId)、其他 [名](fileId)），不发明新方言。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { endpointOf, normAttachment, docIdOfLocator } from './attach-common.js';
import { caretLineCol } from '../../modules/md/md-edit-ops.js';
import { embedForAttachment } from '../../modules/md/attach-mention.js';
import AttachModal from './attach-modal.jsx';
import { useApp } from '../../app-context.jsx';
import { openBesideMain } from '../../workspace.js';

/**
 * @ 附件选择器的状态机（#108）：live 块编辑器与源码态共用。
 *
 * host：附件清单的取数描述（attach-common.endpointOf 的入参，可带 allow/taskOptions
 * 供「添加附件」弹窗用）。
 * onInsert({index, embed, at, caret})：调用方做正文替换（两处编辑器口径不同：
 * 块内替换 vs 全文替换）。
 */
export function useAttachPicker({ host, onInsert }) {
  const [menu, setMenu] = useState(null); // {index, at, caret, x, y, query, active, loading, error}
  const [items, setItems] = useState([]);
  // host 是对象 prop（每次渲染新对象）——依赖用序列化后的**身份字段**（不含
  // taskOptions 这类大数组，避免每次轮询都换引用）
  const hostKey = host
    ? JSON.stringify({ h: host.host, id: host.hostId, k: host.hostKey, c: host.hostCwd, r: host.refId })
    : '';

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
    const x = Math.min(window.innerWidth - 340, rect.left + 8);
    const y = Math.min(window.innerHeight - 360, rect.top + line * lineH - ta.scrollTop + 8);
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

  return { menu, items: filtered, active, open, close, reload: load, move, setQuery, pick };
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
  host = null,        // 取数描述（含 allow / taskOptions——「添加附件」弹窗要用）
  onReload = null,    // 添加附件成功后刷新清单
}) {
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const app = useApp() || {};
  const [addOpen, setAddOpen] = useState(false);

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

  // 任务/文档条目可「右侧并排看原文」（#109）：task 用 topicKey+seq 开任务页，
  // ref 用 locator 开文档页——都在主区右侧的旁路位，不顶掉正在写的正文。
  const openOriginal = (a) => {
    const m = app.model;
    if (!m) return;
    if (a.kind === 'task' && a.topicKey && a.seq) {
      openBesideMain(m, {
        component: 'page',
        name: `原文 #${a.seq}`,
        config: { dirKey: String(a.topicKey), task: String(a.seq) },
      });
      return;
    }
    if (a.kind === 'ref') {
      const docId = docIdOfLocator(a.locator || a.relPath || '');
      if (!docId) return;
      openBesideMain(m, {
        component: 'doc',
        name: a.title || a.name || '文档',
        config: { docId },
      });
    }
  };

  const openable = (a) => {
    if (a.kind === 'task') return !!(a.topicKey && a.seq);
    if (a.kind === 'ref') return !!(a.refId || a.locator || a.relPath);
    return false;
  };

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
          {items.map((a, i) => {
            const label = a.name || a.title || a.locator || '附件';
            const canOpen = openable(a);
            return (
              <div key={a.id || a.url || a.refId || a.taskId || i} className="mdw-atpick-row">
                <button
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
                  <span className="lab" title={label}>{label}</span>
                  <span className="hint">
                    {[a.kindLabel || a.badge, a.sizeText, a.areaLabel].filter(Boolean).join(' · ')}
                  </span>
                </button>
                {canOpen && (
                  <button
                    type="button"
                    className="mdw-atpick-open"
                    title="在右侧并排显示原文，方便对照"
                    aria-label={`查看原文：${label}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      openOriginal(a);
                    }}
                  >
                    ↗
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="mdw-atpick-foot">
        <span className="mdw-atpick-cap">↑↓ 选择 · Enter 引用 · Esc 取消</span>
        <span className="grow" />
        {host && (
          <button
            type="button"
            className="mdw-atpick-add"
            title="添加附件（本机文件 / 外部链接 / 任务 / 文档）"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAddOpen(true)}
          >
            ＋ 添加附件
          </button>
        )}
      </div>
      {host && (
        <AttachModal
          open={addOpen}
          host={host.host}
          hostId={host.hostId}
          hostKey={host.hostKey}
          hostCwd={host.hostCwd}
          refId={host.refId}
          allow={host.allow}
          taskOptions={host.taskOptions}
          docOptions={host.docOptions}
          onClose={() => setAddOpen(false)}
          onDone={async () => {
            await onReload?.();
          }}
        />
      )}
    </div>
  );
}
