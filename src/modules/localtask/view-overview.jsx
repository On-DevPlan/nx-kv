// 全部目录总览（#/overview）：目录概览条（chip：名称+待领取数+等待标记）
// + 按目录分组的待领取列表（v1 跨目录视角的接棒者）。
import { useMemo } from 'react';
import { Icon } from '../../web/frontend/components/icons.jsx';
import { splitQueueTasks } from './board.js';

export default function Overview({ rows, onNavigate }) {
  const dirs = useMemo(() => rows.filter((r) => !r.isGlobal), [rows]);
  const globalRow = rows.find((r) => r.isGlobal);
  const totalPending = dirs.reduce((n, r) => n + (r.pending || 0), 0) + (globalRow?.pending || 0);
  const waiting = rows.filter((r) => r.waiting);

  return (
    <div className="ov-wrap">
      <div className="ov-head">
        <h2>全部目录总览</h2>
        <span className="muted">
          {dirs.length} 个目录 · 待领取 {totalPending}
          {waiting.length ? ` · ${waiting.length} 个等待回填` : ''}
        </span>
      </div>

      <div className="ov-chips">
        {globalRow && (
          <button className="ov-chip" onClick={() => onNavigate('#/global')}>
            <Icon name="globe" size={13} /> 全局任务
            <span className="c">{globalRow.pending || 0}</span>
            {globalRow.waiting && <span className="wdot" />}
          </button>
        )}
        {dirs.map((d) => (
          <button
            key={d.key}
            className={'ov-chip' + (d.waiting ? ' wait' : '')}
            onClick={() => onNavigate('#/dir/' + encodeURIComponent(d.key))}
            title={d.cwd}
          >
            <Icon name="folder" size={13} /> {d.name}
            <span className="c">{d.pending || 0}</span>
            {d.waiting && <span className="wdot" />}
          </button>
        ))}
        {!dirs.length && !globalRow && (
          <span className="muted">暂无目录：在侧边栏点 ＋ 添加，或让 agent 在任意目录提交任务。</span>
        )}
      </div>

      {globalRow && (globalRow.pending || 0) > 0 && (
        <section className="ov-sec">
          <div className="ov-sec-h">
            <Icon name="globe" size={13} /> 全局任务
            <span className="c">{globalRow.pending} 待领取</span>
            <span className="grow" />
            <button className="mini" onClick={() => onNavigate('#/global')}>打开</button>
          </div>
          {(globalRow.tasks || []).slice(0, 0).map(() => null)}
          <PendingList tasks={globalRow.tasks} />
        </section>
      )}

      {dirs.map((d) => {
        const split = splitQueueTasks(d.tasks || []);
        if (!split.pending.length && !d.waiting) return null;
        return (
          <section className="ov-sec" key={d.key}>
            <div className="ov-sec-h">
              <Icon name="folder" size={13} /> {d.name}
              <span className="c mono">{d.cwd}</span>
              <span className="c">{split.pending.length} 待领取</span>
              {d.waiting && <span className="badge-wait"><span className="pulse" /> 等待回填</span>}
              <span className="grow" />
              <button className="mini" onClick={() => onNavigate('#/dir/' + encodeURIComponent(d.key))}>打开</button>
            </div>
            <PendingList tasks={d.tasks} />
          </section>
        );
      })}
    </div>
  );
}

function PendingList({ tasks }) {
  const split = splitQueueTasks(tasks || []);
  if (!split.pending.length) return <div className="ov-task muted">（队列为空）</div>;
  return (
    <>
      {split.pending.map((t) => (
        <div className="ov-task" key={t.id}>
          <span className="mono faint">#{t.id}</span>
          <span className="tx" title={t.text}>{t.text}</span>
          <span className="m mono">{t.from === 'cloud' ? '来自云端' : ''}</span>
        </div>
      ))}
    </>
  );
}
