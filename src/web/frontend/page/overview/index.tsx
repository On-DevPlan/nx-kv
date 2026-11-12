// 全部目录总览（#/overview）：**一张未完成任务的清单**（#112）。
//
// 口径：只显示当前**未完成**的任务（待领取 + 在干）——已完成/已取消不再占屏；
// 项目分组（每目录一节）撤掉，每行带项目 tag 说明它来自哪个目录。
// #120：行内项目 tag 聚合出**项目 tab 筛选器**（头部下方，「全部」+ 各项目
// 带计数）——任务一多时按项目收窄视野；计数/勾选/批量删除跟随过滤后清单。
// #125：**组任务也进总览**。#85 曾把组任务（frontmatter.board，行上
// boardMark）划给组页管，总览只留项目任务——但走组板流转的用户在总览里
// 一条任务都看不见（「明明有任务，却没有看见」）。现在扁平清单收全量未
// 完成（组 + 项目），组任务行带「组」tag，点击进组任务详情路由
//（#/group/<boardMark>?task=N，#86 口径）；项目 tag 仍是物理所在队列。
//
// 交互约定（2026-10-31 三次修订，#112 收敛）：
//   1. **每行任务带状态 tag**（待领取 / 已领取，口径与 splitQueueTasks 一致；
//      #121 起渲染走统一组件 components/status-tag——蓝=进行中、绿=已完成、浅灰=待领取）；
//      行可点：直接进该任务的工作台详情（#/dir/<key>?task=<id>）。
//   2. **批量删除的落点在底部操作条**：勾选任意行后出现（position:sticky），
//      跨目录一次删完（按目录分组逐个调 DELETE /api/localtasks/items）；
//      仍是软删除（CLI localtask task restore 可恢复）。
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { useMemo, useState } from 'react';
import { removeTasks } from './api.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import StatusTag from '../../components/status-tag/index.jsx';
import { titleFromMd } from '../../modules/md/md-parse.js';
import { GLOBAL_KEY, splitQueueTasks } from '../../modules/board/board-view.js';
import type { LocalTask, LocalTopic } from '../../types.js';

/** 扁平清单的一行：任务 + 它来自哪个目录（项目 tag / 路由前缀）。 */
interface FlatRow {
  t: LocalTask;
  secKey: string;
  proj: string;
  cwd: string;
  waiting: boolean;
  base: string;
}

interface OverviewProps {
  rows?: LocalTopic[];
  onNavigate?: (hash: string) => void;
  refreshLocal?: () => Promise<void>;
}

// splitQueueTasks 尚未类型化（默认参数被推断为 never[]），在调用边界上换成实际形状
const splitTasks = splitQueueTasks as unknown as (tasks: LocalTask[]) => {
  pending: LocalTask[];
  claimed: LocalTask[];
};

export default function Overview({ rows, onNavigate, refreshLocal }: OverviewProps) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  // 勾选状态：Set<任务编号>（扁平清单只有一份选择）。
  const [sel, setSel] = useState<Set<number>>(() => new Set());
  // 项目 tab 筛选（#120）：'' = 全部；其余值 = flat 里 proj 的原样字符串。
  const [projSel, setProjSel] = useState('');

  /**
   * 扁平清单（#112）：**只留未完成**的任务（待领取 + 在干），
   * 按目录顺序 → 待领取在前 → 编号。每行记下它来自哪个目录（项目 tag）。
   * #125 起**组任务一并进来**（boardMark 在行的原样任务上，splitQueueTasks
   * 已把软删除/迁出挡在外面，不需要再按走向剔除——#85 的「组任务归组页」
   * 仍成立：组页照常管理，总览只是多一个能看见它们的窗口）。
   */
  const flat = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const r of rows || []) {
      const split = splitTasks(r.tasks || []);
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
  }, [rows]);

  const waitingDirs = useMemo(() => (rows || []).filter((r) => r.waiting).length, [rows]);

  // 项目 tab（#120）：按 flat 里首次出现的顺序取**去重项目**，各带计数；
  // 只有一个项目时筛选没有意义，tab 行整个不渲染。
  const projTabs = useMemo(() => {
    const order: string[] = [];
    const counts = new Map<string, number>();
    for (const f of flat) {
      if (!counts.has(f.proj)) {
        counts.set(f.proj, 0);
        order.push(f.proj);
      }
      counts.set(f.proj, (counts.get(f.proj) || 0) + 1);
    }
    return order.map((p) => ({ proj: p, count: counts.get(p) || 0 }));
  }, [flat]);

  // 可见行 = 项目 tab 过滤后的 flat；头部计数 / 清单 / 勾选 / 全选全部跟着它走。
  // 轮询刷新后所选项目可能整队消失——此时兜底回「全部」，别卡在空清单上。
  const activeProj = projTabs.some((p) => p.proj === projSel) ? projSel : '';
  const shown = useMemo<FlatRow[]>(
    () => (activeProj ? flat.filter((f) => f.proj === activeProj) : flat),
    [flat, activeProj]
  );

  const pendingCount = useMemo(() => shown.filter((f) => f.t.status !== 'claimed').length, [shown]);

  // 勾选只认「清单里还在的行」——行会随轮询刷新而消失（切 tab 也会让不可见行掉选）。
  const picked = useMemo(() => {
    const ids = new Set(shown.map((f) => Number(f.t.id)));
    return [...sel].filter((id) => ids.has(id));
  }, [sel, shown]);
  const selCount = picked.length;

  const toggleOne = (id: number) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = (clear: boolean) => {
    setSel(clear ? new Set() : new Set(shown.map((f) => Number(f.t.id))));
  };
  const allOn = shown.length > 0 && picked.length === shown.length;

  /** 底部操作条的删除：把选中项按目录分组，逐组调批量删除接口。 */
  const dropAll = async () => {
    const pickedSet = new Set(picked);
    const groups: { key: string; name: string; ids: number[] }[] = [];
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
        const r = await removeTasks({ key: g.key, ids: g.ids });
        n += Number(r?.count ?? 0);
        miss += (r?.missing || []).length;
      } catch (e) {
        const msg = String((e as Error).message || e);
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

  /** 行点击：组任务走组锚定路由（#86：#/group/<boardMark>?task=N），其余进目录工作台。 */
  const openTask = (f: FlatRow, id: number | string) => {
    const url = f.t.boardMark
      ? `#/group/${encodeURIComponent(f.t.boardMark)}?task=${encodeURIComponent(id)}`
      : `${f.base}?task=${encodeURIComponent(id)}`;
    onNavigate?.(url);
  };

  return (
    <div className="ov-wrap">
      <RouteBreadcrumb />
      {dialogNode}
      <div className="ov-head">
        <h2>全部目录总览</h2>
        <span className="muted">
          {shown.length} 个未完成任务（待领取 {pendingCount}）
          {waitingDirs ? ` · ${waitingDirs} 个目录等待回填` : ''}
        </span>
        {shown.length > 0 && (
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

      {/* 项目 tab 筛选器（#120）：「全部」+ 每个项目一枚（带计数）。
          形态与 rp-tab 同一族（胶囊），选中态是绿浅底+绿边框（#119 口径）。 */}
      {projTabs.length > 1 && (
        <div className="ov-tabs" role="tablist" aria-label="按项目筛选">
          <button
            type="button"
            className={'ov-tab' + (!activeProj ? ' on' : '')}
            onClick={() => setProjSel('')}
          >
            全部 {flat.length}
          </button>
          {projTabs.map((p) => (
            <button
              key={p.proj}
              type="button"
              className={'ov-tab' + (activeProj === p.proj ? ' on' : '')}
              onClick={() => setProjSel(p.proj)}
            >
              {p.proj} {p.count}
            </button>
          ))}
        </div>
      )}

      {!shown.length ? (
        <div className="ov-task muted">
          没有未完成的任务——当前队列都清空了。在侧边栏点 ＋ 添加目录，或让 agent 在任意目录提交任务。
        </div>
      ) : (
        <div className="ov-list">
          {shown.map((f) => (
            <TaskRow
              key={`${f.secKey}-${f.t.id}`}
              t={f.t}
              proj={f.proj}
              waiting={f.waiting}
              checked={sel.has(Number(f.t.id))}
              onToggle={toggleOne}
              onOpenTask={(id) => openTask(f, id)}
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
function TaskRow({ t, proj, waiting, checked, onToggle, onOpenTask, meta = '' }: {
  t: LocalTask;
  proj: string;
  waiting: boolean;
  checked: boolean;
  onToggle: (id: number) => void;
  onOpenTask: (id: number | string) => void;
  meta?: string;
}) {
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
      {t.boardMark ? (
        <span className="tag t-board" title="项目组任务：详情在组页打开">
          组
        </span>
      ) : null}
      {proj ? (
        <span className="tag t-proj" title="所属项目">
          {proj}
          {waiting ? <span className="wdot" /> : null}
        </span>
      ) : null}
      {t.from === 'cloud' && <span className="tag t-cloud">云端</span>}
      {meta ? <span className="m mono">{meta}</span> : null}
      <StatusTag t={t} title={undefined} />
    </div>
  );
}
