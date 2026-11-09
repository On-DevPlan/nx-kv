// 全部目录总览（#/overview）：**一张未完成任务的清单**（#112）。
//
// 口径：只显示当前**未完成**的任务（待领取 + 在干）——已交付/已取消不再占屏；
// 项目分组（每目录一节）与项目/全局筛选 chip 一并撤掉：总览回答的是
// 「现在还有什么在等我」，一屏平铺看完，每行带项目 tag 说明它来自哪个目录。
//
// 交互约定（2026-10-31 三次修订，#112 收敛）：
//   1. **每行任务带状态 tag**（待领取 / 已领取，口径与 splitQueueTasks 一致）；
//      行可点：直接进该任务的工作台详情（#/dir/<key>?task=<id>）。
//   2. **批量删除的落点在底部操作条**：勾选任意行后出现（position:sticky），
//      跨目录一次删完（按目录分组逐个调 DELETE /api/localtasks/items）；
//      仍是软删除（CLI localtask task restore 可恢复）。
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { titleFromMd } from '../../modules/md/md-parse.js';
import { GLOBAL_KEY, splitQueueTasks, projectTasks, isPendingRow } from '../../modules/board/board-view.js';

/** 任务状态 tag：与 board.splitQueueTasks、md-workspace taskToProgress 同一口径。 */
function statusTag(t) {
  if (t.deletedAt) return { label: '已删除', cls: 't-gone' };
  if (t.migratedTo) return { label: '已迁移', cls: 't-gone' };
  if (t.status === 'done') return { label: '已交付', cls: 't-done' };
  if (t.status === 'claimed') return { label: '已领取', cls: 't-done' };
  if (t.status === 'cancelled') return { label: '已取消', cls: 't-gone' };
  return { label: '待领取', cls: 't-pend' };
}

export default function Overview({ rows, onNavigate, refreshLocal }) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  // 勾选状态：Set<任务编号>（扁平清单只有一份选择）。
  const [sel, setSel] = useState(() => new Set());

  // #85 两种走向：总览是**项目走向**的页面——组任务（frontmatter.board）归组页管，
  // 列表与计数按「剔除组任务」后的视图走（pending 一并在客户端按走向重数；
  // 全局池不会有组任务，同样过滤无害）。其余字段原样透传。
  const view = useMemo(
    () =>
      rows.map((r) => {
        const tasks = projectTasks(r.tasks);
        return { ...r, tasks, pending: tasks.filter(isPendingRow).length };
      }),
    [rows]
  );

  /**
   * 扁平清单（#112）：**只留未完成**的任务（待领取 + 在干），
   * 按目录顺序 → 待领取在前 → 编号。每行记下它来自哪个目录（项目 tag）。
   */
  const flat = useMemo(() => {
    const out = [];
    for (const r of view) {
      const split = splitQueueTasks(r.tasks || []);
      const base = r.isGlobal ? '#/global' : '#/dir/' + encodeURIComponent(r.key);
      for (const t of [...split.pending, ...split.claimed]) {
        out.push({
          t,
          secKey: r.isGlobal ? GLOBAL_KEY : r.key,
          proj: r.isGlobal ? '全局' : (r.name || r.key),
          cwd: r.cwd || '',
          waiting: !!r.waiting,
          base,
        });
      }
    }
    return out;
  }, [view]);

  const waitingDirs = useMemo(() => view.filter((r) => r.waiting).length, [view]);
  const pendingCount = useMemo(() => flat.filter((f) => f.t.status !== 'claimed').length, [flat]);

  // 勾选只认「清单里还在的行」——行会随轮询刷新而消失。
  const picked = useMemo(() => {
    const ids = new Set(flat.map((f) => Number(f.t.id)));
    return [...sel].filter((id) => ids.has(id));
  }, [sel, flat]);
  const selCount = picked.length;

  const toggleOne = (id) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = (clear) => {
    setSel(clear ? new Set() : new Set(flat.map((f) => Number(f.t.id))));
  };
  const allOn = flat.length > 0 && picked.length === flat.length;

  /** 底部操作条的删除：把选中项按目录分组，逐组调批量删除接口。 */
  const dropAll = async () => {
    const pickedSet = new Set(picked);
    const groups = [];
    for (const f of flat) {
      if (!pickedSet.has(Number(f.t.id))) continue;
      let g = groups.find((x) => x.key === f.secKey);
      if (!g) {
        g = { key: f.secKey, name: f.proj, ids: [] };
        groups.push(g);
      }
      g.ids.push(Number(f.t.id));
    }
    const total = groups.reduce((n, g) => n + g.ids.length, 0);
    if (!total) return;
    const scope = groups.length > 1 ? `（跨 ${groups.length} 个目录）` : '';
    const ok = await dialog({
      title: `删除 ${total} 条任务${scope}`,
      message: '软删除：CLI localtask task restore 可恢复。',
      danger: true,
      okText: '删除',
    });
    if (!ok) return;
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
    setSel(new Set());
    refreshLocal?.();
  };

  const openTask = (base, id) => onNavigate(`${base}?task=${encodeURIComponent(id)}`);

  return (
    <div className="ov-wrap">
      <RouteBreadcrumb />
      {dialogNode}
      <div className="ov-head">
        <h2>全部目录总览</h2>
        <span className="muted">
          {flat.length} 个未完成任务（待领取 {pendingCount}）
          {waitingDirs ? ` · ${waitingDirs} 个目录等待回填` : ''}
        </span>
        {flat.length > 0 && (
          <label className="ov-all">
            <input
              type="checkbox"
              checked={allOn}
              ref={(el) => {
                if (el) el.indeterminate = !allOn && selCount > 0;
              }}
              onChange={() => toggleAll(allOn)}
              aria-label="全选未完成任务"
            />
            全选
          </label>
        )}
      </div>

      {!flat.length ? (
        <div className="ov-task muted">
          没有未完成的任务——当前队列都清空了。在侧边栏点 ＋ 添加目录，或让 agent 在任意目录提交任务。
        </div>
      ) : (
        <div className="ov-list">
          {flat.map((f) => (
            <TaskRow
              key={`${f.secKey}-${f.t.id}`}
              t={f.t}
              proj={f.proj}
              waiting={f.waiting}
              checked={sel.has(Number(f.t.id))}
              onToggle={toggleOne}
              onOpenTask={(id) => openTask(f.base, id)}
              meta={f.t.status === 'claimed' && f.t.consumedAt ? String(f.t.consumedAt).slice(5, 16) : ''}
            />
          ))}
        </div>
      )}

      {selCount > 0 && (
        <div className="ov-bar" role="toolbar" aria-label="批量删除操作条">
          <span className="ov-bar-n">
            已选 <b>{selCount}</b> 条任务
          </span>
          <span className="grow" />
          <button type="button" className="mini" onClick={() => setSel(new Set())}>
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

/** 一行任务：勾选框 + 编号 + 标题 + 项目 tag + （时间）+ 状态 tag。整行可点进详情。 */
function TaskRow({ t, proj, waiting, checked, onToggle, onOpenTask, meta = '' }) {
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
      {proj ? (
        <span className="tag t-proj" title="所属项目">
          {proj}
          {waiting ? <span className="wdot" /> : null}
        </span>
      ) : null}
      {t.from === 'cloud' && <span className="tag t-cloud">云端</span>}
      {meta ? <span className="m mono">{meta}</span> : null}
      <span className={'tag ' + tag.cls}>{tag.label}</span>
    </div>
  );
}
