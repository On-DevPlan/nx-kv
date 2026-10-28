// 目录详情页（#/dir/<key>；key=__GLOBAL__ 时为全局任务池视图 #/global）。
// 布局与交互对齐 plan/uiux-redesign.html（R10）：顶栏 + 任务源切换（并列/仅本机/仅云端）
// + 本机四列看板（待领取/进行中/已领取/归档）+ 云端三列（待办/已完成/冻结）。
// 数据字段即真实模型：本机 {id,text,status,deletedAt,migratedTo,from,roundSummary,createdAt}、
// 云端 {id,topic,text,bucket,from,createdAt,note}。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { Icon } from '../../web/frontend/components/icons.jsx';
import { PopMenu } from '../../web/frontend/components/overlay.jsx';
import { MoveDialog } from '../../web/frontend/components/migrate/dialog.jsx';
import { useUndo } from '../../web/frontend/components/migrate/undo.jsx';
import { useDirMove } from '../../web/frontend/components/migrate/use-move.js';
import { useToast, useDialog } from '../../web/frontend/components/ui.jsx';
import { splitQueueTasks, GLOBAL_KEY } from './board.js';
import { TopBar, LocalCard, CloudColumns } from './dir-cards.jsx';
import { useCloudDir } from './use-cloud-dir.js';

const SRC_KEY = 'nx-kv-srcmode';
const loadMode = () => {
  try { return localStorage.getItem(SRC_KEY) || 'both'; } catch { return 'both'; }
};

function remainOf(untilMs, now) {
  if (!untilMs) return '';
  const ms = untilMs - now;
  if (ms <= 0) return '回填超时';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `剩 ${m}:${String(s).padStart(2, '0')}`;
}

export default function DirDetail({ dirKey, rows, refreshLocal, boot, onNavigate }) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const isGlobal = !dirKey || dirKey === GLOBAL_KEY;

  const topic = useMemo(() => {
    if (isGlobal) return rows.find((r) => r.isGlobal) || null;
    return rows.find((r) => r.key === dirKey) || null;
  }, [rows, dirKey, isGlobal]);

  const [mode, setMode] = useState(loadMode);
  const setModeP = (m) => { setMode(m); try { localStorage.setItem(SRC_KEY, m); } catch { /* 忽略 */ } };
  const [cloudAll, setCloudAll] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [now, setNow] = useState(Date.now());
  const [menu, setMenu] = useState(null);
  const [drag, setDrag] = useState(null);       // {side:'local'|'cloud', id, text, from}
  const [dropCol, setDropCol] = useState(null); // {col, zone}（zone 用于列内排序）
  const [dragPos, setDragPos] = useState(null); // {x,y,label}
  const inputRef = useRef(null);

  // ─── 云端数据（独立生命周期：拉取 / 未登录 / 不可达）───
  const { cloud, refetchCloud, cloudItems, cloudAdd, cloudDone, cloudFreeze, cloudUnfreeze, cloudRemove } =
    useCloudDir({ loggedIn: boot?.loggedIn, dirName: topic?.name || '', cloudAll, toast, dialog });

  // 倒计时：30s 一拍，足够「分钟级」的等待展示
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const refreshAll = useCallback(() => { refreshLocal(); refetchCloud(); }, [refreshLocal, refetchCloud]);

  const split = useMemo(() => splitQueueTasks(topic?.tasks || []), [topic]);
  const dirName = topic?.name || '';
  if (!topic && !isGlobal) {
    return (
      <div className="dir-wrap">
        <TopBar topic={null} onNavigate={onNavigate} />
        <div className="pane-error">
          <span className="big"><Icon name="warn" size={28} /></span>
          <div className="tx">目录不存在或已被移除。</div>
          <button className="btn ghost" onClick={() => onNavigate('#/overview')}>返回全部目录总览</button>
        </div>
      </div>
    );
  }

  // ─── 本机操作 ───
  const guard = (fn) => fn().catch((e) => toast(String(e.message || e)));
  const addLocal = (text) => guard(async () => {
    await api('/api/localtasks', {
      method: 'POST',
      body: isGlobal ? { global: true, text } : { cwd: topic.cwd, text },
    });
    refreshLocal();
  });
  const editSummary = () => guard(async () => {
    if (isGlobal) return;
    const cur = topic.summary || topic.submitSummary || '';
    const v = await dialog({ title: '编辑现状摘要', input: true, value: cur, placeholder: '这个目录现在什么状况（一句话）' });
    if (v === null) return;
    await api('/api/localtasks/topic', { method: 'POST', body: { cwd: topic.cwd, summary: v } });
    refreshLocal();
    toast('摘要已更新');
  });
  const removeTask = (id, purge) => guard(async () => {
    await api('/api/localtasks/item', { method: 'DELETE', body: { cwd: isGlobal ? undefined : topic.cwd, key: isGlobal ? GLOBAL_KEY : undefined, id, purge: !!purge } });
    refreshLocal();
  });
  const restoreTask = (id) => guard(async () => {
    await api('/api/localtasks/tasks/restore', { method: 'POST', body: { cwd: isGlobal ? undefined : topic.cwd, key: isGlobal ? GLOBAL_KEY : undefined, id } });
    refreshLocal();
  });
  const reorder = (id, beforeId, afterId) => guard(async () => {
    await api('/api/localtasks/reorder', { method: 'PATCH', body: { cwd: isGlobal ? undefined : topic.cwd, key: isGlobal ? GLOBAL_KEY : undefined, id, ...(beforeId ? { 'before-id': beforeId } : {}), ...(afterId ? { 'after-id': afterId } : {}) } });
    refreshLocal();
  });
  const cancelWait = () => guard(async () => {
    await api('/api/localtasks/cancel', { method: 'POST', body: { cwd: topic.cwd } });
    refreshLocal();
    toast('已关闭等待');
  });

  // ─── 迁移（发起/执行在 migrate/use-move.js；撤销通道来自 migrate/undo.jsx）───
  const { undo, node: undoNode } = useUndo({ onDone: refreshAll });
  const { moveDlg, setMoveDlg, flashId, setFlashId, failId, markFail, doMove, startMove, batchToCloud } =
    useDirMove({
      dirName: topic?.name || '',
      cwd: topic?.cwd,
      isGlobal,
      cloud,
      loggedIn: boot?.loggedIn,
      pending: split.pending,
      toast,
      refreshAll,
      undo,
    });

  // ─── 拖拽（跨栏迁移 + 列内排序）───
  const onCardDragStart = (e, payload) => {
    setDrag(payload);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', payload.side + ':' + (payload.id || payload.text));
  };
  const onCardDragEnd = () => { setDrag(null); setDropCol(null); setDragPos(null); };
  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      const label =
        drag.side === 'local' ? '迁入 云端待办' : '迁入 本机待领取';
      setDragPos({ x: e.clientX + 14, y: e.clientY + 12, label });
    };
    document.addEventListener('dragover', onMove);
    return () => document.removeEventListener('dragover', onMove);
  }, [drag]);

  const onLocalColDrop = (e) => {
    e.preventDefault();
    const d = drag;
    onCardDragEnd();
    if (!d || d.side !== 'cloud') return; // 列内排序走 onPendingDragOver/drop
    doMove({ from: 'cloud', to: 'local', topic: d.topic, text: d.text, cwd: isGlobal ? undefined : topic?.cwd, key: isGlobal ? GLOBAL_KEY : undefined })
      .catch(() => d.id && markFail(d.id));
  };
  const onCloudColDrop = (e) => {
    e.preventDefault();
    const d = drag;
    onCardDragEnd();
    if (!d || d.side !== 'local') return;
    doMove({ from: 'local', to: 'cloud', cwd: isGlobal ? undefined : topic?.cwd, key: isGlobal ? GLOBAL_KEY : undefined, id: d.id })
      .catch(() => d.id && markFail(d.id));
  };
  // 列内排序（仅待领取列）
  const reorderDrop = (e, targetId) => {
    e.preventDefault(); e.stopPropagation();
    const d = drag;
    onCardDragEnd();
    if (!d || d.side !== 'local-inner') return;
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientY - r.top > r.height / 2;
    reorder(d.id, after ? undefined : targetId, after ? targetId : undefined);
  };
  const showLocal = mode !== 'cloud';
  const showCloud = mode !== 'local' && !isGlobal;

  return (
    <div className="dir-wrap" data-view={isGlobal ? 'global' : 'dir'}>
      <div className="topbar">
        <button className="back" title="返回（Esc）" aria-label="返回" onClick={() => onNavigate('#/overview')}>
          <Icon name="back" size={16} />
        </button>
        <div className="tt">
          <div className="n">
            <Icon name={isGlobal ? 'globe' : 'folder'} size={15} />
            {topic?.name || '目录'}
            {topic?.waiting && (
              <span className="badge-wait">
                <span className="pulse" /> 等待回填 · {remainOf(topic.waitingUntilMs, now)}
              </span>
            )}
          </div>
          <div className="p mono">{topic?.cwd || '共享池（无固定目录）'}</div>
        </div>
        <button className="sum editable" title="点击编辑现状摘要" onClick={editSummary}>
          {topic?.summary || topic?.submitSummary || '（无现状摘要，点击填写）'}
        </button>
        {!isGlobal && (
          <div className="srcbar-inline">
            <div className="seg" role="tablist" aria-label="任务源切换">
              {['both', 'local', 'cloud'].map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} onClick={() => setModeP(m)}>
                  {m === 'both' ? '并列' : m === 'local' ? '仅本机' : '仅云端'}
                </button>
              ))}
            </div>
          </div>
        )}
        <button className="btn" onClick={() => inputRef.current && inputRef.current.focus()}>
          <Icon name="plus" size={13} /> 新任务
        </button>
        <button className="btn ghost" title="刷新" aria-label="刷新" onClick={refreshAll}>
          <Icon name="refresh" size={13} />
        </button>
      </div>

      <div id="panes">
        {showLocal && (
          <section className={'pane' + (showCloud ? '' : ' solo')}>
            <div className="pane-h">
              <span className="ico"><Icon name="monitor" size={14} /></span>
              <span className="t">本机队列</span>
              <span className="where">本机</span>
              <span className="grow" />
              <button
                className="mini" title="复制本列全部文本" aria-label="复制待领取文本"
                onClick={() => copyText(split.pending.map((t) => t.text).join('\n'))}
              >
                复制待领取
              </button>
            </div>
            <div className="pane-b">
              {/* 待领取 */}
              <div
                className={'col' + (drag && drag.side === 'cloud' ? ' drop-ok local-target' : '')}
                onDragOver={(e) => { if (drag?.side === 'cloud') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                onDrop={onLocalColDrop}
              >
                <div className="col-h">待领取 <span className="k">{split.pending.length} · 正序=领取优先级</span><span className="grow" /></div>
                <div className="col-b">
                  {split.pending.map((t) => (
                    <LocalCard key={t.id} t={t} {...commonCardProps(t)} draggable onDragStart={(e) => onCardDragStart(e, { side: 'local', id: t.id, text: t.text })} onDragEnd={onCardDragEnd}
                      onDragOver={(e) => { if (drag?.side === 'local-inner' && drag.id !== t.id) { e.preventDefault(); setDropCol({ col: 'pending', over: t.id }); } }}
                      onDrop={(e) => reorderDrop(e, t.id)}
                      insertAfter={dropCol?.col === 'pending' && dropCol.over === t.id && drag?.side === 'local-inner'}
                    />
                  ))}
                  {!split.pending.length && <div className="col-empty">队列为空，投一条任务或从云端迁入</div>}
                </div>
              </div>
              {/* 进行中（等待回填） */}
              {topic?.waiting && (
                <div className="col">
                  <div className="col-h">进行中 <span className="k">等待回填</span><span className="grow" /></div>
                  <div className="col-b">
                    <div className="card waitcard">
                      <div className="wt"><span className="pulse" /> agent 阻塞等待中 · {remainOf(topic.waitingUntilMs, now)}</div>
                      <div className="tx">{topic.summary || '（无现状摘要）'}</div>
                      <div className="meta">
                        <span className="tag waitt">{topic.staleWaiting ? '上次等待残留' : '回填即投递'}</span>
                        <span className="grow" />
                        <button className="mini" onClick={() => inputRef.current && inputRef.current.focus()}>去回填</button>
                        <button className="mini" onClick={cancelWait}>关闭等待</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {/* 已领取 */}
              <div className="col">
                <div className="col-h">已领取 <span className="k">{split.consumed.length} · 倒序</span><span className="grow" /></div>
                <div className="col-b">
                  {split.consumed.map((t) => (
                    <LocalCard key={t.id} t={t} {...commonCardProps(t)} />
                  ))}
                  {!split.consumed.length && <div className="col-empty">还没有被领取的任务</div>}
                </div>
              </div>
              {/* 归档（软删，默认折叠） */}
              <div className="col col-archive">
                <div className="col-h">
                  <button className="mini" aria-label={showArchive ? '收起归档列' : '展开归档列'} onClick={() => setShowArchive((v) => !v)}>
                    已删除 {split.deleted.length} {showArchive ? '▾' : '▸'}
                  </button>
                  <span className="grow" />
                </div>
                {showArchive && (
                  <div className="col-b">
                    {split.deleted.map((t) => (
                      <div key={t.id} className="card tomb">
                        <div className="tx">{t.text}</div>
                        <div className="meta">
                          <span className="mono">#{t.id}</span>
                          <span className="grow" />
                          <button className="mini" onClick={() => restoreTask(t.id)}>恢复到待领取</button>
                          <button className="mini" onClick={() => removeTask(t.id, true)}>彻底删除</button>
                        </div>
                      </div>
                    ))}
                    {!split.deleted.length && <div className="col-empty">没有已删除的任务</div>}
                  </div>
                )}
              </div>
            </div>
            <div className="newtask">
              <input
                ref={inputRef}
                placeholder={isGlobal ? '投一条任务到全局池（Enter；agent 在本地空时自动领取）' : `投一条任务到「${dirName}」队列（Enter）`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    const v = e.currentTarget.value.trim();
                    e.currentTarget.value = '';
                    addLocal(v);
                  }
                }}
              />
            </div>
          </section>
        )}

        {showCloud && (
          <section className="pane cloud">
            <div className="pane-h">
              <span className="ico"><Icon name="cloud" size={14} /></span>
              <span className="t">云端清单</span>
              <span className="where">{boot?.groupName || (boot?.groupId ? '#' + boot.groupId : '云端')}</span>
              <span className="grow" />
              <button className="mini" onClick={() => setCloudAll((v) => !v)}>{cloudAll ? '只看此目录' : '看全部 topic'}</button>
              <button className="mini" title="新增云端任务" aria-label="新增云端任务" onClick={cloudAdd}>＋</button>
              <button className="mini" title="刷新云端" aria-label="刷新云端" onClick={refetchCloud}><Icon name="refresh" size={12} /></button>
            </div>
            {cloud.state === 'guest' ? (
              <div className="login-empty">
                <span className="big"><Icon name="lock" size={30} /></span>
                <div className="tx">云端清单需登录（按工作空间 groupId 共享）</div>
                <button className="btn" onClick={() => onNavigate('#/auth')}>去登录</button>
              </div>
            ) : cloud.state === 'err' ? (
              <div className="pane-error">
                <span className="big"><Icon name="warn" size={28} /></span>
                <div className="tx">KV 后端不可达：{cloud.err}</div>
                <div className="tx faint">本机队列不受影响。</div>
                <button className="btn ghost" onClick={refetchCloud}>重试</button>
              </div>
            ) : (
              <CloudColumns
                drag={drag}
                onCloudColDrop={onCloudColDrop}
                cloudItems={cloudItems}
                batchToCloud={batchToCloud}
                startMove={startMove}
                copyText={copyText}
                cloudDone={cloudDone}
                cloudFreeze={cloudFreeze}
                cloudUnfreeze={cloudUnfreeze}
                cloudRemove={cloudRemove}
                flashId={flashId}
                failId={failId}
                onCardDragStart={onCardDragStart}
                onCardDragEnd={onCardDragEnd}
                setMenu={setMenu}
              />
            )}
          </section>
        )}
      </div>

      {menu && <PopMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {moveDlg && (
        <MoveDialog
          move={moveDlg.move}
          dups={moveDlg.dups}
          onConfirm={moveDlg.onConfirm}
          onClose={() => setMoveDlg(null)}
        />
      )}
      {undoNode}
      {dialogNode}
      {dragPos && (
        <div id="draghint" className="on" style={{ left: dragPos.x, top: dragPos.y }}>{dragPos.label}</div>
      )}
    </div>
  );

  // ─── 卡片通用属性（菜单装配）───
  function commonCardProps(t) {
    return {
      fail: failId === t.id,
      flash: flashId === t.id,
      expanded: expanded.has(t.id),
      toggleExpand: () =>
        setExpanded((s) => {
          const n = new Set(s);
          n.has(t.id) ? n.delete(t.id) : n.add(t.id);
          return n;
        }),
      menu: (p) => setMenu({ x: p.x, y: p.y, items: localCardMenu(t) }),
    };
  }
  function localCardMenu(t) {
    if (t.migratedTo) {
      return [
        { label: '跳到云端那条', icon: 'jump', onClick: () => { setModeP('both'); setFlashId('cloud:' + t.migratedTo.targetId); setTimeout(() => setFlashId(''), 1700); } },
        { label: '复制', icon: 'list', onClick: () => copyText(t.text) },
        'sep',
        { label: '移除迁出记录（彻底删除）', icon: 'trash', danger: true, onClick: () => removeTask(t.id, true) },
      ];
    }
    const items = [
      { label: '复制', icon: 'list', onClick: () => copyText(t.text) },
      { label: '编辑…', icon: 'edit', onClick: () => guard(async () => {
          const v = await dialog({ title: `编辑任务 #${t.id}`, input: true, value: t.text });
          if (!v || v === t.text) return;
          await api('/api/localtasks/item', { method: 'PATCH', body: { cwd: isGlobal ? undefined : topic.cwd, key: isGlobal ? GLOBAL_KEY : undefined, id: t.id, text: v } });
          refreshLocal();
        }) },
      'sep',
      { label: '删除（可恢复）', icon: 'trash', danger: true, onClick: () => removeTask(t.id, false) },
    ];
    if (t.status !== 'consumed') {
      items.unshift({ label: '迁移到云端…', icon: 'cloud', onClick: () => startMove('local', t) });
    }
    if (t.roundSummary) {
      items.splice(2, 0, { label: '复制领取回执', icon: 'list', onClick: () => copyText(t.roundSummary) });
    }
    return items;
  }
  function copyText(v) {
    navigator.clipboard?.writeText(String(v || '')).then(
      () => toast('已复制'),
      () => toast('复制失败（剪贴板不可用）')
    );
  }
}
