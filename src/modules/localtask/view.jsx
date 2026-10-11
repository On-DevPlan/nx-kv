// 本地任务（localtask）页：主题（按工作目录划分）总览 + 选中某个主题回填 + 该主题的任务队列。
// 本质是「agent 提交结果 → 阻塞 → 用户在 web 针对主题回填 → agent 接收」。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useToast, useGuard } from '../../web/frontend/components/ui.jsx';
import { CliHints } from '../../web/frontend/components/CliHints.jsx';

// “YYYY-MM-DD HH:mm:ss” → 本地 Date
function parseStamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}
function countdown(s) {
  const d = parseStamp(s);
  if (!d) return '';
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return '等待中 0:00';
  const mm = Math.floor(ms / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  return `等待中 ${mm}:${String(ss).padStart(2, '0')}`;
}

export default function SessionTaskView() {
  const toast = useToast();
  const guard = useGuard();

  const [overview, setOverview] = useState(null);
  const [activeKey, setActiveKey] = useState(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [timeoutSec, setTimeoutSec] = useState(180);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // 拖拽重排（仅待领取任务）
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null); // { id, pos:'top'|'bottom' }
  const [reordering, setReordering] = useState(false);

  // 主题勾选（批量删除）
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setOverview(await api('/api/localtasks'));
    } catch (e) {
      toast(e.message);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // 实时刷新：主题状态/倒计时、任务是否被取走，每 1.5s 轮询
  useEffect(() => {
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load]);

  const topics = overview ? overview.topics : [];

  // 同步页面上的超时配置（来源：后端 settings）
  useEffect(() => {
    if (overview && overview.settings) setTimeoutSec(overview.settings.timeoutSec);
  }, [overview]);

  const saveTimeout = (sec) =>
    guard(async () => {
      setTimeoutSec(Number(sec));
      setCfgSaving(true);
      try {
        const s = await api('/api/localtasks/setting', {
          method: 'PATCH',
          body: { timeout: Number(sec) },
        });
        setTimeoutSec(s.timeoutSec);
        toast(`等待超时已配置为 ${s.timeoutSec} 秒`);
      } finally {
        setCfgSaving(false);
      }
    });

  // 清理旧脏数据（旧模型无目录主题、空主题；等待中保留）
  const prune = () =>
    guard(async () => {
      setPruning(true);
      try {
        const r = await api('/api/localtasks/prune', { method: 'POST', body: {} });
        toast(r.count ? `已清理 ${r.count} 个旧主题` : '没有需要清理的旧数据');
        await load();
      } finally {
        setPruning(false);
      }
    });

  // 默认选中：优先等待中的，否则第一个；用户已选且仍存在则保留
  useEffect(() => {
    if (!topics.length) {
      setActiveKey(null);
      return;
    }
    if (activeKey && topics.some((t) => t.key === activeKey)) return;
    const w = topics.find((t) => t.waiting) || topics[0];
    setActiveKey(w.key);
  }, [topics, activeKey]);

  // 主题被删除后，从勾选集合里剔除失效 key
  useEffect(() => {
    setSelected((s) => {
      const valid = new Set([...s].filter((k) => topics.some((t) => t.key === k)));
      return valid.size === s.size ? s : valid;
    });
  }, [topics]);

  const active = topics.find((t) => t.key === activeKey) || null;

  const toggleSelect = (key) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const allSelected = topics.length > 0 && selected.size === topics.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(topics.map((t) => t.key)));

  const submit = () =>
    guard(async () => {
      const body = text.trim();
      if (!body) {
        toast('请输入任务内容');
        return;
      }
      if (!active) {
        toast('请先选择一个主题（工作目录）');
        return;
      }
      setSaving(true);
      try {
        const r = await api('/api/localtasks', {
          method: 'POST',
          body: { cwd: active.cwd, text: body },
        });
        setText('');
        toast(r.delivered ? '已返回给等待中的 agent' : '已排入该主题队列，等待 agent 下一次 wait');
        await load();
      } finally {
        setSaving(false);
      }
    });

  const remove = (id) =>
    guard(async () => {
      await api('/api/localtasks/item', {
        method: 'DELETE',
        body: { cwd: active.cwd, id },
      });
      toast('已删除');
      await load();
    });

  // 删除整个主题（卡片上的「删除主题」）；等待中需二次确认并 force
  const deleteTopic = (t) =>
    guard(async () => {
      const msg = t.waiting
        ? `主题「${t.name}」正在等待中，删除后其 agent 将超时收尾，确认删除？`
        : `删除主题「${t.name}」及其全部 ${t.total} 条任务？`;
      if (!window.confirm(msg)) return;
      setDeleting(true);
      try {
        await api('/api/localtasks/topic', {
          method: 'DELETE',
          body: t.waiting ? { key: t.key, force: true } : { key: t.key },
        });
        setSelected((s) => {
          const n = new Set(s);
          n.delete(t.key);
          return n;
        });
        toast('已删除主题');
        await load();
      } finally {
        setDeleting(false);
      }
    });

  // 批量删除勾选主题；含等待中时 force 并提示
  const batchDelete = () =>
    guard(async () => {
      if (!selected.size) return;
      const sel = topics.filter((t) => selected.has(t.key));
      const waitingCount = sel.filter((t) => t.waiting).length;
      let msg = `确认删除选中的 ${sel.length} 个主题？`;
      if (waitingCount) msg += `（其中 ${waitingCount} 个等待中，删除后其 agent 将超时收尾）`;
      if (!window.confirm(msg)) return;
      setDeleting(true);
      try {
        const r = await api('/api/localtasks/topics/remove', {
          method: 'POST',
          body: { keys: [...selected], force: waitingCount > 0 },
        });
        toast(
          `已删除 ${r.count} 个主题` + (r.skipped.length ? `，跳过 ${r.skipped.length} 个` : '')
        );
        setSelected(new Set());
        await load();
      } finally {
        setDeleting(false);
      }
    });

  const startEdit = (t) => {
    setEditingId(t.id);
    setEditText(t.text);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };
  const saveEdit = () =>
    guard(async () => {
      const body = editText.trim();
      if (!body) {
        toast('任务内容不能为空');
        return;
      }
      setEditSaving(true);
      try {
        await api('/api/localtasks/item', {
          method: 'PATCH',
          body: { cwd: active.cwd, id: editingId, text: body },
        });
        toast('已保存修改');
        setEditingId(null);
        await load();
      } finally {
        setEditSaving(false);
      }
    });

  const tasks = active ? active.tasks.slice().reverse() : [];

  // 待领取任务按「领取优先级」（数组真实顺序，未反转）排列；上移/置后据此定位相邻项
  const pendingOrder = active ? active.tasks.filter((t) => t.status !== 'consumed') : [];

  // 把 dragId 移到 beforeId 之前 / afterId 之后（数组顺序）
  const applyReorder = (id, { beforeId, afterId }) =>
    guard(async () => {
      setReordering(true);
      try {
        await api('/api/localtasks/reorder', {
          method: 'PATCH',
          body: { cwd: active.cwd, id, beforeId, afterId },
        });
        toast('已调整领取优先级');
        await load();
      } finally {
        setReordering(false);
        setDragId(null);
        setOver(null);
      }
    });

  // 提前/置后一步（在 pending 子序列里移动），作为拖拽之外的兜底（窄屏/触屏友好）
  const stepPriority = (t, dir) => {
    const i = pendingOrder.findIndex((x) => x.id === t.id);
    if (dir === 'up' && i > 0) applyReorder(t.id, { beforeId: pendingOrder[i - 1].id });
    if (dir === 'down' && i < pendingOrder.length - 1) applyReorder(t.id, { afterId: pendingOrder[i + 1].id });
  };

  // 表格反转显示：视觉上「上方」= 数组里更靠后。落点在目标行上半 → 拖到它数组之后；
  // 下半 → 拖到它数组之前。
  const onRowDragOver = (e, t) => {
    if (dragId === null || t.status === 'consumed' || dragId === t.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
    setOver((o) => (o && o.id === t.id && o.pos === pos ? o : { id: t.id, pos }));
  };
  const onRowDrop = (e, t) => {
    if (dragId === null || t.status === 'consumed' || dragId === t.id) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const top = e.clientY < rect.top + rect.height / 2;
    const moved = dragId;
    setDragId(null);
    setOver(null);
    applyReorder(moved, top ? { afterId: t.id } : { beforeId: t.id });
  };

  return (
    <>
      <div className="card" style={{ padding: '10px 14px' }}>
        <div className="muted" style={{ fontSize: 12 }}>
          agent 用法：完成当前任务后，把
          <code> nx-kv localtask wait --cwd "&lt;工作目录&gt;" --summary "&lt;当前现状&gt;" --json </code>
          作为本轮<strong>最后一个动作</strong>调用——工作目录即<strong>主题</strong>、主题拥有任务队列，
          同目录共用队列、不同目录互不串，任务可在队列里堆积；命令阻塞并自动打开浏览器弹窗，
          用户回填后解除阻塞、返回新任务；超时未回填则返回 <code>status:"timeout"</code>，agent 收尾结束本轮。
        </div>
      </div>

      <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>等待超时</span>
        <select
          value={timeoutSec}
          disabled={cfgSaving}
          onChange={(e) => saveTimeout(e.target.value)}
          style={{ font: 'inherit', padding: '5px 8px' }}
        >
          <option value={60}>1 分钟</option>
          <option value={120}>2 分钟</option>
          <option value={180}>3 分钟（推荐）</option>
          <option value={240}>4 分钟</option>
          <option value={300}>5 分钟</option>
          <option value={600}>10 分钟（最大）</option>
        </select>
        <span className="muted" style={{ fontSize: 12 }}>
          agent wait 未带 --timeout 时使用此值；推荐 3 分钟、最大 10 分钟。
        </span>
      </div>

      <div className="colhead">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          disabled={!topics.length}
          title="全选 / 取消全选"
          style={{ margin: 0 }}
        />
        <h3>主题总览（按工作目录）</h3>
        <span className="muted">{overview ? `${topics.length} 个 · 等待中 ${overview.waiting}` : ''}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            className="btn small ghost"
            onClick={batchDelete}
            disabled={!selected.size || deleting}
            title="删除勾选的主题（含其全部任务）"
          >
            {deleting ? '删除中…' : `批量删除${selected.size ? ` (${selected.size})` : ''}`}
          </button>
          <button
            className="btn small ghost"
            onClick={prune}
            disabled={pruning}
            title="清理旧模型无目录主题与空主题（等待中一律保留）"
          >
            {pruning ? '清理中…' : '清理旧数据'}
          </button>
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {topics.length ? (
          topics.map((t) => {
            const isActive = t.key === activeKey;
            return (
              <div
                key={t.key}
                onClick={() => setActiveKey(t.key)}
                className="card"
                style={{
                  textAlign: 'left',
                  width: 270,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  border: isActive ? '1px solid var(--ink,#14161a)' : '1px solid transparent',
                  boxShadow: isActive
                    ? '0 0 0 2px rgba(20,22,26,.12)'
                    : '0 1px 2px rgba(20,22,26,.06), 0 6px 16px rgba(20,22,26,.05)',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(t.key)}
                    onChange={() => toggleSelect(t.key)}
                    onClick={(e) => e.stopPropagation()}
                    title="选择以批量删除"
                    style={{ margin: '3px 0 0' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>{t.name || '（未命名）'}</div>
                    <div
                      className="mono muted"
                      title={t.cwd}
                      style={{ fontSize: 11, wordBreak: 'break-all', marginBottom: 6, minHeight: 15 }}
                    >
                      {t.cwd || '（旧数据，无目录）'}
                    </div>
                  </div>
                </div>
                {t.summary && (
                  <div className="muted" style={{ fontSize: 11, whiteSpace: 'pre-wrap', marginBottom: 6 }}>
                    现状：{t.summary}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {t.waiting ? (
                    <span className="tag strong">{countdown(t.waitingUntil)}</span>
                  ) : (
                    <span className="tag">已结束</span>
                  )}
                  <span className="muted" style={{ fontSize: 11 }}>
                    待领取 {t.pending}/{t.total}
                  </span>
                </div>
                <div
                  style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="btn small ghost"
                    onClick={() => deleteTopic(t)}
                    disabled={deleting}
                    title="删除整个主题（含全部任务）"
                  >
                    删除主题
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="card muted" style={{ padding: '20px 16px', width: '100%', textAlign: 'center' }}>
            （暂无主题；agent 调用 localtask wait 后会出现在这里）
          </div>
        )}
      </div>

      {active && (
        <>
          <div className="toolbar">
            <span style={{ fontWeight: 700, maxWidth: 240 }} title={active.cwd}>
              {active.name}
            </span>
            <span className="sep"></span>
            <textarea
              style={{ flex: 1, minWidth: 240, minHeight: 40, resize: 'vertical' }}
              spellCheck="false"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={`向主题「${active.name}」的队列回填下一条任务（Enter 提交，Shift+Enter 换行）`}
            />
            <button className="btn" onClick={submit} disabled={saving}>
              {saving ? '提交中…' : '回填新任务'}
            </button>
          </div>

          <div className="colhead">
            <h3>该主题的任务队列</h3>
            <span className="muted">待领取 {active.pending} · 共 {active.total} 条</span>
            <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
              拖拽待领取行（或用「提前/置后」）调整领取优先级
            </span>
          </div>

          <div className="card" style={{ padding: 4 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }}></th>
                  <th style={{ width: 56 }}>#</th>
                  <th>任务</th>
                  <th style={{ width: 80 }}>状态</th>
                  <th style={{ width: 160 }}>时间</th>
                  <th style={{ width: 150 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.length ? (
                  tasks.map((t) => {
                    const isPending = t.status !== 'consumed';
                    const isDrag = dragId === t.id;
                    const isOver = over && over.id === t.id;
                    return (
                    <tr
                      key={t.id}
                      draggable={isPending && editingId !== t.id}
                      onDragStart={(e) => {
                        setDragId(t.id);
                        e.dataTransfer.effectAllowed = 'move';
                        try { e.dataTransfer.setData('text/plain', String(t.id)); } catch { /* 某些浏览器需 setData 才能拖拽 */ }
                      }}
                      onDragOver={(e) => onRowDragOver(e, t)}
                      onDrop={(e) => onRowDrop(e, t)}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                      style={{
                        cursor: isPending && editingId !== t.id ? 'grab' : 'default',
                        opacity: isDrag ? 0.4 : 1,
                        boxShadow: isOver
                          ? over.pos === 'top'
                            ? 'inset 0 2px 0 var(--ink,#14161a)'
                            : 'inset 0 -2px 0 var(--ink,#14161a)'
                          : 'none',
                        background: isOver ? 'rgba(20,22,26,.04)' : undefined,
                      }}
                    >
                      <td className="mono muted" title="按住拖拽调整优先级" style={{ textAlign: 'center', userSelect: 'none' }}>
                        {isPending ? '⠿' : ''}
                      </td>
                      <td className="mono">#{t.id}</td>
                      <td style={{ whiteSpace: 'pre-wrap' }}>
                        {editingId === t.id ? (
                          <>
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                  e.preventDefault();
                                  saveEdit();
                                }
                                if (e.key === 'Escape') cancelEdit();
                              }}
                              spellCheck="false"
                              autoFocus
                              style={{ width: '100%', minHeight: 60, resize: 'vertical' }}
                            />
                            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                              <button className="btn small" onClick={saveEdit} disabled={editSaving}>
                                {editSaving ? '保存中…' : '保存'}
                              </button>
                              <button className="btn small ghost" onClick={cancelEdit} disabled={editSaving}>
                                取消
                              </button>
                              <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
                                Ctrl+Enter 保存 · Esc 取消
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            {t.text}
                            {t.roundSummary && (
                              <div
                                className="muted"
                                style={{ fontSize: 11, marginTop: 4, paddingTop: 4, borderTop: '1px dashed var(--line,#e6e8eb)', whiteSpace: 'pre-wrap' }}
                                title="该任务所回应的 agent 上一轮完成总结"
                              >
                                上一轮完成：{t.roundSummary}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td>
                        {t.status === 'consumed' ? (
                          <span className="tag strong">已领取</span>
                        ) : (
                          <span className="tag">待领取</span>
                        )}
                      </td>
                      <td className="mono">{t.consumedAt || t.createdAt}</td>
                      <td className="ops">
                        {isPending && editingId !== t.id && (() => {
                          const pi = pendingOrder.findIndex((x) => x.id === t.id);
                          return (
                            <>
                              <button className="btn small ghost" onClick={() => startEdit(t)}>编辑</button>
                              <button
                                className="btn small ghost"
                                title="提高优先级（更早被领取）"
                                disabled={reordering || pi <= 0}
                                onClick={() => stepPriority(t, 'up')}
                              >
                                提前
                              </button>
                              <button
                                className="btn small ghost"
                                title="降低优先级（更晚被领取）"
                                disabled={reordering || pi >= pendingOrder.length - 1}
                                onClick={() => stepPriority(t, 'down')}
                              >
                                置后
                              </button>
                            </>
                          );
                        })()}
                        <button className="btn small ghost" onClick={() => remove(t.id)}>删除</button>
                      </td>
                    </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="6" className="muted" style={{ textAlign: 'center', padding: '22px 0' }}>
                      （暂无任务，在上方回填第一条）
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <CliHints module="localtask" />
    </>
  );
}
