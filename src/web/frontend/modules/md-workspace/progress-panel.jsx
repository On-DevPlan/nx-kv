// 右侧内嵌「并发任务进程」——与主编辑区并排，不再 fixed 遮挡。
import { useEffect, useMemo, useState } from 'react';
import { STAGE_LABELS, taskToProgress } from './md-parse.js';

function fmtElapsed(ms) {
  if (ms == null || ms < 0 || Number.isNaN(ms)) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
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

export default function ProgressPanel({
  dirName,
  tasks = [],
  focusId,
  open,
  onToggle,
  onOpenTask,
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const cards = useMemo(() => {
    const list = (tasks || [])
      .filter((t) => !t.deletedAt)
      .map(taskToProgress);
    const order = { run: 0, wait: 1, done: 2 };
    return list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [tasks]);

  const live = cards.filter((c) => c.status === 'run' || c.status === 'wait');
  const running = cards.filter((c) => c.status === 'run').length;
  const waiting = cards.filter((c) => c.status === 'wait').length;
  const done = cards.filter((c) => c.status === 'done').length;
  const avg = cards.length
    ? Math.round(cards.reduce((s, c) => s + (c.pct || 0), 0) / cards.length)
    : 0;

  if (!open) {
    return (
      <button
        type="button"
        className="mdw-prog-rail"
        title="展开任务进程"
        aria-label="展开任务进程"
        onClick={() => onToggle(true)}
      >
        <span className="pulse" />
        <span className="tx">进程</span>
        {live.length > 0 && <span className="n">{live.length}</span>}
      </button>
    );
  }

  return (
    <aside id="mdw-prog" aria-label="任务进程">
      <div className="mdw-prog-h">
        <span className="t">{dirName || '任务进程'}</span>
        <button type="button" className="iconbtn" title="收起" aria-label="收起" onClick={() => onToggle(false)}>
          ⟩
        </button>
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
      <div className="mdw-prog-list">
        {!cards.length && (
          <div className="mdw-prog-empty">此目录还没有 MD 任务<br />写 MD 提交或导入</div>
        )}
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`mdw-tcard ${c.status}${focusId === c.id ? ' focus' : ''}`}
            onClick={() => onOpenTask?.(c.id)}
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
        ))}
      </div>
      <div className="mdw-prog-note">同一目录下任务<strong>并发</strong>。点卡打开对应 MD。</div>
    </aside>
  );
}
