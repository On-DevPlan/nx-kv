// 任务进程面板 —— 工作区里的**独立面板**（可拖到任意一边、可浮出、可单独关掉）。
//
// 每张卡片左侧带复选框：多选后批量删除（软删除，CLI localtask task restore 可恢复）。
// 点卡片 → 在工作区里开一个 MD 页签（不是切内部 tab）。
//
// 组模式（任务 #56，口径 #72 收紧）：config.groupKey 指向项目组（board）时，进程按
// **组**聚合——成员项目队列里的任务全收（非成员队列里「组发布」的旧任务兜底收录），
// 卡片带项目 tag，顶部一组筛选 chips 按**项目**过滤，统计随筛选范围走。
//
// #245 任务链合并进进程列表：
//   · 显示**全部任务**（#172 的「旧轮次折叠」下线——反馈链是树，不是要藏的直线）
//   · 卡片 hover 浮出「更多」icon → 下拉两项：只展示当前任务的任务链 / 删除
//   · 链视图按 taskChain.tree 渲染**树状节点**（祖先路径 + 分叉子树），点节点开任务页
import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { removeTasks } from './api.js';
import { ChainView } from './chain-view.js';
import type { ChainViewTarget } from './chain-view.js';
import { Icon } from '../../components/icons.jsx';
import { MenuPortal, openMenuAt, useMenu } from '../../components/md/shell/tool-bar.js';
import { isGroupTask } from '../../modules/board/board-view.js';
import { taskToProgress } from '../../modules/md/md-parse.js';
import { hitQuery } from '../../modules/md/progress-search.js';
import { closeRightSidebar, findOpenPanel } from '../../workspace.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import type { Model } from 'flexlayout-react';
import type { BoardRow, LocalTask, LocalTopic } from '../../types.js';

/** 进程卡（taskToProgress 的出站形状 + 组模式补充的定位 / 项目字段）。 */
interface ProgressCard {
  id?: number;
  title: string;
  status: string;
  detail: string;
  receivedAt?: string;
  key?: string;
  taskId?: number;
  topicKey?: string;
  topicCwd?: string;
  project?: string;
  projectName?: string;
}

/** 队列里的一条任务（多读软删 / 迁移 / 领取时刻等标记）。 */
interface TopicTask extends LocalTask {
  deletedAt?: string;
  migratedTo?: string;
  consumedAt?: string;
  completedAt?: string;
  roundSummary?: string;
  childRoundCount?: number;
  blocksFollowing?: boolean;
  boardMark?: string;
  from?: string;
}

/** 队列主题（/api/localtasks 的 rows[]）。 */
interface TopicRow extends LocalTopic {
  cwd?: string;
  repo?: { key?: string };
  tasks?: TopicTask[];
}

/** 组（看板）成员：进程按成员队列聚合时只用 key/name/path。 */
interface GroupMember {
  key?: string;
  name?: string;
  path?: string;
}

function fmtElapsed(ms: number) {
  if (ms == null || ms < 0 || Number.isNaN(ms)) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 60) / 60);
  const sec = s % 60;
  if (h) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function elapsedOf(card: ProgressCard, now: number) {
  // 只有「执行中」计时，起点 = **领取时刻**（consumedAt）；待领取没有起点，
  // 已完成回填的按口径不计时间。
  if (card.status !== 'run') return '—';
  const start = card.receivedAt ? Date.parse(card.receivedAt) : NaN;
  if (!Number.isFinite(start)) return '—';
  return fmtElapsed(now - start);
}

// 搜索匹配在 modules/md/progress-search.js（纯函数、可单测）：#127 编号等值 +
// 标题模糊；#129 验收反馈补成——纯数字还吃编号前缀（12 → #120-#129）与标题
// 逐位通配（12 ≡ 1*2），带 * 的按段匹配。
// 链视图（树渲染 + 取数）在 ./chain-view.tsx（#245 拆出，见该文件头注释）。


export default function ProgressPanel({
  dirKey, task: focusTask, rows = [], refreshLocal, model, onOpenTask, onClosePage,
  group = null,
}: {
  dirKey?: string;
  task?: string | number | null;
  rows?: LocalTopic[];
  refreshLocal?: () => void | Promise<void>;
  model?: Model | null;
  onOpenTask?: (id?: number, dirKey?: string) => void;
  onClosePage?: (tabId: string) => void;
  group?: BoardRow | null;
}) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  // rows 来自 /api（外部边界）：按本面板真正读的字段收窄一次
  const allRows = (rows || []) as TopicRow[];
  const topic = useMemo(() => allRows.find((r) => r.key === dirKey) || null, [allRows, dirKey]);

  // #85 两种走向：目录/全局模式是**项目走向**——组任务归组页管（组模式另一条
  // 分支整组口径收成员队列，不受此影响）。#245：进程列表显示**全部任务**
  //（#172 的「旧轮次折叠」下线）——反馈链是树，「只看一条链」走 hover 菜单的树视图。
  const liveTasks = useMemo(
    () => (topic?.tasks || []).filter((t) => !t.deletedAt && !isGroupTask(t)),
    [topic],
  );
  const [now, setNow] = useState(Date.now());
  // 多选：存卡片键（目录模式 = 任务 id 数字；组模式 = "topicKey:id" 复合键——
  // 不同队列同号任务多的是，拿裸 id 当键会把两个队列的 #1 当成同一张卡）
  const [picked, setPicked] = useState<Set<string | number | undefined>>(() => new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ─── 组模式聚合（任务 #56；口径 #72 = 整个项目组）─────────────────────────
  // 整组口径：任务**所在队列**是本组成员 → 全收（不要求正文带 board 标记）；
  // 项目归属优先按成员名（队列即项目）。每张卡带 topicKey/topicCwd（点开、删除
  // 要按任务**所在队列**寻址）与项目名（筛选用）。#245：不再按链尖折叠。
  const groupCards = useMemo<ProgressCard[]>(() => {
    if (!group) return [];
    const ids = [group.id, group.key, group.name].filter(Boolean);
    const members = (group.repos || []) as GroupMember[];
    const memberByKey = new Map<string, GroupMember>();
    for (const m of members) {
      if (m && m.key) memberByKey.set(m.key, m);
    }
    const projectNameOf = (projKey: string | undefined, row: TopicRow | null) => {
      const m = members.find(
        (x) => x && (x.key === projKey || x.name === projKey || (x.path && x.path === projKey)),
      );
      if (m && m.name) return m.name;
      if (projKey) return String(projKey).split('/').pop() || String(projKey);
      return (row && row.name) || '';
    };
    const out: ProgressCard[] = [];
    for (const r of allRows) {
      if (!r || !Array.isArray(r.tasks)) continue;
      const mk = r.repo && r.repo.key;
      const member = (mk && memberByKey.get(mk)) || null;
      const inGroupQueue = !!member; // 成员队列 → 整组口径；否则走旧口径兜底
      for (const t of r.tasks) {
        if (!t || t.deletedAt) continue;
        // #197：归属读库内关联（boardMark = 组、repoKey = 归属仓库），不再解析正文
        const board = String((t as any).boardMark || (t as any).boardKey || '');
        if (!inGroupQueue && (!board || !ids.includes(board))) continue;
        out.push({
          ...taskToProgress(t),
          key: `${r.key}:${t.id}`,
          taskId: t.id,
          topicKey: r.key,
          topicCwd: r.cwd || '',
          project: String((t as any).repoKey || ''),
          projectName: inGroupQueue
            ? ((member && member.name) || projectNameOf(String((t as any).repoKey || ''), r))
            : projectNameOf(String((t as any).repoKey || ''), r),
        });
      }
    }
    const order: Record<string, number> = { run: 0, wait: 1, done: 2 };
    return out.sort(
      (a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)
        || (a.projectName || '').localeCompare(b.projectName || '')
        || Number(a.taskId) - Number(b.taskId),
    );
  }, [group, allRows]);

  // 项目筛选（组模式）：'' = 全部；值为 projectName。会话内状态不持久化（筛选是
  // 临时视角，切组后自动回落「全部」）。搜索（#127）：按编号或标题过滤卡片；
  // 两者统计/列表/全选随筛选范围走——面板上看到的基数就是操作的基数。
  const [projFilter, setProjFilter] = useState('');
  const [q, setQ] = useState('');

  const projects = useMemo(() => {
    const seen = new Map<string, boolean>();
    for (const c of groupCards) {
      if (c.projectName && !seen.has(c.projectName)) seen.set(c.projectName, true);
    }
    return [...seen.keys()];
  }, [groupCards]);

  const cards = useMemo<ProgressCard[]>(() => {
    const order: Record<string, number> = { run: 0, wait: 1, done: 2 };
    const sortCards = group
      ? (a: ProgressCard, b: ProgressCard) => (order[a.status] ?? 9) - (order[b.status] ?? 9)
        || (a.projectName || '').localeCompare(b.projectName || '')
        || Number(a.taskId) - Number(b.taskId)
      : (a: ProgressCard, b: ProgressCard) => (order[a.status] ?? 9) - (order[b.status] ?? 9);
    const base: ProgressCard[] = group
      ? (() => {
          const active = projFilter && projects.includes(projFilter) ? projFilter : '';
          return groupCards.filter((c) => !active || c.projectName === active);
        })()
      : liveTasks.map<ProgressCard>((t) => taskToProgress(t)).sort(sortCards);
    // #127/#129 搜索：编号（等值 + 前缀）与标题（模糊 + 逐位通配）——规则见
    // modules/md/progress-search.js；空串不筛
    const qs = q.trim().toLowerCase();
    if (!qs) return base;
    return base.filter((c) => hitQuery(c, qs));
  }, [group, groupCards, projFilter, projects, liveTasks, q]);

  // 选中的任务可能已被别处删掉 → 只留还活着的编号（否则「删除所选」带着死编号）
  const cidOf = (c: ProgressCard): string | number | undefined => (group ? c.key : c.id); // 组模式 = 复合键,与 picked Set 同口径
  useEffect(() => {
    setPicked((prev) => {
      if (!prev.size) return prev;
      const alive = new Set(cards.map(cidOf));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [cards, group]);

  // 统计只留三个**真实**状态：进行中 / 等待 / 已完成（#60 曾用「阶段序号」算假进度）。
  const running = cards.filter((c) => c.status === 'run').length;
  const waiting = cards.filter((c) => c.status === 'wait').length;
  const done = cards.filter((c) => c.status === 'done').length;
  // 真实进度 = 已完成 / 总数
  const donePct = cards.length ? Math.round((done * 100) / cards.length) : 0;

  const allPicked = cards.length > 0 && picked.size === cards.length;
  const pickedCards = cards.filter((c) => picked.has(cidOf(c)));

  const togglePick = (id: string | number | undefined) => {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    setPicked(allPicked ? new Set() : new Set(cards.map(cidOf)));
  };

  // 批量删除（软删除）：目录模式一次请求；组模式按任务**所在队列**分桶逐桶删
  //（删除 API 按目录寻址，跨队列的选中项必须拆开）
  const delPicked = async () => {
    if (busy || !pickedCards.length) return;
    const names = pickedCards.map((c) => `#${c.taskId ?? c.id} ${c.title}`);
    const shown = names.length <= 6 ? names.join('\n') : `${names.slice(0, 6).join('\n')}… 共 ${names.length} 条`;
    const ok = await dialog({
      title: `删除选中的 ${pickedCards.length} 条任务`,
      message: `${shown}\n\n软删除：CLI localtask task restore 可恢复。`,
      danger: true,
      okText: '删除',
    });
    if (!ok) return;
    setBusy(true);
    try {
      let n = 0;
      let miss = 0;
      if (group) {
        const byTopic = new Map<string, { cwd?: string; ids: (number | undefined)[] }>();
        for (const c of pickedCards) {
          const tk = c.topicKey || '';
          if (!byTopic.has(tk)) byTopic.set(tk, { cwd: c.topicCwd, ids: [] });
          const bucket = byTopic.get(tk);
          if (bucket) bucket.ids.push(c.taskId);
        }
        for (const { cwd, ids } of byTopic.values()) {
          const res = await removeTasks({ cwd, ids });
          n += res?.count ?? ids.length;
          miss += res?.missing?.length || 0;
        }
      } else {
        const ids = pickedCards.map((c) => c.id);
        const res = await removeTasks({ cwd: topic?.cwd, ids });
        n = res?.count ?? ids.length;
        miss = res?.missing?.length || 0;
      }
      const missTxt = miss ? `（${miss} 条已不存在）` : '';
      // 关掉这些任务的页签（开着的话）——组模式按各卡所在目录找页签
      if (model) {
        for (const c of pickedCards) {
          const dk = group ? c.topicKey : dirKey;
          const tid = group ? c.taskId : c.id;
          // findOpenPanel 尚未类型化（返回值被推断成 null），按 flexlayout 节点收窄
          const page = findOpenPanel(model, 'page', { dirKey: dk, task: String(tid) }) as
            { getId: () => string } | null;
          if (page && onClosePage) onClosePage(page.getId());
        }
      }
      setPicked(new Set());
      refreshLocal?.();
      toast(`已删除 ${n} 条任务${missTxt}`);
    } catch (e) {
      // 失败保留勾选，便于改了再试
      toast('删除失败: ' + ((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  // 点卡打开任务：组模式的任务散在各成员目录，要带**所在队列**的 dirKey 寻址
  const openCard = (c: ProgressCard) => {
    if (!onOpenTask) return;
    if (group) onOpenTask(c.taskId, c.topicKey);
    else onOpenTask(c.id);
  };

  // ─── #245 任务链合并进进程面板 ─────────────────────────────────────────
  // 卡片 hover 浮出「更多」→ 下拉两项：只展示当前任务的任务链 / 删除。
  // 链视图（取数 + 树渲染）在 ./chain-view.tsx 的 ChainView。
  const menu = useMenu();
  const [menuCard, setMenuCard] = useState<ProgressCard | null>(null);
  const [chainView, setChainView] = useState<ChainViewTarget | null>(null);

  const openChainView = (c: ProgressCard) => {
    setChainView({
      id: Number(c.taskId ?? c.id),
      key: (group ? c.topicKey : topic?.key) || undefined,
      cwd: (group ? c.topicCwd : topic?.cwd) || undefined,
    });
  };

  // 单条删除（下拉「删除」项）：软删除 + 关掉开着的那页签 + 链视图正在看它就退回列表
  const delOne = async (c: ProgressCard) => {
    if (busy) return;
    const id = c.taskId ?? c.id;
    const ok = await dialog({
      title: `删除任务 #${id}`,
      message: `${c.title}\n\n软删除：CLI localtask task restore 可恢复。`,
      danger: true,
      okText: '删除',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = group
        ? await removeTasks({ key: c.topicKey, cwd: c.topicCwd, ids: [id] })
        : await removeTasks({ cwd: topic?.cwd, ids: [id] });
      const dk = group ? c.topicKey : dirKey;
      const page = model
        ? (findOpenPanel(model, 'page', { dirKey: dk, task: String(id) }) as { getId: () => string } | null)
        : null;
      if (page && onClosePage) onClosePage(page.getId());
      if (chainView && Number(chainView.id) === Number(id)) setChainView(null);
      refreshLocal?.();
      toast(`已删除任务 #${id}${res?.missing?.length ? '（任务已不存在）' : ''}`);
    } catch (e) {
      toast('删除失败: ' + ((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const focusId = focusTask != null && String(focusTask) !== '' ? String(focusTask) : '';

  return (
    <div className="mdw-prog-host">
      {dialogNode}
      {/* #245：卡片「更多」下拉（portal 到 body，防被卡片 overflow 裁掉） */}
      <MenuPortal menu={menu} className="mdw-prog-menu">
        {menuCard && (
          <>
            <button
              type="button"
              role="menuitem"
              className="mdw-fmt-menu-item"
              onClick={() => {
                menu.setOpen(false);
                openChainView(menuCard);
              }}
            >
              <Icon name="chain" size={13} title={undefined} />
              只展示当前任务的任务链
            </button>
            <button
              type="button"
              role="menuitem"
              className="mdw-fmt-menu-item danger"
              onClick={() => {
                menu.setOpen(false);
                void delOne(menuCard);
              }}
            >
              <Icon name="trash" size={13} title={undefined} />
              删除
            </button>
          </>
        )}
      </MenuPortal>
      <div className="mdw-prog-h">
        <span className="t">
          {group ? `${group.name} · 任务进程` : topic?.name || '任务进程'}
        </span>
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
        {model && (
          <button
            type="button"
            className="iconbtn"
            title="关闭进程面板"
            aria-label="关闭进程面板"
            onClick={() => closeRightSidebar(model)}
          >
            <Icon name="x" size={14} title={undefined} />
          </button>
        )}
      </div>
      {(group ? groupCards.length > 0 : liveTasks.length > 0) && (
        <div className="mdw-prog-search">
          <Icon name="search" size={13} title={undefined} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索编号或标题（如 12 → #12、#120-129；1*2 通配）"
            spellCheck="false"
            aria-label="按编号或标题搜索任务"
          />
          {q && (
            <button
              type="button"
              className="mdw-prog-qclear"
              aria-label="清空搜索"
              title="清空搜索"
              onClick={() => setQ('')}
            >
              <Icon name="x" size={11} title={undefined} />
            </button>
          )}
        </div>
      )}
      {group && projects.length > 1 && (
        <div className="mdw-prog-filters" role="tablist" aria-label="按项目筛选进程卡">
          <button
            type="button"
            className={'mdw-prog-fchip' + (!projFilter || !projects.includes(projFilter) ? ' on' : '')}
            onClick={() => setProjFilter('')}
          >
            全部 <b>{groupCards.length}</b>
          </button>
          {projects.map((p) => (
            <button
              key={p}
              type="button"
              className={'mdw-prog-fchip' + (projFilter === p ? ' on' : '')}
              onClick={() => setProjFilter(projFilter === p ? '' : p)}
            >
              {p} <b>{groupCards.filter((c) => c.projectName === p).length}</b>
            </button>
          ))}
        </div>
      )}
      <div className="mdw-prog-sum">
        <div className="counts">
          <span className="run">进行中 <b>{running}</b></span>
          <span className="wait">等待 <b>{waiting}</b></span>
          <span className="done">已完成 <b>{done}</b></span>
        </div>
        <div className="bar" title={`已完成 ${done} / 共 ${cards.length}`}>
          <i style={{ width: `${donePct}%` }} />
        </div>
      </div>
      {picked.size > 0 && (
        <div className="mdw-prog-sel">
          <span className="n">已选 <b>{picked.size}</b> / {cards.length}</span>
          <button type="button" className="mdw-prog-clear" onClick={() => setPicked(new Set())}>
            清除
          </button>
          <button type="button" className="mdw-prog-del" onClick={delPicked} disabled={busy}>
            <Icon name="trash" size={12} title={undefined} />
            删除所选
          </button>
        </div>
      )}
      {chainView ? (
        <ChainView
          target={chainView}
          onBack={() => setChainView(null)}
          onOpen={(id, dk) => onOpenTask?.(id, dk)}
        />
      ) : (
        <>
          <div className="mdw-prog-list">
            {!cards.length && (
              <div className="mdw-prog-empty">
                {q.trim() ? (
                  <>
                    没有匹配的卡片<br />试试编号（如 127）或标题关键词
                  </>
                ) : group ? (
                  <>
                    本组成员项目还没有任务<br />任务会随成员队列自动聚到这里
                  </>
                ) : (
                  <>
                    此目录还没有 MD 任务<br />写 MD 提交或导入
                  </>
                )}
              </div>
            )}
            {cards.map((c) => {
              const cid = cidOf(c);
              const on = picked.has(cid);
              const isFocus = focusId !== '' && String(c.taskId ?? c.id) === focusId;
              return (
                <div className={`mdw-tcard-row${on ? ' on' : ''}`} key={cid}>
                  <input
                    type="checkbox"
                    className="mdw-tcard-pick"
                    checked={on}
                    onChange={() => togglePick(cid)}
                    aria-label={`选择任务 #${c.taskId ?? c.id} ${c.title}`}
                    title="选择此任务（可多选后批量删除）"
                  />
                  <button
                    type="button"
                    className={`mdw-tcard ${c.status}${isFocus ? ' focus' : ''}`}
                    onClick={() => openCard(c)}
                  >
                    <div className="mdw-tcard-h">
                      <span className={`st ${c.status}`} />
                      <div className="titles">
                        <div className="n">
                          {c.title}
                          {group && c.projectName && (
                            <span className="rp-ptag mdw-tcard-proj" title={`归属项目：${c.projectName}`}>
                              {c.projectName}
                            </span>
                          )}
                        </div>
                        <div className="sub">{c.detail}</div>
                      </div>
                      {/* 任务编号（#127）：卡片右侧 #id——用户口径「楼数」= #xxx 这个
                          编号（#122 曾按重开轮次渲染「N楼」，反馈不对已改） */}
                      <span
                        className="mdw-tcard-num"
                        title={`任务编号 #${c.taskId ?? c.id}`}
                      >
                        #{c.taskId ?? c.id}
                      </span>
                      <span
                        className={`el ${c.status}`}
                        title="从领取时刻起计；待领取与已完成回填不计时间"
                      >
                        {elapsedOf(c, now)}
                      </span>
                    </div>
                  </button>
                  {/* #245：hover 浮出「更多」→ 下拉（任务链 / 删除） */}
                  <button
                    type="button"
                    className="mdw-tcard-more"
                    aria-label={`任务 #${c.taskId ?? c.id} 更多操作`}
                    title="更多操作"
                    onClick={(e: ReactMouseEvent<HTMLButtonElement>) => {
                      setMenuCard(c);
                      openMenuAt(menu, e, 'right');
                    }}
                  >
                    <Icon name="dots" size={13} title={undefined} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mdw-prog-note">
            {group ? '组内各项目的任务聚在这里；可按项目筛选，勾选后批量删除。' : '本目录的任务；点卡打开，勾选后批量删除。'}
            {' '}卡片悬停「更多」可看任务链（树状）或删除单条。
          </div>
        </>
      )}
    </div>
  );
}
