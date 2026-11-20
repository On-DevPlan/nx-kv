// claim/wait.ts —— get 的阻塞编排（从 localtask/service.js 整体迁入）。
//
// 边界（claim = 领取域，localtask = 队列本体）：
//   - 队列读写、唤醒注册表、presence/面板注册表都在 localtask（serve 路由与
//     panel-guard 的一半也长在那边），这里只做**队列编排**：快路径领取 → 阻塞窗口
//     （跨进程轮询 / goal 到点收尾 / 用户关闭）。
//   - 交付组装在本域 host.ts（宿主取数 → promptplug 的 assembleDelivery）——
//     本文件在拿到任务的那一刻调 buildTaskDelivery，不碰模板与渲染。
//   - 面板随行（确保主面板 / 深链 / 窗口重开防风暴）已拆到 panel-escort.js——
//     这里只经 escortPanel({ stop() }) 一点相接。
//   - 与队列的耦合全部走 localtask/service.js 的导出面；与计时目标的耦合走
//     同模块的 timegoal.js（探针只读；goal 到点自动收尾本轮）。
import { DEFAULT_PORT } from '../../core/paths.js';
import {
  clampTimeoutSec,
  clearWaiting,
  consumeCancelRequest,
  claimFirstPending,
  getSettings,
  GLOBAL_KEY,
  isGlobalKey,
  normalizeCwd,
  normalizeSummary,
  probeEffectivePresence,
  registerGlobalWaiter,
  registerTopicWaiter,
  repoContextIndex,
  repoCtxOf,
  setWaiting,
  unregisterTopicWaiter,
} from '../localtask/service.js';
import { ensureMainPanel, deepLinkUrl, escortPanel } from './panel-escort.js';
import { buildTaskDelivery } from './host.js';
import * as timegoal from '../goals/timegoal.js';

// 跨进程兜底轮询间隔（只定这里的读取节奏；队列写入节奏与它无关）
const POLL_MS = 500;

// ─── 时间目标探针（阻塞期间到点自动收尾本轮） ────────────────────────
//
// 与时间目标的融合（fail-open：timegoal 坏了绝不拖垮阻塞等待）：
//   - 阻塞期间到点 → 本轮立刻收尾（goalPoll，见 waitForTask）；
//   - 返回时刻把目标状态渲染进 instruction（goal 段）——那半边在本域 host.ts。
// 探针按 key 服务于 500ms 轮询。读取时机是**阻塞开始**不是返回时刻：
// 只认「等待开始时还在跑」的目标，已到点的不参与自动取消。

// 等待期到点探针（只读、不写盘）：返回该目录目标的截止 epoch ms；已到点/无目标 → 0
async function readGoalDeadlineMs(key: unknown): Promise<number> {
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

// ─── 阻塞等待：核心入口 ─────────────────────────────────────────────

export interface WaitForTaskOptions {
  /** 工作目录（主题按目录名识别）；缺省 → 进程当前 cwd。显式传 cwd **不会**关闭全局兜底 */
  cwd?: unknown;
  /** 当前现状（#171 起不再必填：面板上没有对应输入界面） */
  summary?: unknown;
  /** 阻塞上限（秒）；缺省 → 页面配置（推荐 180，最大 600） */
  timeoutSec?: number;
  /** 兼容旧参数（毫秒） */
  timeoutMs?: number;
  /** 是否自动打开浏览器弹窗（测试可关） */
  open?: boolean;
  /** 服务器就绪回调 {addr,key,cwd,name,summary}（测试/集成钩子） */
  onReady?: (info: { addr: string; key: string; cwd: string; name: string; summary: string }) => unknown | Promise<unknown>;
  /** 外部参数（平面扩展）：进交付模板的 ctx（--param k=v） */
  params?: Record<string, string>;
  /** get 的「直接领」形态：没有 pending 立即空手而回，不开窗不阻塞 */
  instant?: boolean;
  /** 项目级「持续 get」开关（仅 get/preview 传；关闭 → 不出现该区块） */
  getLoopEnabled?: boolean;
  /** 项目级阻塞窗口（分钟）：进 getloop 模板 ctx，让 agent 知道每轮会等多久 */
  getLoopWaitMinutes?: number;
}

/** 阻塞等待的唤醒结果（三个生产者 + 超时） */
type WaitOutcome =
  | { kind: 'task'; task: any; delivered: boolean; source?: string }
  | { kind: 'timeout' }
  | { kind: 'cancelled'; reason?: string };

/**
 * 针对某主题（工作目录）等待用户回填下一条任务。
 * 领取顺序：本目录队列 → 全局主题（共享池）→ 阻塞（两个来源任一到达即唤醒）。
 * 返回带 source: 'local' | 'global' 标明任务来自哪个队列。
 */
export async function waitForTask({
  cwd: rawCwd,
  summary: rawSummary,
  timeoutSec,
  timeoutMs,
  open = true,
  onReady,
  params = {}, // 外部参数（平面扩展）：进交付模板的 ctx（--param k=v）
  instant = false, // get 的「直接领」形态：没有 pending 立即空手而回，不开窗不阻塞
  getLoopEnabled = false, // 项目级「持续 get」开关（仅 get/preview 传；关闭 → 不出现该区块）
  getLoopWaitMinutes = 0, // 项目级阻塞窗口（分钟）：进 getloop 模板 ctx，让 agent 知道每轮会等多久
}: WaitForTaskOptions = {}): Promise<Record<string, any>> {
  // paths.normalizeCwd 的 @returns 标注漏了 name（运行时恒返回 {cwd, name, key}）
  const { key, cwd, name } = normalizeCwd(rawCwd as string) as { cwd: string; key: string; name: string };
  const summary = normalizeSummary(rawSummary, { optional: true }); // #171：现状不再必填
  // 领取方身份：记进 task.claimedBy（事后能看出"这条被谁领的"）
  const by = { key, cwd, name };
  // 仓库上下文：这个目录属于哪个已登记仓库、周围关联哪些看板。
  // 跟着领取结果一起给出去 —— agent 领到任务就知道自己的" surroundings"。
  const repoIndex = await repoContextIndex();
  const repoCtx = repoCtxOf(repoIndex, cwd);

  // 超时：显式 --timeout（秒/毫秒）优先；否则用页面配置；统一夹到 1-600
  // T03：设置走 settings 表（repo/settings），不再有 JSON store 对象
  const startSettings = await getSettings();
  let sec: unknown;
  if (timeoutSec !== undefined && timeoutSec !== null) sec = timeoutSec;
  else if (timeoutMs !== undefined && timeoutMs !== null) sec = Number(timeoutMs) / 1000;
  else sec = startSettings.timeoutSec;
  const tmo = clampTimeoutSec(sec) * 1000;

  // 1. 主题队列已有 pending → 立即取走，不开窗、不阻塞；记录本轮完成总结
  const queued = await claimFirstPending(key, summary, by);
  if (queued) {
    const delivery = await buildTaskDelivery(queued, { source: 'local', summary, cwd, name, topicKey: key, params, getLoopEnabled, getLoopWaitMinutes });
    return { status: 'ok', key, cwd, name, summary, ...delivery, queued: true, source: 'local', repo: repoCtx };
  }

  // 1b. 本地空 → 去全局主题（共享池）领。这是所有领取的**无条件默认兜底**：
  //     与是否显式传 --cwd 无关——本地取不到就一定来全局扫一眼，全局也没有才阻塞。
  //     （防止调用方习惯性传 cwd 导致共享池永远无人领取。）
  // instant（localtask get 默认形态）：两处快路径都没货 → 立即返回，不进阻塞窗口。
  // 「无任务时唤起阻塞等待」是 waitgoal（项目 getLoop）的语义，见 claim/get.ts。
  if (instant) {
    return { status: 'timeout', key, cwd, name, summary, timeoutMs: 0, instant: true };
  }

  const fromGlobal = await claimFirstPending(GLOBAL_KEY, summary, by);
  if (fromGlobal) {
    // 全局池投递渲染的仍是**等待方目录**的 goal——目标绑定在等待中的 agent 目录上，
    // 与任务来自哪个队列无关。
    const delivery = await buildTaskDelivery(fromGlobal, { source: 'global', summary, cwd, name, topicKey: key, params, getLoopEnabled, getLoopWaitMinutes });
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
  //     该由 agent 自己的 `timegoal check` 去处理，不该把阻塞等待焊死在这个目录上。
  const goalDeadlineMs = await readGoalDeadlineMs(key);

  // 2. 没有 pending → 复用常驻主面板（不再起随机端口临时弹窗）：
  //    a) 确保主面板在跑（不存在就 detached 拉起 serve --no-open --auto-exit）；
  //    b) 探测活动 SSE 连接：有活标签就不开新页（避免 Edge 重复开标签）；
  //                没活标签就 openBrowser 深链到当前主题。
  //    失败只降级为纯阻塞——绝不抛错中断等待。
  //    --no-open 模式（冒烟/CI）不发起任何面板相关动作：不开浏览器、不拉起 serve、不开 SSE。
  //    这样可避免在测试里 spawn 出一堆孤儿进程占着 7877 端口。
  const panelInfo = open
    ? await ensureMainPanel()
    : { running: false, started: false, port: 0, url: '' };
  // 活性判据：「本地任务」页的活动 SSE 标签，或面板停在任意页（App 壳 ping 兜底）。
  // 只认 SSE 的旧口径在用户切到别的页时会误判「没开」，于是每次等待都重开一个标签。
  const presence = panelInfo.running ? await probeEffectivePresence() : 0;
  const deepLink = deepLinkUrl(key, panelInfo.port || DEFAULT_PORT);

  // 3. 结果承诺：三个生产者（同进程本地 waiter / 同进程全局 FIFO / 跨进程轮询）+ 超时
  let resolveOutcome!: (r: WaitOutcome) => void;
  const outcome = new Promise<WaitOutcome>((r) => {
    resolveOutcome = r;
  });
  registerTopicWaiter(key, {
    resolve: (task: any) => resolveOutcome({ kind: 'task', task, delivered: true }),
  });
  // 全局兜底：同进程有人 addTask({global:true}) 时按 FIFO 唤醒本轮等待
  const unregisterGlobal = registerGlobalWaiter(
    (task: any) => resolveOutcome({ kind: 'task', task, delivered: true, source: 'global' }),
    summary,
    // by 承载 {key,cwd,name} 对象（领取后记进 task.claimedBy，见 task-ops 的 gw.by 消费）；
    // waiters 层的 by 已按 WaiterBy 标注（曾误标 string），此处直接透传
    by
  );

  const timer = setTimeout(() => resolveOutcome({ kind: 'timeout' }), tmo);

  // 三个 500ms 节拍的轮询合一为一个 ticker（原 poll/cancelPoll/goalPoll 三个 setInterval）：
  //   ① 跨进程兜底轮询：先查本地，再查全局（本地优先；同轮至多 resolve 一次）
  //   ② 关闭轮询：用户在面板点了「关闭」→ 立即收尾本轮（走与超时同一条出口，只多带
  //      cancelled 标记，agent 不必认识新状态，照常结束本轮）
  //   ③ 时间目标到点 → 立刻收尾本轮（等的是"下一条任务"，预算用完了就没必要等）。
  //      与②同一条出口：status:"timeout" + cancelled:true。
  //      只认"等待开始时还在跑"的目标（goalDeadlineMs>0）——已经过期的目标不参与。
  // 同拍内①②各自异步，谁先 resolve 谁赢（resolveOutcome 幂等）——拆分前多个独立
  // setInterval 的同拍相对顺序本就不保证，语义等价。unref 收尾：进程存活由 ref 的
  // timeout timer 兜着，ticker 不必单独撑事件循环（面板窗口复查的 5s 节拍在
  // panel-escort.js，自带起停，不并入）。
  const ticker = setInterval(() => {
    if (goalDeadlineMs && Date.now() >= goalDeadlineMs) {
      resolveOutcome({ kind: 'cancelled', reason: 'goal_expired' });
    }
    claimFirstPending(key, undefined, by)
      .then((task: any) => {
        if (task) {
          resolveOutcome({ kind: 'task', task, delivered: false, source: 'local' });
          return null;
        }
        return claimFirstPending(GLOBAL_KEY, undefined, by);
      })
      .then((task: any) => {
        if (task) resolveOutcome({ kind: 'task', task, delivered: false, source: 'global' });
      })
      .catch(() => {
        /* 瞬时读写错误，下一轮再试 */
      });
    consumeCancelRequest(key)
      .then((yes: any) => {
        if (yes) resolveOutcome({ kind: 'cancelled' });
      })
      .catch(() => {});
  }, POLL_MS);
  ticker.unref?.();

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
      /* 钩子异常不得影响本次等待 */
    }
  }

  // 没活标签且主面板在跑 → 开浏览器深链 + 周期复查重开（含初次开页判定）。
  // 全部细节（节流/冷却/上限/降级）在 panel-escort.js；这里只管起停。
  const escort = escortPanel({ open, panelInfo, deepLink, initialPresence: presence });

  let result: Record<string, any>;
  try {
    const r = await outcome;
    // 交付指令在**返回时刻**组装（此刻的 goal 状态才是真实状态；阻塞期间到点会渲染出已到点）。
    // 只对拿到任务的结果生效——timeout/goal_expired/cancelled 的返回形状是钉死的契约，不动。
    const delivery =
      r.kind === 'task'
        ? await buildTaskDelivery(r.task, { source: r.source || 'local', summary, cwd, name, topicKey: key, params, getLoopEnabled, getLoopWaitMinutes })
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
    clearInterval(ticker);
    escort.stop();
    clearTimeout(timer);
    unregisterTopicWaiter(key);
    unregisterGlobal();
    await clearWaiting(key);
  }
  return result;
}
