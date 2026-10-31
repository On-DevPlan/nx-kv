// 全部目录总览（#/overview）：筛选条（chip：目录名+待领取数+等待标记，**只筛选不跳转**）
// + 按目录分组的任务列表（待领取 + 可折叠的已领取历史）。
//
// 交互约定（2026-10-31 三次修订）：
//   1. **顶部 chip 只做筛选**：点 = 选中/取消该目录（多选），「全部」清空筛选。
//      不再点 chip 跳目录——进目录走分区标题链接，进任务详情点任务行。
//   2. **每行任务带状态 tag**（待领取 / 已领取 / 已迁移 / 已删除，口径与
//      splitQueueTasks / taskToProgress 一致）；已领取历史默认折叠，点开可见。
//   3. **批量删除的落点在底部操作条**：勾选任意行后出现（position:sticky），
//      跨目录一次删完（按目录分组逐个调 DELETE /api/localtasks/items）；
//      仍是软删除（CLI localtask task restore 可恢复）。分区头只留「全选」。
//   4. 任务行可点：直接进该任务的工作台详情（#/dir/<key>?task=<id>）；
//      已领取行同样可点（详情页以「已回填」进度卡呈现）。
import { useMemo, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { Icon } from '../../web/frontend/components/icons.jsx';
import { useToast } from '../../web/frontend/components/ui.jsx';
import { titleFromMd } from '../../web/frontend/modules/md-workspace/md-parse.js';
import { GLOBAL_KEY, splitQueueTasks } from './board.js';

const NO_IDS = new Set();

/** 任务状态 tag：与 board.splitQueueTasks、md-workspace taskToProgress 同一口径。 */
function statusTag(t) {
  if (t.deletedAt) return { label: '已删除', cls: 't-gone' };
  if (t.migratedTo) return { label: '已迁移', cls: 't-gone' };
  if (t.status === 'consumed') return { label: '已领取', cls: 't-done' };
  return { label: '待领取', cls: 't-pend' };
}

export default function Overview({ rows, onNavigate, refreshLocal }) {
  const toast = useToast();
  // 勾选状态：Map<分区 key, Set<任务编号>>。行会随轮询刷新而消失，所以计数与删除
  // 一律与「当前队列里仍存在且未删除」取交集，不额外做清理 effect。
  const [sel, setSel] = useState(() => new Map());
  // 筛选：选中的分区 key 集合；空集 = 全部。chip 只改这里，不做导航。
  const [filter, setFilter] = useState(() => new Set());
  // 「已领取」历史折叠：展开的分区 key 集合（默认全收起）。
  const [doneOpen, setDoneOpen] = useState(() => new Set());

  const dirs = useMemo(() => rows.filter((r) => !r.isGlobal), [rows]);
  const globalRow = rows.find((r) => r.isGlobal);
  const totalPending = dirs.reduce((n, r) => n + (r.pending || 0), 0) + (globalRow?.pending || 0);
  const waiting = rows.filter((r) => r.waiting);

  const secKeyOf = (r) => (r.isGlobal ? GLOBAL_KEY : r.key);

  // 跨目录的当前选中总数（只数仍存在且未删除的）
  const selCount = useMemo(() => {
    let n = 0;
    for (const r of rows) {
      const cur = sel.get(secKeyOf(r));
      if (!cur || !cur.size) continue;
      for (const t of r.tasks || []) if (cur.has(Number(t.id)) && !t.deletedAt) n += 1;
    }
    return n;
  }, [rows, sel]);

  const idsOf = (secKey) => sel.get(secKey) || NO_IDS;
  const pickedOf = (secKey, pending) => {
    const cur = idsOf(secKey);
    return cur.size ? pending.map((t) => Number(t.id)).filter((id) => cur.has(id)) : [];
  };

  const toggleOne = (secKey, id) => {
    setSel((prev) => {
      const next = new Map(prev);
      const cur = new Set(next.get(secKey) || []);
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      if (cur.size) next.set(secKey, cur);
      else next.delete(secKey);
      return next;
    });
  };

  const toggleAll = (secKey, pending, clear) => {
    setSel((prev) => {
      const next = new Map(prev);
      if (clear) next.delete(secKey);
      else next.set(secKey, new Set(pending.map((t) => Number(t.id))));
      return next;
    });
  };

  const toggleFilter = (key) => {
    setFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleDone = (secKey) => {
    setDoneOpen((prev) => {
      const next = new Set(prev);
      if (next.has(secKey)) next.delete(secKey);
      else next.add(secKey);
      return next;
    });
  };

  /** 底部操作条的删除：把选中项按目录分组，逐组调批量删除接口。 */
  const dropAll = async () => {
    const groups = [];
    for (const r of rows) {
      const key = secKeyOf(r);
      const cur = sel.get(key);
      if (!cur || !cur.size) continue;
      const ids = (r.tasks || [])
        .filter((t) => cur.has(Number(t.id)) && !t.deletedAt)
        .map((t) => Number(t.id));
      if (ids.length) groups.push({ key, name: r.name || key, ids });
    }
    const total = groups.reduce((n, g) => n + g.ids.length, 0);
    if (!total) return;
    const scope = groups.length > 1 ? `（跨 ${groups.length} 个目录）` : '';
    if (!confirm(`删除 ${total} 条任务${scope}？\n软删除：CLI localtask task restore 可恢复。`)) return;
    let n = 0;
    let miss = 0;
    const errs = [];
    for (const g of groups) {
      try {
        const r = await api('/api/localtasks/items', { method: 'DELETE', body: { key: g.key, ids: g.ids } });
        n += Number(r?.count ?? 0);
        miss += (r?.missing || []).length;
      } catch (e) {
        const msg = String(e.message || e);
        // 路由在 serve 进程启动时加载：跑着旧进程时静态资产是新的、接口是旧的
        if (/接口不存在/.test(msg)) {
          toast('本机面板服务较旧，重启面板后再试（批量删除接口未上线）');
          return;
        }
        errs.push(`${g.name}: ${msg}`);
      }
    }
    if (errs.length) {
      toast(`已删除 ${n} 条；${errs.length} 个目录失败：${errs[0]}${errs.length > 1 ? ` 等 ${errs.length} 项` : ''}`);
    } else {
      toast(`已删除 ${n} 条${miss ? `（${miss} 条未找到，可能已被删除）` : ''}`);
    }
    setSel(new Map());
    refreshLocal?.();
  };

  const openTask = (base, id) => onNavigate(`${base}?task=${encodeURIComponent(id)}`);
  const dirBase = (key) => '#/dir/' + encodeURIComponent(key);
  const shown = (key) => !filter.size || filter.has(key);

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
        <span className="ov-filter-label">筛选</span>
        <button
          type="button"
          className={'ov-chip' + (!filter.size ? ' on' : '')}
          onClick={() => setFilter(new Set())}
          title="显示全部目录"
        >
          全部
        </button>
        {globalRow && (
          <button
            type="button"
            className={'ov-chip' + (filter.has(GLOBAL_KEY) ? ' on' : '') + (globalRow.waiting ? ' wait' : '')}
            onClick={() => toggleFilter(GLOBAL_KEY)}
            title="筛选：只看全局任务"
          >
            <Icon name="globe" size={13} /> 全局任务
            <span className="c">{globalRow.pending || 0}</span>
            {globalRow.waiting && <span className="wdot" />}
          </button>
        )}
        {dirs.map((d) => (
          <button
            type="button"
            key={d.key}
            className={'ov-chip' + (filter.has(d.key) ? ' on' : '') + (d.waiting ? ' wait' : '')}
            onClick={() => toggleFilter(d.key)}
            title={`筛选：${filter.has(d.key) ? '取消' : '只看'}「${d.name}」`}
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

      {globalRow && shown(GLOBAL_KEY) && ((globalRow.pending || 0) > 0 || globalRow.waiting) && (
        <Sec
          secKey={GLOBAL_KEY}
          icon="globe"
          title="全局任务"
          cwd=""
          tasks={globalRow.tasks}
          waiting={!!globalRow.waiting}
          selected={pickedOf(GLOBAL_KEY, splitQueueTasks(globalRow.tasks || []).pending)}
          doneOpen={doneOpen.has(GLOBAL_KEY)}
          onToggle={(id) => toggleOne(GLOBAL_KEY, id)}
          onToggleAll={(clear, pending) => toggleAll(GLOBAL_KEY, pending, clear)}
          onToggleDone={() => toggleDone(GLOBAL_KEY)}
          onOpenDir={() => onNavigate('#/global')}
          onOpenTask={(id) => openTask('#/global', id)}
        />
      )}

      {dirs.map((d) => {
        const split = splitQueueTasks(d.tasks || []);
        if (!shown(d.key)) return null;
        if (!split.pending.length && !d.waiting) return null;
        return (
          <Sec
            key={d.key}
            secKey={d.key}
            icon="folder"
            title={d.name}
            cwd={d.cwd}
            tasks={d.tasks}
            waiting={!!d.waiting}
            selected={pickedOf(d.key, split.pending)}
            doneOpen={doneOpen.has(d.key)}
            onToggle={(id) => toggleOne(d.key, id)}
            onToggleAll={(clear, pending) => toggleAll(d.key, pending, clear)}
            onToggleDone={() => toggleDone(d.key)}
            onOpenDir={() => onNavigate(dirBase(d.key))}
            onOpenTask={(id) => openTask(dirBase(d.key), id)}
          />
        );
      })}

      {filter.size > 0 &&
        !((globalRow && shown(GLOBAL_KEY) && ((globalRow.pending || 0) > 0 || globalRow.waiting)) ||
          dirs.some((d) => shown(d.key) && (splitQueueTasks(d.tasks || []).pending.length || d.waiting))) && (
        <div className="muted" style={{ padding: '12px 4px' }}>没有匹配当前筛选的目录。</div>
      )}

      {selCount > 0 && (
        <div className="ov-bar" role="toolbar" aria-label="批量删除操作条">
          <span className="ov-bar-n">
            已选 <b>{selCount}</b> 条任务
          </span>
          <span className="grow" />
          <button type="button" className="mini" onClick={() => setSel(new Map())}>
            取消选择
          </button>
          <button type="button" className="btn small danger" onClick={dropAll}>
            删除选中 {selCount}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 一个目录分区：标题（可点进落地页）+ 计数 + 全选 + 待领取行 + 可折叠的已领取历史。
 * `selected` 是**已经与当前待领取取过交集**的编号数组，全选判定只看它。
 */
function Sec({ secKey, icon, title, cwd, tasks, waiting, selected, doneOpen, onToggle, onToggleAll, onToggleDone, onOpenDir, onOpenTask }) {
  const split = splitQueueTasks(tasks || []);
  const pending = split.pending;
  const consumed = split.consumed;
  const on = new Set(selected);
  const allOn = pending.length > 0 && pending.every((t) => on.has(Number(t.id)));
  const someOn = on.size > 0 && !allOn;

  return (
    <section className="ov-sec" data-sec={secKey}>
      <div className="ov-sec-h">
        <Icon name={icon} size={13} />
        <button type="button" className="ov-sec-t" onClick={onOpenDir} title={`进入「${title}」`}>
          {title}
        </button>
        {cwd ? <span className="c mono">{cwd}</span> : null}
        <span className="c">{pending.length} 待领取</span>
        {waiting && (
          <span className="badge-wait">
            <span className="pulse" /> 等待回填
          </span>
        )}
        <span className="grow" />
        {pending.length > 0 && (
          <label className="ov-all">
            <input
              type="checkbox"
              checked={allOn}
              ref={(el) => {
                if (el) el.indeterminate = someOn;
              }}
              onChange={() => onToggleAll(allOn, pending)}
              aria-label={`全选「${title}」的待领取任务`}
            />
            全选
          </label>
        )}
      </div>

      {!pending.length && <div className="ov-task muted">（队列为空）</div>}
      {pending.map((t) => (
        <TaskRow key={t.id} t={t} checked={on.has(Number(t.id))} onToggle={onToggle} onOpenTask={onOpenTask} />
      ))}

      {consumed.length > 0 && (
        <>
          <button type="button" className="ov-done-toggle" onClick={onToggleDone} aria-expanded={doneOpen}>
            <span className={'tri' + (doneOpen ? ' open' : '')} aria-hidden="true">
              ▸
            </span>
            已领取 {consumed.length}
          </button>
          {doneOpen &&
            consumed.map((t) => (
              <TaskRow
                key={t.id}
                t={t}
                checked={on.has(Number(t.id))}
                onToggle={onToggle}
                onOpenTask={onOpenTask}
                meta={t.consumedAt ? String(t.consumedAt).slice(5, 16) : ''}
              />
            ))}
        </>
      )}
    </section>
  );
}

/** 一行任务：勾选框 + 编号 + 标题 + （云端来源 tag）+ （时间）+ 状态 tag。整行可点进详情。 */
function TaskRow({ t, checked, onToggle, onOpenTask, meta = '' }) {
  const tag = statusTag(t);
  return (
    <div
      className="ov-task link"
      role="button"
      tabIndex={0}
      title="打开任务详情"
      onClick={() => onOpenTask(t.id)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onOpenTask(t.id);
      }}
    >
      <label className="ov-ck" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={() => onToggle(Number(t.id))} aria-label={`选择 #${t.id}`} />
      </label>
      <span className="mono faint">#{t.id}</span>
      <span className="tx" title={t.text}>
        {titleFromMd(t.text, t.text || '未命名任务')}
      </span>
      {t.from === 'cloud' && <span className="tag t-cloud">云端</span>}
      {meta ? <span className="m mono">{meta}</span> : null}
      <span className={'tag ' + tag.cls}>{tag.label}</span>
    </div>
  );
}
