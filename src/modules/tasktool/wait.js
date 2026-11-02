// tasktool/wait.js —— wait/get 的阻塞编排（从 localtask/service.js 整体迁入）。
//
// 边界（tasktool = 任务工具语义，localtask = 队列本体）：
//   - 队列读写、唤醒注册表、presence/面板注册表都在 localtask（serve 路由与
//     panel-guard 的一半也长在那边），这里只做**编排**：快路径领取 → 阻塞窗口
//     （面板唤起 / 跨进程轮询 / goal 到点收尾 / 用户关闭）→ 交付组装。
//   - 与队列的耦合全部走 localtask/service.js 的导出面；与计时目标的耦合走
//     同模块的 timegoal.js（探针只读 + 交付时刻的目标上下文）。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../../core/paths.js';
import { openBrowser } from '../../core/open.js';
import { formatGoalTiming, hasTemplateMarkers, renderInstruction } from '../../core/instruction-template.js';
import {
  clampTaskSuffix,
  clampTimeoutSec,
  joinTaskSuffix,
  clearWaiting,
  consumeCancelRequest,
  consumeFirstPending,
  findRunningPanelPort,
  GLOBAL_KEY,
  isGlobalKey,
  loadStore,
  normalizeCwd,
  normalizeSummary,
  probeEffectivePresence,
  registerGlobalWaiter,
  registerTopicWaiter,
  repoContextIndex,
  repoCtxOf,
  setWaiting,
  shouldReopenWindow,
  unregisterTopicWaiter,
} from '../localtask/service.js';
import { ensureTaskGoal } from './taskgoal.js';
import { readGroupContext, renderGroupContext } from './groupctx.js';
import * as timegoal from './timegoal.js';

// 跨进程兜底轮询间隔（只定这里的读取节奏；队列写入节奏与它无关）
const POLL_MS = 500;

// 「YYYY-MM-DD HH:mm:ss」→ epoch ms（任务级 goal 的起点 = consumedAt）；解析不了返回 NaN
function parseStampMs(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(v || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}
const REVIEW_MS = 5_000; // 阻塞期间复查「页面还开着」的间隔

// ─── 时间目标探针与交付时刻的目标上下文 ──────────────────────────────
//
// 与 localtask wait 的两处融合（都 fail-open：timegoal 坏了绝不拖垮 wait）：
//   - 阻塞期间到点 → 本轮立刻收尾（goalPoll，见 waitForTask）；
//   - 返回时刻把目标状态渲染进 instruction（goal 段）。
// 探针按 key 服务于 500ms 轮询；上下文按 cwd 走 showTimegoal——只有它带
// prompt 原文与 remainingSec/overtimeSec。读取时机是**返回时刻**不是阻塞开始。

// 等待期到点探针（只读、不写盘）：返回该目录目标的截止 epoch ms；已到点/无目标 → 0
async function readGoalDeadlineMs(key) {
  if (!key || isGlobalKey(key)) return 0;
  try {
    const g = await timegoal.probeGoalExpiry(key);
    if (!g || g.reached) return 0; // 已经到点的：不参与自动取消
    const ms = Number(g.deadlineMs);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  } catch {
    return 0;
  }
}

// wait/get **返回时刻**的目标上下文（渲染 instruction 用）。fail-open：加载失败 /
// 读不到 / 没目标 / 出错 → null，instruction 照常渲染（goal 段被整段丢弃）。
// 绝不写盘：showTimegoal 走 loadRecycledStore({persist:false})——timegoals.json
// 字节数不变，goal-expiry 单测字节比对钉着。
async function readGoalCtx(cwd) {
  if (!cwd || isGlobalKey(cwd)) return null; // cwd 是路径，isGlobalKey 恒 false——纯防御
  try {
    const show = await timegoal.showTimegoal({ cwd });
    if (!show || !show.hasGoal) return null;
    const g = show.goal || {};
    return {
      name: g.name || show.name || '',
      deadline: g.deadline || '',
      prompt: g.prompt || '',
      remainingHuman: formatGoalTiming({
        reached: show.reached,
        remainingSec: show.remainingSec,
        overtimeSec: show.overtimeSec,
      }),
    };
  } catch {
    return null;
  }
}

// ─── 阻塞等待：核心入口 ─────────────────────────────────────────────

// 把收尾追加语拼到返回给 agent 的 task.text 末尾（只改返回载荷，绝不回写库存原文）。
// suffix 为空 → 原样返回；已包含同样追加语（幂等）→ 不重复追加。
function withTaskSuffix(task, suffix) {
  const s = clampTaskSuffix(suffix);
  if (!task || !s) return task;
  const base = String(task.text || '');
  if (base.includes(s)) return task;
  return { ...task, text: `${base.replace(/\s+$/, '')}\n\n${s}` };
}

// 组装 wait/get 返回的任务载荷 + 收尾指令。分流（见 DEFAULT_TASK_SUFFIX 注释）：
//   纯文本（无 {{）→ v0.x 行为：拼到 task.text 末尾（幂等、不回写库存）、无新字段；
//   模板（含 {{） → 渲染进返回载荷的 instruction 字段，task.text 保持库存原文
//                   （模板原文若追加进正文会把 {{...}} 漏进任务文本）；
//   ''（关闭）    → 只回任务。
// 任何异常都降级为「只回任务」——wait 绝不能因渲染挂掉（与探针同一条 fail-open 纪律）。
async function buildTaskDelivery(task, suffix, { source, summary, cwd, name, topicKey } = {}) {
  // 多条收尾指令（settings.taskSuffix 存 string[]）先按空行拼成单串再分流；
  // 兼容旧单条 string（joinTaskSuffix 对 string 原样算一条）。
  const tpl = joinTaskSuffix(suffix);
  try {
    // 任务级 timegoal（发布带 --duration）：**领取即计时**——这里起表（幂等），
    // goal 上下文换成任务级（prompt = check 指令，固化进 timegoal 存储，之后每轮原文回显）。
    // 目录级 goal 仍作兜底：任务没带时间目标时，渲染等待方目录的目标状态。
    let taskGoalCtx = null;
    if (task && task.timegoal && topicKey) {
      const title = (String(task.text || '')
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean) || `任务 #${task.id}`).slice(0, 40);
      taskGoalCtx = await ensureTaskGoal({
        topicKey,
        taskId: task.id,
        cwd,
        name: title,
        timegoal: task.timegoal,
        startedAtMs: parseStampMs(task.consumedAt) || undefined,
      });
    }
    const goal = taskGoalCtx || (await readGoalCtx(cwd));

    // 项目组上下文（组概念 + 本项目位置 + 兄弟成员 + 参考文件地址）：
    // 只进 instruction，**task.text 保持库存原文**——todo 的口径是
    // 「封装对应的提示词保持在原本的提示此任务下面对上下文环境进行一个封装」。
    const groupText = renderGroupContext(await readGroupContext(cwd));

    const parts = [];
    if (groupText) parts.push(groupText);
    if (hasTemplateMarkers(tpl)) {
      const instruction = renderInstruction(tpl, {
        goal,
        task: task ? { id: task.id, text: String(task.text || '') } : null,
        source: source || '',
        summary: summary || '',
        cwd: cwd || '',
        name: name || '',
      });
      if (instruction) parts.push(instruction);
    } else if (!groupText) {
      // 纯文本后缀 + 无组上下文 → 老行为：追加到 task.text 末尾（幂等、不回写库存）
      const base = { task: withTaskSuffix(task, tpl) };
      // 任务级 goal 必须把 check 指令带到 agent 手里——即使交付模板被关/是纯文本，
      // 也要以独立 instruction 交付（这就是「提示词当中写上，让他进行一个 check」）。
      if (taskGoalCtx) base.instruction = taskGoalCtx.prompt;
      return base;
    } else {
      parts.push(tpl); // 纯文本后缀 + 有组上下文 → 进 instruction，不污染 task.text
    }
    // 任务级 check 指令必须原样到达 agent（默认 suffix 模板不含 {{goal.prompt}}，
    // 用户自定义模板也可能漏写）——任务级 goal 存在时始终以独立段落追加。
    if (taskGoalCtx) parts.push(taskGoalCtx.prompt);

    const full = parts.join('\n\n').trim();
    if (!full) return { task };
    // coversBody = 模板是否包含 {{task.text}}（即 instruction 是否自包含任务正文）。
    // 由服务端判定而不是 CLI 端做子串猜测——短任务文本可能碰巧是指令的子串，
    // 子串启发会误吞正文块的显示。
    const coversBody = hasTemplateMarkers(tpl) && /\{\{\s*task\.text\s*\}\}/.test(tpl);
    return { task, instruction: full, coversBody };
  } catch {
    return { task };
  }
}

/**
 * 针对某主题（工作目录）等待用户回填下一条任务。
 * 领取顺序：本目录队列 → 全局主题（共享池）→ 阻塞（两个来源任一到达即唤醒）。
 * 返回带 source: 'local' | 'global' 标明任务来自哪个队列。
 * @param {string}  [cwd]     工作目录（主题按目录名识别）；缺省 → 进程当前 cwd。
 *                            注意：显式传 cwd **不会**关闭全局兜底——本地空了一定去全局领。
 * @param {string}  summary   当前现状（必填，状态展示）
 * @param {number}  [timeoutSec] 阻塞上限（秒）；缺省 → 页面配置（推荐 180，最大 600）
 * @param {number}  [timeoutMs] 兼容旧参数（毫秒）
 * @param {boolean} [open]    是否自动打开浏览器弹窗（测试可关）
 * @param {function} [onReady] 服务器就绪回调 {addr,key,cwd,name,summary}（测试/集成钩子）
 */
export async function waitForTask({
  cwd: rawCwd,
  summary: rawSummary,
  timeoutSec,
  timeoutMs,
  open = true,
  onReady,
  instant = false, // get 的「直接领」形态：没有 pending 立即空手而回，不开窗不阻塞
} = {}) {
  const { key, cwd, name } = normalizeCwd(rawCwd);
  const summary = normalizeSummary(rawSummary); // 现状必填
  // 领取方身份：记进 task.claimedBy（事后能看出"这条被谁领的"）
  const by = { key, cwd, name };
  // 仓库上下文：这个目录属于哪个已登记仓库、周围关联哪些看板。
  // 跟着 wait 的结果一起给出去 —— agent 领到任务就知道自己的" surroundings"。
  const repoIndex = await repoContextIndex();
  const repoCtx = repoCtxOf(repoIndex, cwd);

  // 超时：显式 --timeout（秒/毫秒）优先；否则用页面配置；统一夹到 1-600
  const startStore = await loadStore();
  let sec;
  if (timeoutSec !== undefined && timeoutSec !== null) sec = timeoutSec;
  else if (timeoutMs !== undefined && timeoutMs !== null) sec = Number(timeoutMs) / 1000;
  else sec = startStore.settings.timeoutSec;
  const tmo = clampTimeoutSec(sec) * 1000;
  const suffix = startStore.settings.taskSuffix; // 返回任务时追加的收尾指令（本轮固定；多条列表，交付时拼接）

  // 1. 主题队列已有 pending → 立即取走，不开窗、不阻塞；记录本轮完成总结
  const queued = await consumeFirstPending(key, summary, by);
  if (queued) {
    const delivery = await buildTaskDelivery(queued, suffix, { source: 'local', summary, cwd, name, topicKey: key });
    return { status: 'ok', key, cwd, name, summary, ...delivery, queued: true, source: 'local', repo: repoCtx };
  }

  // 1b. 本地空 → 去全局主题（共享池）领。这是所有 wait 的**无条件默认兜底**：
  //     与是否显式传 --cwd 无关——本地取不到就一定来全局扫一眼，全局也没有才阻塞。
  //     （防止调用方习惯性传 cwd 导致共享池永远无人领取。）
  // instant（localtask get 默认形态）：两处快路径都没货 → 立即返回，不进阻塞窗口。
  // 「无任务时唤起阻塞等待」是 waitgoal（项目 getLoop）的语义，见 tasktool/get.js。
  if (instant) {
    return { status: 'timeout', key, cwd, name, summary, timeoutMs: 0, instant: true };
  }

  const fromGlobal = await consumeFirstPending(GLOBAL_KEY, summary, by);
  if (fromGlobal) {
    // 全局池投递渲染的仍是**等待方目录**的 goal——目标绑定在等待中的 agent 目录上，
    // 与任务来自哪个队列无关。
    const delivery = await buildTaskDelivery(fromGlobal, suffix, { source: 'global', summary, cwd, name, topicKey: key });
    return {
      status: 'ok',
      key,
      cwd,
      name,
      summary,
      ...delivery,
      queued: true,
      source: 'global',
      repo: repoCtx,
    };
  }

  // 1c. 这个目录的时间目标**还在跑** → 记下它的截止时刻。
  //     等待期间一旦越过这个时刻，本轮立刻收尾（见下方 goalPoll）。
  //     目标早就过期的（reached）不记：那是"这一局已经结束了"，
  //     该由 agent 自己的 `timegoal check` 去处理，不该把 wait 焊死在这个目录上。
  const goalDeadlineMs = await readGoalDeadlineMs(key);

  // 2. 没有 pending → 复用常驻主面板（不再起随机端口临时弹窗）：
  //    a) 确保主面板在跑（不存在就 detached 拉起 serve --no-open --auto-exit）；
  //    b) 探测活动 SSE 连接：有活标签就不开新页（避免 Edge 重复开标签）；
  //                没活标签就 openBrowser 深链到当前主题。
  //    失败只降级为纯阻塞——绝不抛错中断 wait。
  //    --no-open 模式（冒烟/CI）不发起任何面板相关动作：不开浏览器、不拉起 serve、不开 SSE。
  //    这样可避免在测试里 spawn 出一堆孤儿进程占着 7877 端口。
  const panelInfo = open
    ? await ensureMainPanel()
    : { running: false, started: false, port: 0, url: '' };
  // 活性判据：「本地任务」页的活动 SSE 标签，或面板停在任意页（App 壳 ping 兜底）。
  // 只认 SSE 的旧口径在用户切到别的页时会误判「没开」，于是每次 wait 都重开一个标签。
  const presence = panelInfo.running ? await probeEffectivePresence() : 0;
  const deepLink = deepLinkUrl(key, panelInfo.port || DEFAULT_PORT);

  // 3. 结果承诺：三个生产者（同进程本地 waiter / 同进程全局 FIFO / 跨进程轮询）+ 超时
  let resolveOutcome;
  const outcome = new Promise((r) => {
    resolveOutcome = r;
  });
  registerTopicWaiter(key, {
    resolve: (task) => resolveOutcome({ kind: 'task', task, delivered: true }),
  });
  // 全局兜底：同进程有人 addTask({global:true}) 时按 FIFO 唤醒本 wait
  const unregisterGlobal = registerGlobalWaiter(
    (task) => resolveOutcome({ kind: 'task', task, delivered: true, source: 'global' }),
    summary,
    by
  );

  const poll = setInterval(() => {
    // 跨进程兜底轮询：先查本地，再查全局（本地优先；同轮至多 resolve 一次）
    consumeFirstPending(key, undefined, by)
      .then((task) => {
        if (task) {
          resolveOutcome({ kind: 'task', task, delivered: false, source: 'local' });
          return null;
        }
        return consumeFirstPending(GLOBAL_KEY, undefined, by);
      })
      .then((task) => {
        if (task) resolveOutcome({ kind: 'task', task, delivered: false, source: 'global' });
      })
      .catch(() => {
        /* 瞬时读写错误，下一轮再试 */
      });
  }, POLL_MS);

  const timer = setTimeout(() => resolveOutcome({ kind: 'timeout' }), tmo);

  // 关闭轮询：用户在面板点了「关闭」→ 立即收尾本轮（走与超时同一条出口，只多带 cancelled 标记，
  // agent 不必认识新状态，照常结束本轮）。
  const cancelPoll = setInterval(() => {
    consumeCancelRequest(key)
      .then((yes) => {
        if (yes) resolveOutcome({ kind: 'cancelled' });
      })
      .catch(() => {});
  }, POLL_MS);

  // 时间目标到点 → 立刻收尾本轮（等的是"下一条任务"，预算用完了就没必要等）。
  // 与用户点「关闭等待」同一条出口：status:"timeout" + cancelled:true。
  // 只认"等待开始时还在跑"的目标（goalDeadlineMs>0）——已经过期的目标不参与。
  const goalPoll = setInterval(() => {
    if (goalDeadlineMs && Date.now() >= goalDeadlineMs) {
      resolveOutcome({ kind: 'cancelled', reason: 'goal_expired' });
    }
  }, POLL_MS);
  goalPoll.unref?.();

  // 登记「等待中」（含截止时刻与现状），面板据此显示倒计时
  await setWaiting(key, cwd, summary, true, new Date(Date.now() + tmo));

  // 登记之后再查一次关闭标记：setWaiting 刚清掉上一轮残留的标记，因此这里若有值
  // 一定是新一次关闭请求——立刻收尾，不让用户白等。
  if (await consumeCancelRequest(key).catch(() => false)) {
    resolveOutcome({ kind: 'cancelled' });
  }

  // waiter/轮询就位后再回调，保证 onReady 里立刻回填也能被接住
  if (typeof onReady === 'function') {
    try {
      await onReady({ addr: deepLink, key, cwd, name, summary });
    } catch {
      /* 钩子异常不得影响 wait */
    }
  }

  // 没活标签且主面板在跑 → 开浏览器深链（让用户能在面板里选中主题并响应等待事件）。
  // 已有活标签 / --no-open / 主面板未启动 → 都不开（避免重复标签 + 冒烟/CI 兼容）。
  const openPage = open && presence === 0 && panelInfo.running;
  // 初次开页也要计入冷却。页面从「进程已拉起」到「SSE 连上」有 1–3s 空窗，
  // 不记这一笔的话，第一次复查（5s 后）会把「还在加载」判成「没开」→ 立刻再开一个。
  let lastOpenAt = openPage ? Date.now() : 0;
  let opens = openPage ? 1 : 0;
  if (openPage) openBrowser(deepLink);

  // 周期复查：等待期间每 5s 查一次活动标签；万一开始时判错（页面被关），20s 冷却内重开。
  // 不到点不开新页（节流，避免「标签被关 → 立刻开 → 立刻关」抖动）；总次数也有上限 ——
  // 若浏览器拦了脚本 / 用户就是不想看，每 20s 开一个只会变成窗口风暴。
  //
  // 单次探测为 0 **不算**「标签被关」：后台标签被浏览器冻结、SSE 自动重连、网络抖动
  // 都会短暂掉到 0（EventSource 自带重连，几秒后自己回来）。所以要连续两次（≈10s）
  // 都探不到活连接才重开，否则一次抖动就多一个窗口。
  let zeroStreak = 0;
  const review = setInterval(async () => {
    if (!panelInfo.running || !open) return;
    // 同样用宽口径活性（SSE 或 ping）：用户只是切到别的页，不算「标签被关」。
    const n = await probeEffectivePresence().catch(() => 0);
    zeroStreak = n > 0 ? 0 : zeroStreak + 1;
    if (zeroStreak < 2) return;
    const now = Date.now();
    if (!shouldReopenWindow({ presence: n, now, lastOpenAt, opens })) return;
    lastOpenAt = now;
    opens += 1;
    openBrowser(deepLink);
  }, REVIEW_MS);
  review.unref?.();

  let result;
  try {
    const r = await outcome;
    // 收尾指令在**返回时刻**组装（此刻的 goal 状态才是真实状态；阻塞期间到点会渲染出已到点）。
    // 只对拿到任务的结果生效——timeout/goal_expired/cancelled 的返回形状是钉死的契约，不动。
    const delivery =
      r.kind === 'task'
        ? await buildTaskDelivery(r.task, suffix, { source: r.source || 'local', summary, cwd, name, topicKey: key })
        : null;
    result =
      r.kind === 'timeout'
        ? { status: 'timeout', key, cwd, summary, timeoutMs: tmo }
        : r.kind === 'cancelled'
        ? {
            status: 'timeout',
            key,
            cwd,
            summary,
            timeoutMs: tmo,
            cancelled: true,
            // 为什么取消：'goal_expired' = 时间目标到点、这一局预算用完；
            // 缺省 = 用户在面板点了「关闭等待」。
            ...(r.reason ? { reason: r.reason } : {}),
          }
        : {
            status: 'ok',
            key,
            cwd,
            name,
            summary,
            ...(delivery || { task: r.task }),
            delivered: r.delivered,
            queued: false,
            source: r.source || 'local',
            repo: repoCtx,
          };
  } finally {
    clearInterval(poll);
    clearInterval(cancelPoll);
    clearInterval(goalPoll);
    clearInterval(review);
    clearTimeout(timer);
    unregisterTopicWaiter(key);
    unregisterGlobal();
    await clearWaiting(key);
  }
  return result;
}

function panelOrigin(port) {
  return `http://127.0.0.1:${port || DEFAULT_PORT}`;
}

// 深链到面板目录工作台并定位当前主题（key 必有；key 缺失时落总览兜底）。
// 端口取实际发现的面板（可能不是默认端口）。经典看板 #/localtask 已下线。
function deepLinkUrl(key, port) {
  const page = key ? `#/dir/${encodeURIComponent(key)}` : '#/overview';
  return `${panelOrigin(port)}/${page}`;
}

// 本仓库/已安装包的 CLI 入口（src/modules/localtask/ 上三级到包根）。
function binCliPath() {
  return fileURLToPath(new URL('../../../bin/cli.mjs', import.meta.url));
}

// 确保常驻主面板可用：已在运行直接复用；否则后台 detached 拉起一个独立
// `nx-kv serve --no-open --auto-exit`（unref，不随 wait 退出而关闭），再轮询健康端点。
// 失败只返回 running:false，绝不抛错——wait 仍可阻塞等待 CLI/轮询回填。
//
// --auto-exit：这个实例是**为等用户回填而临时拉起**的，用完就该让位——面板页全部关闭、
// 又没有等待中的主题时自行退出（宽限期见 panel-guard.js）。下一次 wait 需要时会再拉起
// （冷启动 <1s）。用户手动 `nx-kv serve` 的实例不带此标志，不会自己跑掉。
async function ensureMainPanel() {
  // 先在所有候选端口（含 panels.json 登记的非默认端口）上找现成面板——
  // 只探默认端口会看不见 `serve --port` / 顺延出来的面板，于是另起第二个实例、
  // 再开一个标签。
  const existing = await findRunningPanelPort();
  if (existing) {
    return { running: true, started: false, port: existing, url: panelOrigin(existing) + '/' };
  }

  try {
    const child = spawn(process.execPath, [binCliPath(), 'serve', '--no-open', '--auto-exit'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {
      /* 见轮询兜底 */
    });
    child.unref();
  } catch {
    return { running: false, started: false, port: 0, url: '' };
  }

  // 新 serve 可能因默认端口被占而顺延到别的端口 → 扫描所有候选端口，不只盯默认端口。
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    const port = await findRunningPanelPort(700);
    if (port) return { running: true, started: true, port, url: panelOrigin(port) + '/' };
  }
  return { running: false, started: true, port: 0, url: '' };
}

