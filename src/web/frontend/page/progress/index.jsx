// 任务进程面板 —— 工作区里的**独立面板**（可拖到任意一边、可浮出、可单独关掉）。
//
// 每张卡片左侧带复选框：多选后批量删除（软删除，CLI localtask task restore 可恢复）。
// 点卡片 → 在工作区里开一个 MD 页签（不是切内部 tab）。
//
// 组模式（任务 #56，口径 #72 收紧）：config.groupKey 指向项目组（board）时，
// 进程按**组**聚合——显示**整个项目组**的：所有成员项目队列里的任务全收（不再要求
// 正文 frontmatter.board 指向本组），卡片带项目 tag，顶部一组筛选 chips 按**项目**
// 过滤，统计随筛选范围走。非成员队列里「组发布」的旧任务（frontmatter.board 指向
// 本组）仍兜底收录。
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { Icon } from '../../components/icons.jsx';
import { GLOBAL_KEY } from '../../modules/board/board-view.js';
import { parseFrontmatter, taskToProgress } from '../../modules/md/md-parse.js';
import { closeRightSidebar, findOpenPanel } from '../../workspace.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';

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
  // 只有「执行中」的任务计时，起点 = **领取时刻**（consumedAt）：
  // 待领取的还没被领，没有起点；已完成回填的按口径不实现时间计算。
  if (card.status !== 'run') return '—';
  const start = card.receivedAt ? Date.parse(card.receivedAt) : NaN;
  if (!Number.isFinite(start)) return '—';
  return fmtElapsed(now - start);
}


export default function ProgressPanel({
  dirKey, task: focusTask, rows = [], refreshLocal, model, onOpenTask, onClosePage,
  group = null,
}) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const isGlobal = !dirKey || dirKey === GLOBAL_KEY;
  const topic = useMemo(() => {
    if (isGlobal) return (rows || []).find((r) => r.isGlobal) || null;
    return (rows || []).find((r) => r.key === dirKey) || null;
  }, [rows, dirKey, isGlobal]);

  const tasks = useMemo(() => (topic?.tasks || []).filter((t) => !t.deletedAt), [topic]);

  const [now, setNow] = useState(Date.now());
  // 多选：存卡片键（目录模式 = 任务 id 数字；组模式 = "topicKey:id" 复合键——
  // 不同队列同号任务多的是，拿裸 id 当键会把两个队列的 #1 当成同一张卡）
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ─── 组模式聚合（任务 #56；口径 #72 = 整个项目组）─────────────────────────
  // 整组口径：任务**所在队列**是本组成员 → 全收（不要求正文带 board 标记）；
  // 项目归属优先按成员名（队列即项目），非成员队列保留旧口径兜底（board 指向本组）。
  // 每张卡带 topicKey/topicCwd（点开、删除要按任务**所在队列**寻址）与项目名（筛选用）。
  const groupCards = useMemo(() => {
    if (!group) return [];
    const ids = [group.id, group.key, group.name].filter(Boolean);
    const members = group.repos || [];
    const memberByKey = new Map();
    for (const m of members) {
      if (m && m.key) memberByKey.set(m.key, m);
    }
    const projectNameOf = (projKey, row) => {
      const m = members.find(
        (x) => x && (x.key === projKey || x.name === projKey || (x.path && x.path === projKey)),
      );
      if (m && m.name) return m.name;
      if (projKey) return String(projKey).split('/').pop() || String(projKey);
      return (row && row.name) || '';
    };
    const out = [];
    for (const r of rows || []) {
      if (!r || r.isGlobal || !Array.isArray(r.tasks)) continue;
      const member = (r.repo && memberByKey.get(r.repo.key)) || null;
      const inGroupQueue = !!member; // 成员队列 → 整组口径；否则走旧口径兜底
      for (const t of r.tasks) {
        if (!t || t.deletedAt) continue;
        let fm = {};
        try {
          fm = parseFrontmatter(t.text || '');
        } catch {
          fm = {};
        }
        if (!inGroupQueue && (!fm.board || !ids.includes(fm.board))) continue;
        out.push({
          ...taskToProgress(t),
          key: `${r.key}:${t.id}`,
          taskId: t.id,
          topicKey: r.key,
          topicCwd: r.cwd || '',
          project: fm.project || '',
          projectName: inGroupQueue
            ? (member.name || projectNameOf(fm.project, r))
            : projectNameOf(fm.project, r),
        });
      }
    }
    const order = { run: 0, wait: 1, done: 2 };
    return out.sort(
      (a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)
        || a.projectName.localeCompare(b.projectName)
        || Number(a.taskId) - Number(b.taskId),
    );
  }, [group, rows]);

  // 项目筛选（组模式）：'' = 全部；值为 projectName。会话内状态，不持久化——
  // 筛选是临时视角；切组后旧筛选不在新组的项目列表里，派生时自动回落「全部」。
  const [projFilter, setProjFilter] = useState('');

  const projects = useMemo(() => {
    const seen = new Map();
    for (const c of groupCards) {
      if (c.projectName && !seen.has(c.projectName)) seen.set(c.projectName, true);
    }
    return [...seen.keys()];
  }, [groupCards]);

  const cards = useMemo(() => {
    if (group) {
      const active = projFilter && projects.includes(projFilter) ? projFilter : '';
      return groupCards.filter((c) => !active || c.projectName === active);
    }
    const list = tasks.map(taskToProgress);
    const order = { run: 0, wait: 1, done: 2 };
    return list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [group, groupCards, projFilter, projects, tasks]);

  // 选中的任务可能已被别处删掉 → 只留还活着的编号（否则「删除所选」带着死编号）
  const cidOf = (c) => (group ? c.key : c.id); // 组模式 = 复合键,与 picked Set 同口径
  useEffect(() => {
    setPicked((prev) => {
      if (!prev.size) return prev;
      const alive = new Set(cards.map(cidOf));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [cards, group]);

  // 统计只留三个**真实**状态：进行中 / 等待 / 已完成。
  // 原来那一排「并发 / 跑 / 等 / 完」+ 大百分比 + 进度条，同一件事说了四遍，
  // 而且百分比是「阶段序号」算出来的假进度（#60）。
  const running = cards.filter((c) => c.status === 'run').length;
  const waiting = cards.filter((c) => c.status === 'wait').length;
  const done = cards.filter((c) => c.status === 'done').length;
  // 真实进度 = 已完成 / 总数
  const donePct = cards.length ? Math.round((done * 100) / cards.length) : 0;

  const allPicked = cards.length > 0 && picked.size === cards.length;
  const pickedCards = cards.filter((c) => picked.has(cidOf(c)));

  const togglePick = (id) => {
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
        const byTopic = new Map();
        for (const c of pickedCards) {
          if (!byTopic.has(c.topicKey)) byTopic.set(c.topicKey, { cwd: c.topicCwd, ids: [] });
          byTopic.get(c.topicKey).ids.push(c.taskId);
        }
        for (const { cwd, ids } of byTopic.values()) {
          const res = await api('/api/localtasks/items', { method: 'DELETE', body: { cwd, ids } });
          n += res?.count ?? ids.length;
          miss += res?.missing?.length || 0;
        }
      } else {
        const ids = pickedCards.map((c) => c.id);
        const res = await api('/api/localtasks/items', {
          method: 'DELETE',
          body: { ...(isGlobal ? { key: GLOBAL_KEY } : { cwd: topic.cwd }), ids },
        });
        n = res?.count ?? ids.length;
        miss = res?.missing?.length || 0;
      }
      const missTxt = miss ? `（${miss} 条已不存在）` : '';
      // 关掉这些任务的页签（开着的话）——组模式按各卡所在目录找页签
      if (model) {
        for (const c of pickedCards) {
          const dk = group ? c.topicKey : dirKey;
          const tid = group ? c.taskId : c.id;
          const page = findOpenPanel(model, 'page', { dirKey: dk, task: String(tid) });
          if (page && onClosePage) onClosePage(page.getId());
        }
      }
      setPicked(new Set());
      refreshLocal();
      toast(`已删除 ${n} 条任务${missTxt}`);
    } catch (e) {
      // 失败保留勾选，便于改了再试
      toast('删除失败: ' + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  // 点卡打开任务：组模式的任务散在各成员目录，要带**所在队列**的 dirKey 寻址
  const openCard = (c) => {
    if (!onOpenTask) return;
    if (group) onOpenTask(c.taskId, c.topicKey);
    else onOpenTask(c.id);
  };

  const focusId = focusTask != null && String(focusTask) !== '' ? String(focusTask) : '';

  return (
    <div className="mdw-prog-host">
      {dialogNode}
      <div className="mdw-prog-h">
        <span className="t">
          {group ? `${group.name} · 任务进程` : topic?.name || (isGlobal ? '全局任务池' : '任务进程')}
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
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
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
            <Icon name="trash" size={12} />
            删除所选
          </button>
        </div>
      )}
      <div className="mdw-prog-list">
        {!cards.length && (
          <div className="mdw-prog-empty">
            {group ? (
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
                  <span
                    className={`el ${c.status}`}
                    title="从领取时刻起计；待领取与已完成回填不计时间"
                  >
                    {elapsedOf(c, now)}
                  </span>
                </div>

              </button>
            </div>
          );
        })}
      </div>
      <div className="mdw-prog-note">
        {group ? '组内各项目的任务聚在这里；可按项目筛选，勾选后批量删除。' : '本目录的任务；点卡打开，勾选后批量删除。'}
      </div>
    </div>
  );
}
