// 本地任务（localtask）页：主题（按工作目录划分）总览 + 选中某个主题回填 + 该主题的任务队列。
// 本质是「agent 提交结果 → 阻塞 → 用户在 web 针对主题回填 → agent 接收」。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useToast, useGuard } from '../../web/frontend/components/ui.jsx';
import { mergeDirectoryRows } from './board.js';

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

// 「已等 m:ss · 剩 m:ss」：waitingSince（起点）反推已等，waitingUntil（截止）反推剩余。
// waitingSince 缺字段时（老数据）退化为只显示剩余。
//
// 剩余时间优先用 waitingUntilMs（毫秒精度的 epoch）：waitingUntil 那串是给人看的、
// 只有秒级且是**截断**的，短时限下会比真实截止早最多 1 秒——面板会提前显示 0:00。
function waitingBadge(t) {
  if (!t || !t.waiting) return null;
  let remain;
  if (t.waitingUntilMs > 0) {
    const ms = t.waitingUntilMs - Date.now();
    const mm = Math.floor(Math.max(0, ms) / 60000);
    const ss = Math.floor((Math.max(0, ms) % 60000) / 1000);
    remain = `等待中 ${mm}:${String(ss).padStart(2, '0')}`;
  } else {
    remain = countdown(t.waitingUntil);
  }
  if (!t.waitingSince) return remain; // 老数据兜底
  const since = parseStamp(t.waitingSince);
  if (!since) return remain;
  const elapsedMs = Date.now() - since.getTime();
  if (elapsedMs < 0) return remain;
  const mm = Math.floor(elapsedMs / 60000);
  const ss = Math.floor((elapsedMs % 60000) / 1000);
  return `等待中 已等 ${mm}:${String(ss).padStart(2, '0')} · 剩 ${remain.replace(/^等待中\s*/, '')}`;
}

// ─── timegoal 视图辅助（独立模块：见 src/modules/timegoal/service.js）──
// UI 这一层消费 /api/timegoals 把"持续运行 N 小时"任务的状态嵌到主题卡里。
// 注意：timegoal 数据每 1.5s 跟着主轮询一起刷，时间也是基于 now - deadline 本地算，
// 不需要单独 tick——reached 翻转最坏 1.5s 后才感知，UX 可接受。

function timegoalDeadlineMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s || '');
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}
// 把 7201s 格式化成 "2:00:01" / "5:30"——超过 1 小时显式带 h 段，避免 "60:00" 这种反人类。
function fmtClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
// 客户端算 reached / remaining（数据每 1.5s 刷一次，不开 tick）
function timegoalStatus(goal) {
  const dl = timegoalDeadlineMs(goal && goal.deadline);
  const st = timegoalDeadlineMs(goal && goal.startedAt);
  if (!Number.isFinite(dl)) return { reached: true, remainingSec: 0, elapsedSec: 0 };
  const now = Date.now();
  const remainingSec = Math.max(0, Math.ceil((dl - now) / 1000));
  const elapsedSec = Math.max(
    0,
    Number.isFinite(st) ? Math.floor((now - st) / 1000) : 0
  );
  return { reached: dl <= now, remainingSec, elapsedSec };
}

export default function SessionTaskView() {
  const toast = useToast();
  const guard = useGuard();

  const [overview, setOverview] = useState(null);
  const [activeKey, setActiveKey] = useState(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  // 回填到全局共享池（勾选后 POST 不带 cwd，带 global:true；选中全局主题时强制勾上）
  const [toGlobal, setToGlobal] = useState(false);
  const [timeoutSec, setTimeoutSec] = useState(180);
  const [cfgSaving, setCfgSaving] = useState(false);
  // 收尾追加语：task.text 末尾自动追加的固定指令（强制 agent 计划最后再 wait 一次）
  const [taskSuffix, setTaskSuffix] = useState('');
  const [defaultTaskSuffix, setDefaultTaskSuffix] = useState('');
  const [suffixEnabled, setSuffixEnabled] = useState(false);
  const [suffixEditing, setSuffixEditing] = useState(false);
  const [suffixDraft, setSuffixDraft] = useState('');
  const [suffixSaving, setSuffixSaving] = useState(false);
  // 探活状态：'connecting' | 'ok' | 'reconnecting'（数据轮询 + 常驻 SSE）
  const [liveStatus, setLiveStatus] = useState('connecting');
  // 「只读弹窗」：点击现状/上一轮总结/任务文本时显示聚焦阅读的模态框
  // modal = { title, body } | null
  const [modal, setModal] = useState(null);
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

  // 全部 timegoal（timegoal 与 localtask store 独立；这里只为目录看板合并显示）
  const [goalsList, setGoalsList] = useState([]);
  // 设置 / 添加目录 都收进按钮 + 弹窗（原来常驻卡片占掉大半屏）
  const [addDirCwd, setAddDirCwd] = useState('');
  const [addDirBusy, setAddDirBusy] = useState(false);
  const [recycling, setRecycling] = useState(false);
  const [showQueue, setShowQueue] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api('/api/localtasks');
      setOverview(data);
      setLiveStatus('ok');
    } catch {
      // 轮询失败 → 进入「重连中」态；指示灯变红，避免每 1.5s 弹错误 toast
      setLiveStatus('reconnecting');
    }
    // timegoal 拉取失败不影响主数据；map 自然为空，没目标的卡就不显示这一行。
    try {
      const t = await api('/api/timegoals/all');
      const list = (t && t.goals) || [];
      setGoalsList(list);
    } catch {
      /* 见上；UI 兜底就是空 Map */
    }
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setModal(null);
        setAddDirCwd('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 实时刷新：主题状态/倒计时、任务是否被取走，每 1.5s 轮询
  useEffect(() => {
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load]);

  // 常驻 SSE。**这条连接不只是"更快刷新"，它就是「面板标签还开着」的信号**：
  // 服务端 panelPresence() 统计的正是 /api/localtasks/events 上的活动连接，
  // wait 开窗前先问它「有没有活标签」。没有这条连接，presence 恒为 0 ——
  // wait 每次都以为没人在看，于是每次都开一个新窗口，等待期间还每 20s 再开一个。
  // （历史事故：面板改成 1.5s 轮询后把 SSE 摘了，presence 静默失效，弹窗叠成一片。）
  // 事件本身也顺手用起来：waiting/reminder/resolved 都触发一次即时刷新，
  // 轮询退化成兜底（断线、旧浏览器）。
  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    const es = new EventSource('/api/localtasks/events');
    const bump = () => { load(); };
    es.onopen = () => setLiveStatus('ok');
    es.onerror = () => setLiveStatus('reconnecting');
    for (const type of ['waiting', 'reminder', 'resolved']) es.addEventListener(type, bump);
    return () => es.close();
  }, [load]);

  // 只读弹窗：按 Esc 关闭
  useEffect(() => {
    if (!modal) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  // 全局主题（共享池）置顶；非全局保持后端给定的最近更新顺序（稳定排序不打乱）
  const topics = overview
    ? [...overview.topics].sort((a, b) => Number(!!b.isGlobal) - Number(!!a.isGlobal))
    : [];
  // 一目录一行：timegoal 是独立 store，但与 localtask 使用同一目录 key 组装看板视图。
  const directoryRows = mergeDirectoryRows(topics, goalsList);

  // 同步页面上的超时配置（来源：后端 settings）
  useEffect(() => {
    if (overview && overview.settings) {
      setTimeoutSec(overview.settings.timeoutSec);
      setTaskSuffix(overview.settings.taskSuffix || '');
      setDefaultTaskSuffix(overview.settings.defaultTaskSuffix || '');
      setSuffixEnabled(!!overview.settings.suffixEnabled);
    }
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

  // 收尾追加语：保存（draft 是 '' 等价于关闭；非空则启用）
  const saveSuffix = (text) =>
    guard(async () => {
      setSuffixSaving(true);
      try {
        const s = await api('/api/localtasks/setting', {
          method: 'PATCH',
          body: { suffix: text },
        });
        setTaskSuffix(s.taskSuffix);
        setSuffixEnabled(!!s.suffixEnabled);
        setSuffixEditing(false);
        setSuffixDraft('');
        toast(s.suffixEnabled ? '收尾追加语已更新' : '收尾追加语已关闭');
        await load();
      } finally {
        setSuffixSaving(false);
      }
    });

  // 显式关闭（不进入编辑，直接 PATCH suffix=''）
  const disableSuffix = () =>
    saveSuffix('');

  // timegoal 编辑器（set/update）直接写独立模块的 API，不改写 localtask topic。
  const saveTimegoal = ({ cwd, name, durationSec, prompt, resetStart }) =>
    guard(async () => {
      const body = String(prompt || '').trim();
      if (!body) {
        toast('提示词不能为空');
        return;
      }
      const dur = Number(durationSec);
      if (!Number.isFinite(dur) || dur < 60 || dur > 86400) {
        toast('时长需在 60-86400 秒之间（1 分钟到 24 小时）');
        return;
      }
      if (resetStart) {
        // 重置起点 = 开一局新的：走 set（POST）
        await api('/api/timegoals', {
          method: 'POST',
          body: { cwd, duration: dur, prompt: body },
        });
        toast(`已为「${name}」重设时间目标（${Math.round(dur / 60)} 分钟，计时从头开始）`);
      } else {
        await api('/api/timegoals', {
          method: 'PATCH',
          body: { cwd, prompt: body, duration: dur },
        });
        toast(`已更新「${name}」的时间目标（起点未变）`);
      }
      setModal(null);
      await load();
    });

  const addDirectory = () =>
    guard(async () => {
      const cwd = String(addDirCwd || '').trim();
      if (!cwd) {
        toast('请填写工作目录路径');
        return;
      }
      setAddDirBusy(true);
      try {
        const result = await api('/api/localtasks/topic', { method: 'POST', body: { cwd } });
        toast(result.existed ? `目录「${result.name}」已在看板中` : `已添加目录「${result.name}」`);
        setModal(null);
        setAddDirCwd('');
        await load();
      } finally {
        setAddDirBusy(false);
      }
    });

  const recycleTimegoals = () =>
    guard(async () => {
      if (!goalsList.some((goal) => timegoalStatus(goal).reached)) {
        toast('没有到点的 timegoal');
        return;
      }
      const expiredCount = goalsList.filter((goal) => timegoalStatus(goal).reached).length;
      if (!window.confirm(`回收 ${expiredCount} 个已到点的 timegoal？\n\n只删除到期目标，不会影响仍在运行的目标或本地任务队列。`)) return;
      setRecycling(true);
      try {
        const result = await api('/api/timegoals/prune', { method: 'POST', body: {} });
        toast(result.count ? `已回收 ${result.count} 个到点的 timegoal` : '没有需要回收的 timegoal');
        await load();
      } finally {
        setRecycling(false);
      }
    });

  const openSettings = () => {
    setSuffixDraft(taskSuffix);
    setSuffixEditing(false);
    setModal({ title: '任务看板设置', settings: true });
  };

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
      const useGlobal = !!active.isGlobal || toGlobal;
      setSaving(true);
      try {
        const r = await api('/api/localtasks', {
          method: 'POST',
          body: useGlobal ? { text: body, global: true } : { cwd: active.cwd, text: body },
        });
        setText('');
        toast(
          r.delivered
            ? useGlobal
              ? '已实时投递给等待中的 agent（全局共享池）'
              : '已返回给等待中的 agent'
            : useGlobal
            ? '已排入全局任务池：任何目录的 agent 在本地空时自动领取'
            : '已排入该主题队列，等待 agent 下一次 wait'
        );
        await load();
      } finally {
        setSaving(false);
      }
    });

  // 任务级寻址：全局主题没有 cwd，只能按 key 定位
  const taskAddr = () => (active.isGlobal ? { key: active.key } : { cwd: active.cwd });

  const remove = (id) =>
    guard(async () => {
      await api('/api/localtasks/item', {
        method: 'DELETE',
        body: { ...taskAddr(), id },
      });
      toast('已删除');
      await load();
    });

  // 删除整个主题（卡片上的「删除主题」）；等待中/全局共享池需二次确认并 force
  const deleteTopic = (t) =>
    guard(async () => {
      const msg = t.isGlobal
        ? `清空全局任务池（${t.total} 条任务）？所有 agent 的候补任务来源将消失，确认删除？`
        : t.waiting
        ? `主题「${t.name}」正在等待中，删除后其 agent 将超时收尾，确认删除？`
        : `删除主题「${t.name}」及其全部 ${t.total} 条任务？`;
      if (!window.confirm(msg)) return;
      setDeleting(true);
      try {
        await api('/api/localtasks/topic', {
          method: 'DELETE',
          body: t.isGlobal || t.waiting ? { key: t.key, force: true } : { key: t.key },
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

  // 关闭某主题的等待：只翻 store 里的 cancelRequested 标记，阻塞中的 wait 立即收尾。
  // 不删主题、不删任务、不动队列——历史照留，只是当前这一轮不等了。
  const cancelTopic = (t) =>
    guard(async () => {
      if (!t || !t.waiting) return;
      const msg = `关闭主题「${t.name}」的等待？\n\n阻塞中的 wait 立即收尾（走与超时同一条出口，agent 照常结束本轮），主题与任务都保留。`;
      if (!window.confirm(msg)) return;
      const r = await api('/api/localtasks/cancel', {
        method: 'POST',
        body: { key: t.key },
      });
      if (r && r.cancelled) toast('已关闭等待');
      else toast('该主题不在等待中');
      await load();
    });

  // 批量删除勾选主题；含等待中时 force 并提示；含全局共享池时说明保护语义
  const batchDelete = () =>
    guard(async () => {
      if (!selected.size) return;
      const sel = topics.filter((t) => selected.has(t.key));
      const waitingCount = sel.filter((t) => t.waiting).length;
      const globalCount = sel.filter((t) => t.isGlobal).length;
      const force = waitingCount > 0;
      let msg = `确认删除选中的 ${sel.length} 个主题？`;
      if (waitingCount) msg += `（其中 ${waitingCount} 个等待中，删除后其 agent 将超时收尾）`;
      if (globalCount) {
        msg += force
          ? `（含 ${globalCount} 个全局共享池，将一并删除）`
          : `（含 ${globalCount} 个全局共享池：受保护，将被跳过）`;
      }
      if (!window.confirm(msg)) return;
      setDeleting(true);
      try {
        const r = await api('/api/localtasks/topics/remove', {
          method: 'POST',
          body: { keys: [...selected], force },
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
          body: { ...taskAddr(), id: editingId, text: body },
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
          body: { ...taskAddr(), id, beforeId, afterId },
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
      <div className="board-toolbar card">
        <div className="board-heading">
          <strong>目录看板</strong>
          <span className="muted">{directoryRows.length} 个目录 · 等待中 {overview?.waiting || 0}</span>
          <span className="board-live">
            <span className={'board-live-dot ' + liveStatus} />
            {liveStatus === 'ok' ? '实时' : liveStatus === 'reconnecting' ? '重连中' : '连接中'}
          </span>
        </div>
        <div className="board-actions">
          <button className="btn small ghost" onClick={() => { setAddDirCwd(''); setModal({ title: '添加工作目录', addDirectory: true }); }}>添加目录</button>
          <button
            className="btn small ghost"
            onClick={batchDelete}
            disabled={!selected.size || deleting}
            title="删除勾选目录的主题与本地任务"
          >
            {deleting ? '删除中…' : `删除${selected.size ? ` (${selected.size})` : ''}`}
          </button>
          <button className="btn small" onClick={openSettings} aria-haspopup="dialog">设置</button>
        </div>
      </div>

      <div className="board-table-wrap">
        <table className="directory-board">
          <thead>
            <tr>
              <th className="board-check"></th>
              <th>目录 / 当前现状</th>
              <th>本地任务</th>
              <th>时间目标</th>
              <th className="board-ops">操作</th>
            </tr>
          </thead>
          <tbody>
            {directoryRows.map((row) => {
              const t = row.topic;
              const goal = row.goal;
              const goalState = goal ? timegoalStatus(goal) : null;
              return (
                <tr
                  key={row.key}
                  className={activeKey === row.key ? 'is-active' : ''}
                >
                  <td className="board-check">
                    {t && !t.isGlobal && (
                      <input
                        type="checkbox"
                        checked={selected.has(t.key)}
                        onChange={() => toggleSelect(t.key)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`选择目录 ${row.name}`}
                      />
                    )}
                  </td>
                  <td className="board-directory">
                    <div className="board-name-line">
                      <strong>{row.name}</strong>
                      {row.isGlobal && <span className="tag strong">全局池</span>}
                      {t?.manual && <span className="tag">已登记</span>}
                    </div>
                    <div className="mono muted board-cwd" title={row.cwd}>{row.cwd || '跨目录共享'}</div>
                    {t?.summary ? (
                      <button
                        className="board-summary"
                        onClick={() => setModal({ title: `目录「${row.name}」当前现状`, body: t.summary })}
                        title="查看完整现状"
                      >
                        {t.summary}
                      </button>
                    ) : <span className="board-summary muted">（暂无现状）</span>}
                  </td>
                  <td className="board-task-state">
                    {t ? (
                      <>
                        <span className={'tag' + (t.waiting ? ' strong' : '')}>
                          {t.isGlobal ? '共享任务池' : t.waiting ? (waitingBadge(t) || '等待中') : t.staleWaiting ? '等待已结束' : '空闲'}
                        </span>
                        <span className="board-count">{t.pending}/{t.total} 待领</span>
                        {t.waiting && (
                          <button className="btn small ghost" onClick={() => cancelTopic(t)} title="关闭当前等待">关闭等待</button>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="tag">未登记</span>
                        <button
                          className="btn small ghost"
                          onClick={() => {
                            setAddDirCwd(row.cwd);
                            setModal({ title: '添加工作目录', addDirectory: true });
                          }}
                          title="登记此目录，启用 localtask 队列"
                        >
                          登记队列
                        </button>
                      </>
                    )}
                  </td>
                  <td className="board-goal-state">
                    {goal ? (
                      <>
                        <button
                          className={'board-goal-label' + (goalState.reached ? ' reached' : '')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setModal({ title: `目录「${row.name}」的全局提示词`, body: goal.prompt });
                          }}
                          title="点击查看完整提示词原文"
                        >
                          {goalState.reached ? `已到点 · ${fmtClock(goalState.elapsedSec)}` : `剩余 ${fmtClock(goalState.remainingSec)}`}
                        </button>
                        <span className="muted board-deadline">截止 {goal.deadline}</span>
                      </>
                    ) : <span className="muted">未设置</span>}
                  </td>
                  <td className="board-ops">
                    {t && !t.isGlobal && (
                      <button
                        className="btn small ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveKey(t.key);
                          setShowQueue(true);
                        }}
                        title={showQueue && activeKey === t.key ? '收起该目录的任务队列' : '查看/回填该目录的任务队列'}
                      >
                        {showQueue && activeKey === t.key ? '收起任务' : '任务'}
                      </button>
                    )}
                    {goal ? (
                      <button
                        className="btn small ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setModal({ title: `编辑「${row.name}」的时间目标`, goalEdit: { cwd: row.cwd, name: row.name, goal } });
                        }}
                        title="编辑 timegoal 的时长和提示词"
                      >编辑目标</button>
                    ) : !row.isGlobal && (
                      <button
                        className="btn small ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setModal({ title: `设置「${row.name}」的时间目标`, goalEdit: { cwd: row.cwd, name: row.name, goal: null } });
                        }}
                        title="给该目录设置 timegoal"
                      >设置目标</button>
                    )}
                    {t && !t.isGlobal && (
                      <button className="btn small ghost" onClick={() => deleteTopic(t)} disabled={deleting} title="删除该目录的 localtask 队列">删除队列</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!directoryRows.length && (
              <tr><td colSpan="5" className="muted board-empty">（没有目录；点击「添加目录」，或运行 localtask wait 后自动出现）</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {active && showQueue && (
        <>
          <div className="toolbar">
            <span style={{ fontWeight: 700, maxWidth: 240 }} title={active.cwd}>
              {active.name}
            </span>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, whiteSpace: 'nowrap' }}
              title="推到全局共享池：任何目录的 agent 在本地队列空时自动领取（选中全局主题时只能推全局）"
            >
              <input
                type="checkbox"
                checked={!!active.isGlobal || toGlobal}
                disabled={!!active.isGlobal}
                onChange={(e) => setToGlobal(e.target.checked)}
              />
              全局
            </label>
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
              placeholder={
                active.isGlobal
                  ? '向全局任务池发布任务（任何目录的 agent 在本地空时自动领取；Enter 提交）'
                  : `向主题「${active.name}」的队列回填下一条任务（Enter 提交，Shift+Enter 换行）`
              }
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
                            <span
                              style={{ cursor: t.text.length > 50 ? 'zoom-in' : 'default' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (t.text.length > 50) setModal({ title: `任务 #${t.id} 全文`, body: t.text });
                              }}
                              title={t.text.length > 50 ? '点击查看完整任务文本' : undefined}
                            >
                              {t.text}
                            </span>
                            {t.roundSummary && (
                              <div
                                className="muted"
                                style={{ fontSize: 11, marginTop: 4, paddingTop: 4, borderTop: '1px dashed var(--line,#e6e8eb)', whiteSpace: 'pre-wrap', cursor: 'zoom-in' }}
                                title="点击查看完整上一轮总结"
                                onClick={(e) => { e.stopPropagation(); setModal({ title: '上一轮完成总结', body: t.roundSummary }); }}
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

      <div className="localtask-cli-reference">
        <details>
          <summary>CLI 命令参考</summary>
          <CliHints module="localtask" />
        </details>
      </div>

      {modal && (
        <div
          onClick={() => setModal(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 8, padding: 20, maxWidth: 'min(720px, 90vw)',
              maxHeight: '80vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: 14 }}>{modal.title}</strong>
              <button
                className="btn small ghost"
                onClick={() => setModal(null)}
                style={{ marginLeft: 'auto' }}
              >
                关闭
              </button>
            </div>
            {modal.settings ? (
              <div className="board-settings-dialog">
                <section className="board-setting-section">
                  <div className="board-setting-title">等待超时</div>
                  <div className="board-setting-control">
                    <select
                      value={timeoutSec}
                      disabled={cfgSaving}
                      onChange={(e) => saveTimeout(e.target.value)}
                      aria-label="本地任务 wait 等待超时"
                    >
                      <option value={60}>1 分钟</option>
                      <option value={120}>2 分钟</option>
                      <option value={180}>3 分钟（推荐）</option>
                      <option value={240}>4 分钟</option>
                      <option value={300}>5 分钟</option>
                      <option value={600}>10 分钟（最大）</option>
                    </select>
                    <span className="muted">agent wait 未带 --timeout 时使用；范围 1–10 分钟。</span>
                  </div>
                </section>

                <section className="board-setting-section">
                  <div className="board-setting-title">
                    收尾追加语
                    <span className={'tag' + (suffixEnabled ? ' strong' : '')}>{suffixEnabled ? '已开启' : '已关闭'}</span>
                  </div>
                  <div className="muted board-setting-help">
                    每次 wait 返回任务时拼到 task.text 末尾；用于提醒 agent 继续按当前工作方式收尾。
                  </div>
                  <textarea
                    value={suffixEditing ? suffixDraft : taskSuffix}
                    onChange={(e) => {
                      if (!suffixEditing) setSuffixEditing(true);
                      setSuffixDraft(e.target.value);
                    }}
                    rows={5}
                    aria-label="localtask 收尾追加语"
                    placeholder="留空关闭；填写后每次 wait 返回都会追加到任务文本"
                  />
                  <div className="board-setting-actions">
                    <button
                      className="btn small"
                      onClick={() => saveSuffix(suffixDraft)}
                      disabled={suffixSaving || (!suffixEditing && suffixDraft === taskSuffix)}
                    >{suffixSaving ? '保存中…' : '保存追加语'}</button>
                    <button className="btn small ghost" onClick={() => saveSuffix(defaultTaskSuffix)} disabled={suffixSaving}>
                      恢复默认
                    </button>
                    <button className="btn small ghost" onClick={disableSuffix} disabled={suffixSaving || !suffixEnabled}>
                      关闭追加语
                    </button>
                  </div>
                </section>

                <section className="board-setting-section board-timegoal-tools">
                  <div className="board-setting-title">时间目标回收</div>
                  <div className="muted board-setting-help">
                    已到点的 timegoal 不再运行，可从目录看板回收；未到点的目标、localtask 队列和任务历史不会被删除。
                  </div>
                  <button
                    className="btn small ghost"
                    onClick={recycleTimegoals}
                    disabled={recycling || !goalsList.some((goal) => timegoalStatus(goal).reached)}
                  >{recycling ? '回收中…' : `回收已到点 (${goalsList.filter((goal) => timegoalStatus(goal).reached).length})`}</button>
                </section>
              </div>
            ) : modal.addDirectory ? (
              <div className="board-add-directory">
                <label htmlFor="board-directory-path">工作目录路径</label>
                <input
                  id="board-directory-path"
                  value={addDirCwd}
                  onChange={(e) => setAddDirCwd(e.target.value)}
                  placeholder="例如 D:\\code\\my-project"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') addDirectory(); }}
                />
                <p className="muted">添加后会在目录看板常驻；同名目录与现有主题合并为一行。</p>
                <div className="board-setting-actions">
                  <button className="btn small" onClick={addDirectory} disabled={addDirBusy}>
                    {addDirBusy ? '添加中…' : '添加目录'}
                  </button>
                  <button className="btn small ghost" onClick={() => { setModal(null); setAddDirCwd(''); }} disabled={addDirBusy}>取消</button>
                </div>
              </div>
            ) : modal.goalEdit ? (
              // timegoal 编辑器：时长 + 全局提示词（新建/编辑共用）
              <GoalEditor
                init={modal.goalEdit}
                onSave={saveTimegoal}
                onCancel={() => setModal(null)}
              />
            ) : (
              <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {modal.body}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// 常用时长快捷键（秒）：面板上点一下就填进去，省得手打 10800
const GOAL_DURATION_PRESETS = [
  { label: '30 分钟', sec: 1800 },
  { label: '1 小时', sec: 3600 },
  { label: '2 小时', sec: 7200 },
  { label: '3 小时', sec: 10800 },
  { label: '8 小时', sec: 28800 },
];

// ─── timegoal 编辑器（modal.goalEdit 存在时被嵌入弹窗）───────────────
// 提到顶层组件是复用 React 的 hook 语义 + 文本状态隔离，避免在主 view 里多塞一组 state。
//
// 两种模式（靠 init.goal 是否为 null 区分）：
//   新建：时长默认 3 小时、提示词空
//   编辑：带出原时长与原提示词；默认**保留计时起点**（已用时间仍算数），
//         勾「重置起点」才从头计。
function GoalEditor({ init, onSave, onCancel }) {
  const goal = init.goal || null;
  const [cwdDraft, setCwdDraft] = useState(init.cwd || '');
  const [durText, setDurText] = useState(String(goal ? goal.durationSec : 10800));
  const [draft, setDraft] = useState(goal ? goal.prompt : '');
  const [resetStart, setResetStart] = useState(!goal);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    const cwd = String(cwdDraft || '').trim();
    if (!cwd) {
      // 由主视图的 guard 统一弹错；这里只拦一次，避免发出空 cwd 的请求
      window.alert('请填写目录路径（timegoal 绑定到某个工作目录）');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        cwd,
        name: init.name,
        durationSec: Number(durText),
        prompt: draft,
        resetStart,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {init.needCwd && (
        <div style={{ fontSize: 12, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>工作目录</div>
          <input
            type="text"
            value={cwdDraft}
            onChange={(e) => setCwdDraft(e.target.value)}
            placeholder="例如 D:\code\a_js\proj\nx-kv（agent 会以同一目录调 check）"
            style={{ width: '100%', font: 'inherit', padding: '6px 8px', boxSizing: 'border-box' }}
          />
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            timegoal 按「目录名」绑定；agent 在哪个目录跑，就用哪个目录。
          </div>
        </div>
      )}
      <div style={{ fontSize: 12, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700 }}>持续时长</span>
          <input
            type="number"
            min={60}
            max={86400}
            step={60}
            value={durText}
            onChange={(e) => setDurText(e.target.value)}
            style={{ width: 110, font: 'inherit', padding: '5px 8px' }}
          />
          <span className="muted">秒（60 - 86400，即 1 分钟 - 24 小时）</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {GOAL_DURATION_PRESETS.map((p) => (
            <button
              key={p.sec}
              className="btn small ghost"
              onClick={() => setDurText(String(p.sec))}
              title={`设为 ${p.sec} 秒`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {goal && (
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            当前：起点 {goal.startedAt} · 截止 {goal.deadline}
            {resetStart ? ' → 保存后会重设，计时从头开始' : ' → 起点保留，已用时间仍算数'}
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>全局提示词</div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={10}
        style={{ width: '100%', font: 'inherit', padding: 8, boxSizing: 'border-box', resize: 'vertical' }}
        placeholder="完整全局提示词原文（agent 每轮 timegoal check 会原样回显给它）"
      />
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        {draft.length} / 20000 字
      </div>

      {goal && (
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 8, cursor: 'pointer' }}
          title="勾上则重新开始计时（已用时间作废）；不勾则保留起点"
        >
          <input type="checkbox" checked={resetStart} onChange={(e) => setResetStart(e.target.checked)} />
          重置计时起点（当作新的一局）
        </label>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button className="btn small" disabled={saving} onClick={submit}>
          {saving ? '保存中…' : goal ? '保存' : '创建时间目标'}
        </button>
        <button className="btn small ghost" disabled={saving} onClick={onCancel}>取消</button>
        <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
          Ctrl+Enter 保存 · Esc 取消
        </span>
      </div>
      <KeyHandler onSave={submit} onCancel={onCancel} />
    </div>
  );
}

// 键盘：Ctrl+Enter 提交、Esc 取消。封成小组件只为 useEffect（不能在组件里 inline useEffect）。
function KeyHandler({ onSave, onCancel }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave, onCancel]);
  return null;
}
