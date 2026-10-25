// 本地任务（localtask）页：主题（按工作目录划分）总览 + 选中某个主题回填 + 该主题的任务队列。
// 本质是「agent 提交结果 → 阻塞 → 用户在 web 针对主题回填 → agent 接收」。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useToast, useGuard, Modal } from '../../web/frontend/components/ui.jsx';
import { CliHints } from '../../web/frontend/components/CliHints.jsx';
import {
  mergeDirectoryRows,
  withGlobalRow,
  globalPlaceholderTopic,
  splitQueueTasks,
} from './board.js';

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
// 把 7201s 格式化成 "2:00:01"。
// 以前不足 1 小时给的是 "5:30"——同一列里「剩余 5:30」和「剩余 1:05:30」并排，
// 人根本分不清 "5:30" 是 5 分还是 5 小时。统一成 h:mm:ss，一眼可读，且等宽不跳。
function fmtClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
// ⚠️ 这里原来有个 fmtDurHuman()（人话时长）。面板现在**不再显示超时多少**
// （到点即失效），它就没有用武之地了——死代码删掉，免得让人以为还能看到超时。
// CLI 侧有自己的实现（timegoal 模块），不受影响。

// ─── 领取耗时：发布 → 被领取 ────────────────────────────────────────────
//
// 「这条任务从发布到被 agent 领走，过了多久」——回答的是"队列积压了吗 /
// agent 响应快不快"。服务端已经把差值算好（task.pickupSec），还没被领的
// 任务要显示"已经挂了多久"，就在客户端按 createdAt 算（面板每 1.5s 刷一次）。
//
// 格式带单位（"4分31秒" / "1小时02分"），**不用** m:ss —— 之前踩过：
// 紧凑时钟用在时长上会被读成"5:47 是 5 分还是 5 小时"。
function fmtDurationShort(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${String(s % 60).padStart(2, '0')} 秒`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${String(m % 60).padStart(2, '0')} 分`;
}

// 发布至今（秒）：待领取任务"已经等了多久"。解析不了就 null（不显示，别瞎猜）。
function ageSecOf(t) {
  const created = timegoalDeadlineMs(t && t.createdAt);
  if (!Number.isFinite(created)) return null;
  return Math.max(0, Math.floor((Date.now() - created) / 1000));
}

// 客户端算 reached / remaining / overtime（数据每 1.5s 刷一次，不开 tick）
function timegoalStatus(goal) {
  const dl = timegoalDeadlineMs(goal && goal.deadline);
  const st = timegoalDeadlineMs(goal && goal.startedAt);
  if (!Number.isFinite(dl)) return { reached: true, remainingSec: 0, elapsedSec: 0, overtimeSec: 0 };
  const now = Date.now();
  const remainingSec = Math.max(0, Math.ceil((dl - now) / 1000));
  const elapsedSec = Math.max(
    0,
    Number.isFinite(st) ? Math.floor((now - st) / 1000) : 0
  );
  const reached = dl <= now;
  // 超时多久：到点之后继续走。"已到点"不再是一句静止的标签，
  // 而是"已经超时 2 小时 13 分"这样能看出严重程度的量。
  const overtimeSec = reached ? Math.max(0, Math.floor((now - dl) / 1000)) : 0;
  return { reached, remainingSec, elapsedSec, overtimeSec };
}

export default function SessionTaskView() {
  const toast = useToast();
  const guard = useGuard();

  const [overview, setOverview] = useState(null);
  const [activeKey, setActiveKey] = useState(null);
  // 深链：wait 打开的 `#/localtask?key=…&cwd=…` 要能**选中并展开**那个队列。
  // 以前前端根本不解析 query（App 的 hash 匹配也因为带 query 而落空），
  // 于是弹窗每次都停在"没选中任何主题"的看板上——用户根本不知道该往哪填。
  const readDeepLink = () => {
    const q = (location.hash || '').split('?')[1];
    if (!q) return null;
    const params = new URLSearchParams(q);
    const key = params.get('key') || '';
    const cwd = params.get('cwd') || '';
    return key || cwd ? { key, cwd } : null;
  };
  const [deepLink, setDeepLink] = useState(readDeepLink);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  // 投递目标 = 当前打开的队列（activeKey）。**不再有「全局」复选框**：
  // 以前"选中目录"和"勾了全局"两个状态各管一半，切目录时勾选还留着，
  // 任务会静默投进全局池——这正是"提交逻辑混乱"的根源。
  // 现在只有一个概念：**投递目标**，改哪儿任务就投哪儿，一眼可见。
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
  // 「等待设置弹窗」：agent 用法 + 等待超时 + 收尾追加语（少用，平时收进弹窗，不占顶部）
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  // 已到点（失效）的时间目标：面板上**不再显示**（到点即失效），
  // 但这里仍要知道"这个目录有过一个已失效的目标"——那格要留空，而不是谎称「未设置」。
  const [archivedGoals, setArchivedGoals] = useState([]);
  // 设置 / 添加目录 都收进按钮 + 弹窗（原来常驻卡片占掉大半屏）
  const [addDirCwd, setAddDirCwd] = useState('');
  const [addDirBusy, setAddDirBusy] = useState(false);
  // 队列面板默认**开着**：新装的面板上，工具栏已经写着投递目标，却找不到输入框
  // ——用户以为面板坏了。现在一进来就能写。
  const [showQueue, setShowQueue] = useState(true);

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
      setGoalsList((t && t.goals) || []);
      setArchivedGoals((t && t.archived) || []);
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

  // 深链变化（另一个 wait 又开了一次深链）→ 重新读
  useEffect(() => {
    const onHash = () => setDeepLink(readDeepLink());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // 实时刷新：主题状态/倒计时、任务是否被取走，每 1.5s 轮询
  useEffect(() => {
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load]);

  // 切回标签时立刻刷一次：浏览器会把后台标签的定时器节流（实测节流到 ~60s，
  // 久了还会冻结页面），1.5s 的轮询可能停摆很久——用户切回来看到的应该是
  // **当下**的队列，而不是几分钟前的快照。
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
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
  // 全局池恒有一行（没有真主题时补占位行）——永远找得到往全局池加任务的入口。
  const directoryRows = withGlobalRow(mergeDirectoryRows(topics, goalsList));

  // 看板按**目录名**排（稳定）：后端按 updatedAt 排的话，任意一次领取都会让整张表
  // 重排，行会在光标底下跳走。名字排序是可预期的（全局池仍置顶）。
  // （必须放在 directoryRows 之后 —— 提前声明会撞上 const 的 TDZ。）
  const boardRows = useMemo(
    () =>
      [...directoryRows].sort(
        (a, b) =>
          Number(!!b.isGlobal) - Number(!!a.isGlobal) ||
          String(a.name).localeCompare(String(b.name))
      ),
    [directoryRows]
  );

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

  // 列表接口**不返回完整 prompt**（每个上限 20000 字，而面板每 1.5s 拉一次 list）。
  // 所以要看全文、要编辑时，按目录单独取一次 —— 否则编辑框里只有预览，
  // 一存就把用户的提示词截断了。
  const fetchGoal = async (cwd) => {
    const d = await api(`/api/timegoals?cwd=${encodeURIComponent(cwd)}`);
    return (d && d.goal) || null;
  };

  const showGoalPrompt = (goal) =>
    guard(async () => {
      try {
        const full = await fetchGoal(goal.cwd);
        setModal({
          title: `目录「${goal.name}」的全局提示词`,
          body: (full && full.prompt) || '（读不到提示词）',
        });
      } catch (e) {
        toast(String((e && e.message) || e));
      }
    });

  const editGoal = (goal) =>
    guard(async () => {
      try {
        const full = await fetchGoal(goal.cwd);
        setModal({
          title: `编辑「${goal.name}」的时间目标`,
          goalEdit: { cwd: goal.cwd, name: goal.name, goal: full },
        });
      } catch (e) {
        toast(String((e && e.message) || e));
      }
    });

  // timegoal 编辑器（set/update）直接写独立模块的 API，不改写 localtask topic。
  const saveTimegoal = ({ cwd, name, durationSec, prompt, resetStart }) =>
    guard(async () => {
      const body = String(prompt || '').trim();
      if (!body) {
        toast('提示词不能为空');
        return;
      }
      const dur = Number(durationSec);
      // 上限跟 timegoal service 的 MAX_DURATION_SEC 一致（365 天）。这里不 import
      // service —— 它带 node:crypto/fs，进前端 bundle 会炸。
      if (!Number.isFinite(dur) || dur < 60 || dur > 365 * 24 * 3600) {
        toast('时长需在 1 分钟到 365 天之间');
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

  const openSettings = () => {
    setSuffixDraft(taskSuffix);
    setSuffixEditing(false);
    setModal({ title: '看板设置', settings: true });
  };

  // 默认选中：优先等待中的，否则第一个；用户已选且仍存在则保留
  useEffect(() => {
    if (!directoryRows.length) {
      setActiveKey(null);
      return;
    }
    if (activeKey && directoryRows.some((r) => r.key === activeKey)) {
      if (deepLink) setDeepLink(null);
      return;
    }
    // 深链优先（key 定位全局池，cwd 定位目录）
    const fromLink =
      deepLink &&
      ((deepLink.key && directoryRows.find((r) => r.key === deepLink.key)) ||
        (deepLink.cwd ? directoryRows.find((r) => r.cwd === deepLink.cwd) : null));
    // 否则选默认：优先正在等待的队列，其次第一行
    const hit =
      fromLink ||
      directoryRows.find((r) => r.topic && r.topic.waiting) ||
      directoryRows[0];
    if (!hit) return;
    setActiveKey(hit.key);
    // 只有深链才自动展开队列（用户自己点开的就别抢）
    if (fromLink) setShowQueue(true);
    setDeepLink(null);
  }, [directoryRows, activeKey, deepLink]);

  // 主题被删除后，从勾选集合里剔除失效 key
  useEffect(() => {
    setSelected((s) => {
      const valid = new Set([...s].filter((k) => topics.some((t) => t.key === k)));
      return valid.size === s.size ? s : valid;
    });
  }, [topics]);

  // 当前打开的队列：可能是真主题，也可能是全局池占位行。
  // 「投递目标」= 这个队列 —— 新任务就投到这里，没有第二套状态。
  const activeRow = directoryRows.find((r) => r.key === activeKey) || null;
  const active = activeRow
    ? activeRow.topic || (activeRow.isGlobal ? globalPlaceholderTopic() : null)
    : null;

  const toggleSelect = (key) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  // 表头那一列原本是个没内容的空格子，看着像忘了画。给它一个真正的「全选」：
  // 可勾选的只有真实目录（全局池行没有勾选框），批量删除也多一个入口。
  const selectableTopics = topics.filter((t) => !t.isGlobal);
  const allSelected =
    selectableTopics.length > 0 && selectableTopics.every((t) => selected.has(t.key));
  const toggleSelectAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allSelected) selectableTopics.forEach((t) => n.delete(t.key));
      else selectableTopics.forEach((t) => n.add(t.key));
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
        toast('请先选择投递目标（全局任务池或某个目录）');
        return;
      }
      // 投递目标只有一个来源：当前打开的队列。全局池走 global:true（不带 cwd），
      // 目录队列走 cwd —— 没有"勾了全局但选中的是目录"这种中间态了。
      const useGlobal = !!active.isGlobal;
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
      toast('已删除（可在本页「已删除」区恢复）');
      await load();
    });

  // 恢复一条被软删除的任务（撤销删除）
  const restore = (id) =>
    guard(async () => {
      await api('/api/localtasks/tasks/restore', {
        method: 'POST',
        body: { ...taskAddr(), id },
      });
      toast('已恢复');
      await load();
    });

  // 彻底清除一条已删除的任务（不可恢复）
  const purge = (id) =>
    guard(async () => {
      // 用 window.confirm（与本文件其它删除确认一致）——这个视图没有接 useDialog，
      // 之前误用 dialog() 会直接抛 "dialog is not defined"，按钮点了就炸。
      const ok = window.confirm('彻底删除这条已删任务？删掉就找不回来了（软删除还能恢复，这里是终态）。');
      if (!ok) return;
      await api('/api/localtasks/item', {
        method: 'DELETE',
        body: { ...taskAddr(), id, purge: true },
      });
      toast('已彻底删除');
      await load();
    });

  // 删除整个主题（卡片上的「删除主题」）；等待中/全局共享池需二次确认并 force
  const deleteTopic = (t) =>
    guard(async () => {
      const pending = t.pending || 0;
      const msg = t.isGlobal
        ? `清空全局任务池（${t.total} 条任务）？所有 agent 的候补任务来源将消失，确认删除？`
        : t.waiting
        ? `主题「${t.name}」正在等待中，删除后其 agent 将超时收尾，确认删除？`
        : pending
        ? `删除主题「${t.name}」？\n\n其中 ${pending} 条**未领取**的任务会一并丢掉（还没有任何 agent 领过）。确认删除？`
        : `删除主题「${t.name}」及其全部 ${t.total} 条任务？`;
      if (!window.confirm(msg)) return;
      setDeleting(true);
      try {
        await api('/api/localtasks/topic', {
          method: 'DELETE',
          // 确认框已经把"会丢什么"说清楚了，用户点了确认就照做（force）。
          // 服务端的 deleteGuard 是 CLI 侧的兜底，不是给面板使绊子的。
          body: t.isGlobal || t.waiting || (t.pending || 0) > 0 ? { key: t.key, force: true } : { key: t.key },
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
      const pendingCount = sel.reduce((n, t) => n + (t.pending || 0), 0);
      if (pendingCount) msg += `（其中共 ${pendingCount} 条未领取任务会被一并丢掉）`;
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

  // 队列表拆成两段：**待领取**在上（默认展开），**已领取历史**折叠在下面。
  // 以前所有任务平铺一张表，历史一多就把"还有几条没人领"淹没了——
  // 「之前的历史也看不到」说的就是这个。
  // ⚠️ 待领取必须按**领取顺序**排（= store 数组顺序，与 CLI 的 `#1 -> #2 -> #3` 一致）：
  // 以前面板做了 slice().reverse()，于是**最上面那一行其实最后才被领**，
  // 点「提前」把某行提到前面，屏幕上它反而下移——看着像坏了，其实顺序反了。
  const allTasks = active ? active.tasks : [];
  // ⚠️ **软删除的任务必须从待领取/已领取里排除**（拆分的口径在 board.js 的
  // splitQueueTasks 里，服务端派发也是按 `!deletedAt` 过滤的）。
  // 以前视图只按 status 过滤，于是删掉的任务仍然留在「待领取」表里：
  // 用户点了删除、行纹丝不动（deletedAt 又被设成同一个值），再点也没反应——
  // 表现就是「这个任务我删不掉」。
  const { pending: pendingTasks, consumed: consumedTasks, deleted: deletedTasks } = splitQueueTasks(allTasks);

  // 待领取任务按「领取优先级」（数组真实顺序，未反转）排列；上移/置后据此定位相邻项。
  // 与 pendingTasks 同一份数据、同一顺序，只是换个名字表达"优先级序列"。
  const pendingOrder = pendingTasks;

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
          {/* 全局池不是目录，别混进「N 个目录」里（CLI 的 list 里也没有这一行，
              两边的口径得对得上）。 */}
          <span className="muted">
            {directoryRows.filter((r) => !r.isGlobal).length} 个目录 + 全局池 · 等待中 {overview?.waiting || 0}
          </span>
          <span className="board-live">
            <span className={'board-live-dot ' + liveStatus} />
            {liveStatus === 'ok' ? '实时' : liveStatus === 'reconnecting' ? '重连中' : '连接中'}
          </span>
          {/* 首屏还没拿到数据时把话说清楚：别让用户以为面板坏了。
              浏览器把后台标签冻结时也会停在这里——切到该标签即恢复。 */}
          {liveStatus === 'connecting' && !overview ? (
            <span className="muted" style={{ fontSize: 12 }}>
              正在连接本机服务…（浏览器冻结后台标签时也会停在这儿，切到该标签即恢复）
            </span>
          ) : null}
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
          <button className="btn small" onClick={openSettings} aria-haspopup="dialog">看板设置</button>
        </div>
      </div>

      <div className="board-table-wrap">
        <table className="directory-board">
          <thead>
            <tr>
              <th className="board-check">
                {selectableTopics.length > 0 && (
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="全选目录"
                    title={allSelected ? '取消全选' : `全选 ${selectableTopics.length} 个目录（可批量删除）`}
                  />
                )}
              </th>
              <th className="board-directory">目录 / 当前现状</th>
              <th className="board-task-state">本地任务</th>
              <th className="board-goal-state">时间目标</th>
              <th className="board-ops">操作</th>
            </tr>
          </thead>
          <tbody>
            {boardRows.map((row) => {
              const t = row.topic;
              const goal = row.goal;
              // 归档里的目标（到点自动归档）：行里要显示"已到点"，不是"未设置"
              const archivedGoal = archivedGoals.find((g) => g.key === row.key) || null;
              const goalState = goal ? timegoalStatus(goal) : null;
              // 路径只留末两段（父目录/目录名），祖先目录变暗——全路径进 title。
              const cwdTail = row.cwd ? row.cwd.split(/[\\/]+/).filter(Boolean).slice(-2) : [];
              return (
                <tr
                  key={row.key}
                  className={activeKey === row.key ? 'is-active' : ''}
                  data-state={
                    row.isGlobal
                      ? 'pool'
                      : t && t.waiting
                      ? 'live'
                      : t && t.staleWaiting
                      ? 'stale'
                      : 'idle'
                  }
                  style={(t || row.isGlobal) ? { cursor: 'pointer' } : undefined}
                  onClick={() => {
                    // 点行 = 选中这一行的队列（投递目标随之切换）
                    if (!t && !row.isGlobal) return;
                    setActiveKey(row.key);
                    setShowQueue(true);
                  }}
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
                    {/* 目录格以前竖着塞了 4 段（名/路径/现状/提交说明），行高 93px，
                        比 GitLab 的 64px 高一大截，一屏只看得到 5 个目录。
                        现在压成 2 行：① 名 + 徽标 + 路径 ② 现状 + 提交说明。
                        完整信息没丢——路径和提交说明都在 title / 点击里。 */}
                    <div className="board-name-line">
                      <strong>{row.name}</strong>
                      {row.isGlobal && <span className="tag badge">全局池</span>}
                      {t?.manual && <span className="tag">已登记</span>}
                      {/* 仓库上下文：这个目录属于哪个已登记仓库。一枚 chip 一行不占。
                          看板归属不在本地任务页显示（太吵）——要看去「仓库」页。 */}
                      {t?.repo && (
                        <span
                          className="tag repo-boards"
                          title={`仓库「${t.repo.name}」${t.repo.desc ? '：' + t.repo.desc : ''}`}
                        >
                          {t.repo.name}
                        </span>
                      )}
                      {row.cwd && cwdTail.length > 0 && (
                        <span
                          className="mono board-cwd"
                          title={
                            `${row.cwd}\n队列按目录名识别：同名目录共用同一队列（这里显示的路径可能被同名目录覆盖）` +
                            (t && t.cwds && t.cwds.length > 1 ? `\n用过这个队列的路径：${t.cwds.join('、')}` : '')
                          }
                        >
                          {cwdTail.length > 1 && <span className="anc">{cwdTail.slice(0, -1).join('/')}/</span>}
                          {cwdTail[cwdTail.length - 1]}
                        </span>
                      )}
                    </div>
                    <div className="board-summary-line">
                      {t?.summary ? (
                        <button
                          className="board-summary"
                          onClick={() => setModal({ title: `目录「${row.name}」当前现状`, body: t.summary })}
                          title="查看完整现状"
                        >
                          {t.summary}
                        </button>
                      ) : <span className="board-summary muted">（暂无现状）</span>}
                      {/* 提交方的补充说明与 agent 的「当前现状」分开显示：
                          以前两者抢同一个字段，谁后写谁覆盖，面板上的现状会乱跳。 */}
                      {t?.submitSummary ? (
                        <button
                          className="board-submit"
                          onClick={(e) => {
                            e.stopPropagation();
                            setModal({ title: `目录「${row.name}」的提交说明`, body: t.submitSummary });
                          }}
                          title="提交这条任务时留下的补充说明"
                        >
                          · {t.submitSummary}
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="board-task-state">
                    {t || row.isGlobal ? (
                      <>
                        {/* 状态与「关闭等待」同一行：这个按钮单独占一行时，
                            等待中的那行会撑到 80px，而别的行只有 56px ——
                            整张板子的行高就不齐了。 */}
                        <div className="board-status-row">
                          <span
                            className={
                              'board-status ' +
                              (row.isGlobal
                                ? 'pool'
                                : t && t.waiting
                                ? 'live'
                                : t && t.staleWaiting
                                ? 'stale'
                                : '')
                            }
                            title={
                              row.isGlobal
                                ? '全局共享池：任何目录的 agent 在本地队列空时自动领取'
                                : t && t.waiting
                                ? '有 agent 正阻塞在这个队列上等待回填'
                                : t && t.staleWaiting
                                ? '上一次等待已超时结束'
                                : '没有 agent 正在这个队列上等待（队列里待领的任务照样能被领走）'
                            }
                          >
                            {row.isGlobal
                              ? '共享任务池'
                              : t && t.waiting
                              ? (waitingBadge(t) || '等待中')
                              : t && t.staleWaiting
                              ? '等待已结束'
                              : '空闲'}
                          </span>
                          {t && t.waiting && (
                            <button className="btn small ghost board-wait-stop" onClick={() => cancelTopic(t)} title="关闭当前等待">
                              关闭等待
                            </button>
                          )}
                        </div>
                        <span className="board-count">
                          {t ? (
                            <>
                              <b>{t.pending}</b>/<b>{t.total}</b> 待领
                              {t.consumed ? <><span className="sep-dot">·</span><b>{t.consumed}</b> 已领</> : null}
                              {t.deleted ? <><span className="sep-dot">·</span><b>{t.deleted}</b> 已删</> : null}
                            </>
                          ) : (
                            '0/0 待领'
                          )}
                        </span>
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
                            showGoalPrompt(goal);
                          }}
                          title={`点击查看完整提示词原文（已记录 ${goal.totalChecks || goal.logCount || 0} 轮检查${goal.logTruncated ? '，日志只留最近 ' + goal.logCount + ' 条' : ''}）`}
                        >
                          {goalState.reached
                            ? '已到点'
                            : `剩余 ${fmtClock(goalState.remainingSec)}`}
                        </button>
                        <span className="muted board-deadline">截止 {goal.deadline}</span>
                      </>
                    ) : archivedGoal ? (
                      // ⚠️ **到点即失效**：这一格留空。
                      // 以前写「已到点」（后来又加过「· 超时 2:46:07」）——一个已经
                      // 结束的目标不该继续占着界面，更不该摆一个还在走的超时钟。
                      // 失效 = 面板上不再有它（保留期一到 store 里也自动删掉）。
                      // 从没设过的目录才写「未设置」——那两件事不一样。
                      <span className="board-goal-gone" title="这个目录的时间目标已经到点失效了；需要继续就点「设置目标」开新一局" />
                    ) : <span className="muted">未设置</span>}
                  </td>
                  <td className="board-ops">
                    {/* 全局池也必须有这个入口 —— 以前只有非全局行才有，
                        于是"全局池里没任务"时连全局池的队列都打不开，
                        历史也看不到。 */}
                    {(t || row.isGlobal) && (
                      <button
                        className="btn small ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveKey(row.key);
                          setShowQueue(true);
                        }}
                        title={row.isGlobal
                          ? '查看/回填全局任务池的任务队列'
                          : showQueue && activeKey === row.key ? '收起该目录的任务队列' : '查看/回填该目录的任务队列'}
                      >
                        {showQueue && activeKey === row.key ? '收起任务' : '任务'}
                      </button>
                    )}
                    {/* 全局池也能**从远程导入**（#73：「全局任务也可以从远程进行导入」）。
                        全局池的导入落点就是全局池本身。 */}
                    {row.isGlobal && (
                      <button
                        className="btn small ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setModal({
                            title: '从远程清单导入到全局任务池',
                            importRemote: { global: true, cwd: '', name: '全局任务池' },
                          });
                        }}
                        title="把远程（KV 后端）上还没人领的任务勾几条搬进全局任务池"
                      >
                        导入
                      </button>
                    )}
                    {/* 每个项目目录**单独**也能从远程导入（#73：「全局任务栏里面，队列栏
                        里面也可以从中提取」）——不用先点开它的队列，直接在看板这一行
                        把远程任务搬进这个目录的队列。 */}
                    {!row.isGlobal && (
                      <button
                        className="btn small ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setModal({
                            title: `从远程清单导入到「${row.name}」的队列`,
                            importRemote: { global: false, cwd: row.cwd, name: row.name },
                          });
                        }}
                        title={`把远程（KV 后端）上还没人领的任务勾几条搬进「${row.name}」的队列`}
                      >
                        导入
                      </button>
                    )}
                    {goal ? (
                      <button
                        className="btn small ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          editGoal(goal);
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

      {/* 「已到点自动归档」区整个删掉了。
          到点 = 失效：面板上**不再显示**已经结束的目标（一个失效的东西不该
          继续占着界面），也不需要用户再去点「彻底清除」——保留期一到它自己
          就没了（timegoal service 的 autoRecycle）。agent 最后一轮 check 仍
          能在保留期内读到 reached:true + 提示词原文（契约不破），
          CLI 的 `timegoal show / check / log / prune` 也照旧能用。 */}

      {active && showQueue && (
        <>
          {/* 仓库上下文提示：投递到这个目录时，先告诉用户「这是哪个仓库、干什么用」——
              写任务时不用再切到「仓库」页去查。看板归属不在这里显示。 */}
          {active.repo && (
            <div className="compose-context">
              <span className="repo-name">仓库 {active.repo.name}</span>
              {active.repo.desc ? <span className="repo-desc">{active.repo.desc}</span> : null}
            </div>
          )}
          <div className="toolbar compose-toolbar">
            <label className="compose-label">投递到</label>
            <div className="compose-bar">
              <select
                value={activeKey || ''}
                onChange={(e) => {
                  // 换投递目标时**清空草稿**：留着上一条目标的文字，用户一点提交
                  // 就把旧草稿投进了新队列（"这条本来要投给全局池"结果进了 nx-kv）。
                  // 这是提交逻辑最容易被误解的一处，宁可少一次编辑，也不要投错。
                  setText('');
                  setActiveKey(e.target.value);
                  setShowQueue(true);
                }}
                title={
                  active.isGlobal
                    ? '全局任务池：任何目录的 agent 在本地队列空闲时自动领取'
                    : `主题「${active.name}」：按目录名认队列，同名目录的 agent 都会领这条`
                }
              >
                <option value="">（选择投递目标…）</option>
                {boardRows.filter((r) => r.isGlobal).map((r) => (
                  <option key={r.key} value={r.key}>全局任务池（任何目录都能领）</option>
                ))}
                {boardRows.filter((r) => !r.isGlobal && r.topic).map((r) => (
                  <option key={r.key} value={r.key}>{r.name} · {r.cwd}</option>
                ))}
              </select>
              <textarea
                spellCheck="false"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                aria-label="任务内容"
                placeholder={
                  active.isGlobal
                    ? '任务标题，Enter 提交'
                    : `投递到「${active.name}」，Enter 提交`
                }
              />
              <button
                className="btn"
                onClick={submit}
                disabled={saving}
                title={active.isGlobal ? '发布到全局任务池（Enter 提交）' : `投递到「${active.name}」的队列（Enter 提交）`}
              >
                {saving ? '提交中…' : active.isGlobal ? '发布到全局池' : '投递到队列'}
              </button>
            </div>
            {/* 从远程清单导入：队列面板与全局池各一个入口（#73）。
                弹窗里勾选远程未完成的任务，逐条搬进当前这个队列。 */}
            <div className="import-remote-entry">
              <button
                className="btn small ghost"
                onClick={() => setModal({ title: '从远程清单导入任务', importRemote: { global: !!active.isGlobal, cwd: active.cwd, name: active.name } })}
                title="把远程（KV 后端）上还没人领的任务勾几条搬进这个队列"
              >
                从远程导入
              </button>
              <span className="muted">
                远程清单里还没人领的任务，可以勾几条搬进这里；搬完远程那条自动标记为已完成
              </span>
            </div>
          </div>

          <div className="colhead">
            <h3>{active.isGlobal ? '全局任务池的队列' : '该主题的任务队列'}</h3>
            <span className="muted">
              {/* 「已领取」用 active.consumed，别用 total - pending：
                  total 含软删除的行，减去 pending 会把删掉的也算成"已领"（全局池 35-4=31，
                  实际已领 30、已删 1）。三个数各归各，口径与服务端一致。 */}
              待领取 {active.pending} · 已领取 {active.consumed}
              {active.deleted ? ` · 已删 ${active.deleted}` : ''} · 共 {active.total} 条
            </span>
            <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
              拖拽可调整领取顺序
            </span>
          </div>

          <div className="card queue-wrap" style={{ padding: 4 }}>
            <table className="queue-table">
              <colgroup>
                <col className="c-drag" />
                <col className="c-id" />
                <col />
                <col className="c-status" />
                <col className="c-time" />
                <col className="c-ops" />
              </colgroup>
              <thead>
                <tr>
                  <th></th>
                  <th>#</th>
                  <th>任务</th>
                  <th>状态</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pendingTasks.length ? (
                  pendingTasks.map((t) => {
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
                      <td className="task-text">
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
                        <span className={'board-status ' + (t.status === 'consumed' ? 'done' : 'pend')}>
                          {t.status === 'consumed' ? '已领取' : '待领取'}
                        </span>
                        {/* 领取耗时：待领取的显示"已经挂了多久"（发布至今），
                            已领取的显示实际差值（发布 → 被领）。 */}
                        {t.status === 'consumed' ? (
                          Number.isFinite(t.pickupSec) ? (
                            <div className="muted board-pickup" title="从发布到被领取的时间差">
                              等 {fmtDurationShort(t.pickupSec)} 被领
                            </div>
                          ) : null
                        ) : (() => {
                          const age = ageSecOf(t);
                          return Number.isFinite(age) ? (
                            <div className="muted board-pickup" title="这条任务发布后已经等了多久（被领走时就是领取耗时）">
                              已等 {fmtDurationShort(age)}
                            </div>
                          ) : null;
                        })()}
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
                    <td colSpan="6">
                      <div className="board-empty">
                        <div className="board-empty-mark" />
                        <div className="board-empty-title">这个队列还没有待领取的任务</div>
                        <div className="board-empty-sub">在上方写一条，回车提交就会排进队列</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 已领取历史：折叠在下面。默认只看"还有几条没人领"，想复盘再展开。 */}
          {consumedTasks.length ? (
            <details className="fold-row">
              <summary>
                已领取历史（{consumedTasks.length} 条）
              </summary>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>#</th>
                    <th>任务</th>
                    <th style={{ width: 132 }}>状态</th>
                    <th style={{ width: 150 }}>时间</th>
                    <th style={{ width: 80 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {consumedTasks.map((t) => (
                    <tr key={t.id}>
                      <td className="mono">#{t.id}</td>
                      <td style={{ whiteSpace: 'pre-wrap' }}>
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
                      </td>
                      <td>
                        <span className="tag strong">已领取</span>
                        {/* 领取耗时：发布 → 被领取过了多久 */}
                        {Number.isFinite(t.pickupSec) ? (
                          <div className="muted board-pickup" title="从发布到被领取的时间差">
                            等 {fmtDurationShort(t.pickupSec)} 被领
                          </div>
                        ) : null}
                        {/* 领取审计：从哪个池被领走、被谁领走 */}
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {t.claimedFrom === 'global' ? '来自全局池' : '来自本目录队列'}
                          {t.claimedByName ? ` · 由「${t.claimedByName}」领取` : ''}
                        </div>
                      </td>
                      <td className="mono">{t.consumedAt || t.createdAt}</td>
                      <td className="ops">
                        <button className="btn small ghost" onClick={() => remove(t.id)}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
          {/* 已删除（软删除）：可恢复。删除不再是不可逆的一步。 */}
          {deletedTasks.length ? (
            <details className="fold-row">
              <summary>
                已删除（{deletedTasks.length} 条，可恢复）
              </summary>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>#</th>
                    <th>任务</th>
                    <th style={{ width: 160 }}>删除于</th>
                    <th style={{ width: 140 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {deletedTasks.map((t) => (
                    <tr key={t.id}>
                      <td className="mono">#{t.id}</td>
                      <td style={{ whiteSpace: 'pre-wrap' }}>{t.text}</td>
                      <td className="mono">{t.deletedAt}</td>
                      <td className="ops">
                        <button className="btn small ghost" onClick={() => restore(t.id)}>恢复</button>
                        <button className="btn small ghost danger" onClick={() => purge(t.id)}>彻底清除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
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
            {modal.importRemote ? (
              <ImportRemoteDialog
                target={modal.importRemote}
                onClose={() => setModal(null)}
                onDone={(r) => {
                  setModal(null);
                  toast((r && r.message) || '已导入');
                  load();
                }}
              />
            ) : modal.settings ? (
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
                      {/* CLI 接受 1-600 任意秒数（`--timeout 90` 这种），
                          但下拉只有 6 档 —— 值不在档位里时浏览器会显示**空白下拉**，
                          看着像没设置。这里把当前值补成一个选项，永远显示真值。 */}
                      {!TIMEOUT_PRESETS.includes(Number(timeoutSec)) ? (
                        <option value={timeoutSec}>{timeoutSec} 秒（当前值）</option>
                      ) : null}
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
                  <div className="board-setting-title">时间目标的生命周期</div>
                  <div className="muted board-setting-help">
                    时间目标到点即失效：面板上不再显示，保留期内 agent 仍能读到提示词原文
                    （最后一轮 check 要用），保留期（默认 7 天）一到自动彻底删除，
                    不需要手动清理。仍在运行的目标、localtask 队列与任务历史不受影响。
                  </div>
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

// 等待超时的档位（秒）。CLI 接受 1-600 任意值，这里只是快捷选项。
const TIMEOUT_PRESETS = [60, 120, 180, 240, 300, 600];

// 常用时长快捷键：点一下就填进去，省得手打 10800。
// 单位跟人说话一致（分钟/小时/天），不再逼用户心算秒数。
const GOAL_UNITS = [
  { key: 'min', label: '分钟', sec: 60 },
  { key: 'hour', label: '小时', sec: 3600 },
  { key: 'day', label: '天', sec: 86400 },
];

const GOAL_DURATION_PRESETS = [
  { label: '30 分钟', value: 30, unit: 'min' },
  { label: '1 小时', value: 1, unit: 'hour' },
  { label: '2 小时', value: 2, unit: 'hour' },
  { label: '3 小时', value: 3, unit: 'hour' },
  { label: '5 小时', value: 5, unit: 'hour' },
  { label: '8 小时', value: 8, unit: 'hour' },
  { label: '24 小时', value: 24, unit: 'hour' },
];

// 从已有 goal 反推一个"人能看懂"的初始值：优先按天，其次小时，最后分钟。
// ─── 从远程清单导入（子弹窗）──────────────────────────────────────────
//
// 「提交方 → 远程清单 → 本地队列」的最后一公里：把远程还没人领的任务勾几条搬进本地队列。
// 导入完成后远程那条会被标记为已完成（服务端做的，note 写明被哪个队列领走），
// 所以这里**只做选择与发起**，不做任何本地/远程状态判断。
//
// 弹窗里只拉 `status=open`：远程的 done 历史可能有几百条，面板每 1.5s 轮询一次，
// 拉全量会把一坨历史塞进内存。
function ImportRemoteDialog({ target, onClose, onDone }) {
  const [tasks, setTasks] = useState(null);
  const [topics, setTopics] = useState([]);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    api('/api/todo?status=open')
      .then((d) => {
        if (!alive) return;
        setTasks(Array.isArray(d && d.open) ? d.open : []);
        setTopics(Array.isArray(d && d.topics) ? d.topics : []);
      })
      .catch((e) => {
        if (!alive) return;
        // 远程不可达 / 未登录：明说原因，不给一个空列表装作"没有任务"
        setErr(String((e && e.message) || e));
        setTasks([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const shown = (tasks || []).filter((t) => !filter || t.topic === filter);
  const toggle = (text) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(text)) n.delete(text);
      else n.add(text);
      return n;
    });

  const doImport = async () => {
    if (!picked.size) return;
    setBusy(true);
    setErr('');
    try {
      const body = {
        refs: [...picked],
        ...(target && target.global ? { global: true } : { cwd: target && target.cwd }),
      };
      const r = await api('/api/localtasks/import-remote', { method: 'POST', body });
      onDone(r);
    } catch (e) {
      setErr(String((e && e.message) || e));
      setBusy(false);
    }
  };

  return (
    <div className="import-remote">
      <div className="import-remote-bar">
        <label>
          主题
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">全部（{tasks ? tasks.length : 0} 条未完成）</option>
            {topics.map((t) => (
              <option key={t} value={t}>
                {t}（{(tasks || []).filter((x) => x.topic === t).length}）
              </option>
            ))}
          </select>
        </label>
        <span className="muted">
          导入到：<strong>{target && target.global ? '全局任务池' : (target && target.name) || '当前队列'}</strong>
          {' · '}勾选后逐条导入，远程那条会标记为已完成
        </span>
      </div>

      {err ? <div className="import-remote-err">{err}</div> : null}

      {!err && tasks === null ? <div className="muted">正在读远程清单…</div> : null}
      {!err && tasks && !tasks.length ? (
        <div className="board-empty">
          <div className="board-empty-mark" />
          <div className="board-empty-title">远程没有未完成的任务</div>
          <div className="board-empty-sub">提交方往远程清单投任务后，这里就会出现</div>
        </div>
      ) : null}

      {shown.length ? (
        <div className="import-remote-list">
          {shown.map((t) => (
            <label className="import-remote-item" key={`${t.topic}:${t.id}`}>
              <input
                type="checkbox"
                checked={picked.has(t.text)}
                onChange={() => toggle(t.text)}
              />
              <span className="import-remote-topic">{t.topic || '（无主题）'}</span>
              <span className="import-remote-text">{t.text}</span>
            </label>
          ))}
        </div>
      ) : null}

      <div className="import-remote-actions">
        <button className="btn small" onClick={doImport} disabled={busy || !picked.size}>
          {busy ? '导入中…' : `导入 ${picked.size} 条`}
        </button>
        <button className="btn small ghost" onClick={onClose} disabled={busy}>
          取消
        </button>
        <span className="muted">已勾 {picked.size} 条</span>
      </div>
    </div>
  );
}

function splitDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s >= 86400 && s % 86400 === 0) return { value: s / 86400, unit: 'day' };
  if (s >= 3600 && s % 3600 === 0) return { value: s / 3600, unit: 'hour' };
  return { value: Math.max(1, Math.round(s / 60)), unit: 'min' };
}

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
  const dur0 = splitDuration(goal ? goal.durationSec : 3 * 3600);
  const [durValue, setDurValue] = useState(String(dur0.value));
  const [durUnit, setDurUnit] = useState(dur0.unit);
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
        durationSec: Number(durValue) * (GOAL_UNITS.find((u) => u.key === durUnit) || GOAL_UNITS[1]).sec,
        prompt: draft,
        resetStart,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="goal-form">
      {init.needCwd && (
        <div className="goal-form-section">
          <div className="goal-form-title">工作目录</div>
          <input
            className="goal-cwd-input"
            type="text"
            value={cwdDraft}
            onChange={(e) => setCwdDraft(e.target.value)}
            placeholder="例如 D:\code\a_js\proj\nx-kv（agent 会以同一目录调 check）"
          />
          <div className="goal-hint" style={{ marginTop: 4 }}>
            timegoal 按「目录名」绑定；agent 在哪个目录跑，就用哪个目录。
          </div>
        </div>
      )}
      <div className="goal-form-section">
        <div className="goal-dur-row">
          <span className="goal-form-title" style={{ marginBottom: 0 }}>持续时长</span>
          <input
            className="goal-dur-input"
            type="number"
            min={1}
            step={1}
            value={durValue}
            onChange={(e) => setDurValue(e.target.value)}
            aria-label="持续时长数值"
          />
          <select
            className="goal-dur-unit"
            value={durUnit}
            onChange={(e) => setDurUnit(e.target.value)}
            aria-label="持续时长单位"
          >
            {GOAL_UNITS.map((u) => (
              <option key={u.key} value={u.key}>{u.label}</option>
            ))}
          </select>
          <span className="goal-hint">最少 1 分钟，最多 365 天（长跑任务不再被 24 小时卡住）</span>
        </div>
        <div className="goal-presets">
          {GOAL_DURATION_PRESETS.map((p) => (
            <button
              key={p.label}
              className="btn small ghost"
              onClick={() => { setDurValue(String(p.value)); setDurUnit(p.unit); }}
              title={`设为 ${p.value} ${p.unit === 'min' ? '分钟' : p.unit === 'hour' ? '小时' : '天'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {goal && (
          <div className="goal-hint" style={{ marginTop: 8 }}>
            当前：起点 {goal.startedAt} · 截止 {goal.deadline}
            {resetStart ? ' → 保存后会重设，计时从头开始' : ' → 起点保留，已用时间仍算数'}
          </div>
        )}
      </div>

      <div className="goal-form-section">
        <div className="goal-form-title">全局提示词</div>
        <textarea
          className="goal-prompt"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          rows={10}
          placeholder="完整全局提示词原文（agent 每轮 timegoal check 会原样回显给它）"
        />
        <div className="goal-hint" style={{ marginTop: 4 }}>
          {draft.length} / 20000 字
        </div>
      </div>

      {goal && (
        <label
          className="goal-reset"
          title="勾上则重新开始计时（已用时间作废）；不勾则保留起点"
        >
          <input type="checkbox" checked={resetStart} onChange={(e) => setResetStart(e.target.checked)} />
          重置计时起点（当作新的一局）
        </label>
      )}

      <div className="goal-actions">
        <button className="btn small" disabled={saving} onClick={submit}>
          {saving ? '保存中…' : goal ? '保存' : '创建时间目标'}
        </button>
        <button className="btn small ghost" disabled={saving} onClick={onCancel}>取消</button>
        <span className="goal-hint">Ctrl+Enter 保存 · Esc 取消</span>
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
