// 任务进程面板 —— 工作区里的**独立面板**（可拖到任意一边、可浮出、可单独关掉）。
//
// 每张卡片左侧带复选框：多选后批量删除（软删除，CLI localtask task restore 可恢复）。
// 点卡片 → 在工作区里开一个 MD 页签（不是切内部 tab）。
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { Icon } from '../../components/icons.jsx';
import { GLOBAL_KEY } from '../../../../modules/localtask/board.js';
import { STAGE_LABELS, taskToProgress } from './md-parse.js';
import { findOpenPanel } from '../../workspace.js';

function fmtElapsed(ms) {
  if (ms == null || ms < 0 || Number.isNaN(ms)) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 60) / 60);
  const sec = s % 60;
  if (h) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function elapsedOf(card, now) {
  const start = card.receivedAt ? Date.parse(card.receivedAt) : NaN;
  if (!Number.isFinite(start)) return '—';
  if (card.status === 'done' && card.finishedAt) {
    const end = Date.parse(card.finishedAt);
    return fmtElapsed((Number.isFinite(end) ? end : now) - start);
  }
  return fmtElapsed(now - start);
}

function stageChips(card) {
  return STAGE_LABELS.map((lab, i) => {
    let cls = 'todo';
    if (card.status === 'done' || i < card.stageIdx) cls = 'done';
    else if (i === card.stageIdx) cls = 'now';
    return (
      <span key={lab} className={'mdw-sg ' + cls}>
        {lab}
        {i < STAGE_LABELS.length - 1 ? <i className="mdw-sg-sep" /> : null}
      </span>
    );
  });
}

export default function ProgressPanel({ dirKey, rows = [], refreshLocal, model, onOpenTask, onClosePage }) {
  const isGlobal = !dirKey || dirKey === GLOBAL_KEY;
  const topic = useMemo(() => {
    if (isGlobal) return (rows || []).find((r) => r.isGlobal) || null;
    return (rows || []).find((r) => r.key === dirKey) || null;
  }, [rows, dirKey, isGlobal]);

  const tasks = useMemo(() => (topic?.tasks || []).filter((t) => !t.deletedAt), [topic]);

  const [now, setNow] = useState(Date.now());
  // 多选：存任务 id（不是下标——列表会重排，下标会指错任务）
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const cards = useMemo(() => {
    const list = tasks.map(taskToProgress);
    const order = { run: 0, wait: 1, done: 2 };
    return list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [tasks]);

  // 选中的任务可能已被别处删掉 → 只留还活着的编号（否则「删除所选」带着死编号）
  useEffect(() => {
    setPicked((prev) => {
      if (!prev.size) return prev;
      const alive = new Set(cards.map((c) => c.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [cards]);

  const live = cards.filter((c) => c.status === 'run' || c.status === 'wait');
  const running = cards.filter((c) => c.status === 'run').length;
  const waiting = cards.filter((c) => c.status === 'wait').length;
  const done = cards.filter((c) => c.status === 'done').length;
  const avg = cards.length
    ? Math.round(cards.reduce((s, c) => s + (c.pct || 0), 0) / cards.length)
    : 0;

  const allPicked = cards.length > 0 && picked.size === cards.length;
  const pickedCards = cards.filter((c) => picked.has(c.id));

  const togglePick = (id) => {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    setPicked(allPicked ? new Set() : new Set(cards.map((c) => c.id)));
  };

  // 批量删除（软删除）：一次请求逐条删，顺手关掉已打开的页签
  const delPicked = async () => {
    if (busy || !pickedCards.length) return;
    const ids = pickedCards.map((c) => c.id);
    const names = pickedCards.map((c) => `#${c.id} ${c.title}`);
    const shown = names.length <= 6 ? names.join('\n') : `${names.slice(0, 6).join('\n')}… 共 ${names.length} 条`;
    if (!confirm(`删除选中的 ${ids.length} 条任务？\n${shown}\n\n软删除：CLI localtask task restore 可恢复。`)) return;
    setBusy(true);
    try {
      const res = await api('/api/localtasks/items', {
        method: 'DELETE',
        body: { ...(isGlobal ? { key: GLOBAL_KEY } : { cwd: topic.cwd }), ids },
      });
      const n = res?.count ?? ids.length;
      const miss = res?.missing?.length ? `（${res.missing.length} 条已不存在）` : '';
      // 关掉这些任务的页签（开着的话）
      if (model) {
        for (const id of ids) {
          const page = findOpenPanel(model, 'page', { dirKey, task: String(id) });
          if (page && onClosePage) onClosePage(page.getId());
        }
      }
      setPicked(new Set());
      refreshLocal();
      alert(`已删除 ${n} 条任务${miss}`);
    } catch (e) {
      // 失败保留勾选，便于改了再试
      alert('删除失败: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const openTask = (id) => {
    if (onOpenTask) onOpenTask(id);
  };

  return (
    <div className="mdw-prog-host">
      <div className="mdw-prog-h">
        <span className="t">{topic?.name || (isGlobal ? '全局任务池' : '任务进程')}</span>
        {cards.length > 0 && (
          <button
            type="button"
            className="mdw-prog-all"
            onClick={toggleAll}
            title={allPicked ? '取消全选' : '全选任务'}
          >
            {allPicked ? '取消全选' : '全选'}
          </button>
        )}
      </div>
      <div className="mdw-prog-sum">
        <div className="pct-row">
          <span className="pct">{avg}%</span>
          <span className="stage">{cards.length ? (live.length ? `${live.length} 路并发` : '全部完成') : '暂无任务'}</span>
        </div>
        <div className="meta">
          <span>并发 <b>{live.length}</b></span>
          <span>跑 <b>{running}</b></span>
          <span>等 <b>{waiting}</b></span>
          <span>完 <b>{done}</b></span>
        </div>
        <div className="bar"><i style={{ width: `${avg}%` }} /></div>
      </div>
      {picked.size > 0 && (
        <div className="mdw-prog-sel">
          <span className="n">已选 <b>{picked.size}</b> / {cards.length}</span>
          <button type="button" className="mdw-prog-clear" onClick={() => setPicked(new Set())}>
            清除
          </button>
          <button type="button" className="mdw-prog-del" onClick={delPicked} disabled={busy}>
            <Icon name="trash" size={12} />
            删除所选
          </button>
        </div>
      )}
      <div className="mdw-prog-list">
        {!cards.length && (
          <div className="mdw-prog-empty">此目录还没有 MD 任务<br />写 MD 提交或导入</div>
        )}
        {cards.map((c) => {
          const on = picked.has(c.id);
          return (
            <div className={`mdw-tcard-row${on ? ' on' : ''}`} key={c.id}>
              <input
                type="checkbox"
                className="mdw-tcard-pick"
                checked={on}
                onChange={() => togglePick(c.id)}
                aria-label={`选择任务 #${c.id} ${c.title}`}
                title="选择此任务（可多选后批量删除）"
              />
              <button
                type="button"
                className={`mdw-tcard ${c.status}`}
                onClick={() => openTask(c.id)}
              >
                <div className="mdw-tcard-h">
                  <span className={`st ${c.status}`} />
                  <div className="titles">
                    <div className="n">{c.title}<span className="kind">md</span></div>
                    <div className="sub">{c.detail}</div>
                  </div>
                  <span className={`el ${c.status}`}>{elapsedOf(c, now)}</span>
                </div>
                <div className="mdw-tcard-bar"><i style={{ width: `${c.pct || 0}%` }} /></div>
                <div className="mdw-tcard-stages">{stageChips(c)}</div>
              </button>
            </div>
          );
        })}
      </div>
      <div className="mdw-prog-note">同一目录下任务<strong>并发</strong>。点卡打开对应 MD；勾选后可批量删除。</div>
    </div>
  );
}
