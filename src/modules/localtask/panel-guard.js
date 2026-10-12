// 常驻面板的「空闲自释放」：面板页（web）全关了、又没有等待中的主题时，让 serve
// 自己退出，释放端口与进程——而不是永远留一个后台常驻进程。
//
// 为什么不能直接把「SSE 连接数为 0」当成「web 已关闭」：SSE 只挂在「实时任务」页，
// 面板是单视图挂载（App.jsx 只渲染 current.component），用户一切到别的页 SSE 就断开，
// 连接数立刻归 0 —— 页面明明开着，却会被判成「关掉了」。所以判定用**任意面板请求的
// 最近时间**（App 壳每 15s 打一次 `GET /api/ping`，各页自己的轮询也计入），再叠加两条
// 硬性否决。
//
// 释放条件（全部成立才退出）：
//   1. 处于 --auto-exit 模式（用户手动 `nx-kv serve` 不在其列，不会自己跑掉）；
//   2. 没有任何「等待中」的主题（有 agent 正阻塞等人，面板是唯一提醒来源）；
//   3. 没有活着的面板标签（活动 SSE 连接）；
//   4. 从最后一次面板活动算起，静默超过宽限期——见过面板用短宽限，从未连过（无 GUI、
//      开页失败）用长宽限，避免和 wait 的「无标签就重开页」互相拉扯成 spawn 抖动。
//
// 与 wait 的关系：wait 等待期间主题是 waiting 的 → 第 2 条否决，面板不会释放；
// wait 结束后若用户把页面关了，才会在宽限期后释放；下一次 wait 再拉起新实例。
import { countWaitingTopics, panelPresence } from './service.js';

export const PANEL_IDLE_DEFAULTS = {
  // 见过面板之后：连续多久没有任何面板请求（且无活标签）就认为「页关掉了」。
  // 取 120s 而非更短，是为了容忍浏览器对后台标签的定时器节流（可被拉到 ~60s 一次）。
  idleMs: 120_000,
  // 从未有过面板客户端（headless / 开页失败）：用更长的兜底上限，既不留孤儿进程，
  // 又不至于让 wait 的 20s 重开冷却期反复 spawn 新进程。
  neverSeenIdleMs: 600_000,
  tickMs: 5_000,
};

/**
 * 纯判定：给定一次观测快照，决定是否该释放。便于单测，无副作用。
 * @param {{autoExit:boolean,sawClient:boolean,idleForMs:number,liveClients:number,waitingTopics:number}} snap
 * @param {{idleMs:number,neverSeenIdleMs:number}} [cfg]
 */
export function shouldAutoExit(snap, cfg = PANEL_IDLE_DEFAULTS) {
  if (!snap || !snap.autoExit) return false;
  if (snap.waitingTopics > 0) return false; // 有人在等回填：面板还有用
  if (snap.liveClients > 0) return false; // 还有活着的面板标签
  const limit = snap.sawClient ? cfg.idleMs : cfg.neverSeenIdleMs;
  return snap.idleForMs >= limit;
}

/**
 * 启动空闲看门狗。返回句柄：`noteActivity()` 供每个请求上报活动，
 * `snapshot()` / `tick()` 暴露出来供测试直接驱动（不必等真实定时器）。
 *
 * @param {object}   o
 * @param {object}   o.server       node http server（用于优雅关闭）
 * @param {number}   [o.idleSec]    覆盖宽限期（秒）
 * @param {number}   [o.tickMs]     巡检间隔
 * @param {function} [o.now]        取当前时刻（测试可注入假时钟）
 * @param {function} [o.log]        释放时的说明输出
 * @param {function} [o.onExit]     释放动作（缺省 process.exit(0)；测试注入以免退出测试进程）
 * @param {function} [o.getWaiting] 读「等待中主题数」
 * @param {function} [o.getLive]    读「活动面板标签数」
 */
export function startPanelIdleGuard({
  server,
  idleSec,
  tickMs = PANEL_IDLE_DEFAULTS.tickMs,
  now = Date.now,
  log = () => {},
  onExit,
  getWaiting = countWaitingTopics,
  getLive = () => panelPresence().clients,
} = {}) {
  const cfg = { ...PANEL_IDLE_DEFAULTS };
  if (Number.isFinite(idleSec) && idleSec > 0) cfg.idleMs = Math.floor(idleSec) * 1000;

  let lastActivityAt = now();
  let sawClient = false;
  let released = false;
  let timer = null;

  const noteActivity = () => {
    lastActivityAt = now();
    sawClient = true;
  };

  const snapshot = async () => {
    let waitingTopics = 0;
    try {
      waitingTopics = await getWaiting();
    } catch {
      // 读盘失败按 0 放行：这是瞬时错误，下一轮会重试；若反过来「读不到就永不释放」，
      // 一次偶发失败会让进程永远留驻。store 真的坏了时面板本身也早不可用了。
      waitingTopics = 0;
    }
    return {
      autoExit: true,
      sawClient,
      idleForMs: now() - lastActivityAt,
      liveClients: Math.max(0, Number(getLive()) || 0),
      waitingTopics,
    };
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const release = async () => {
    if (released) return;
    released = true;
    stop();
    try {
      // 先掐掉残留连接：keep-alive 空闲套接字与长连接会让 server.close() 一直等下去。
      server.closeAllConnections?.();
    } catch {
      /* 老 Node 无此 API：退回 close() 即可 */
    }
    await new Promise((res) => {
      try {
        server.close(() => res());
      } catch {
        res();
      }
    });
    if (typeof onExit === 'function') onExit();
    else process.exit(0);
  };

  const tick = async () => {
    if (released) return false;
    const snap = await snapshot();
    if (!shouldAutoExit(snap, cfg)) return false;
    log(
      `面板已无连接、也没有等待中的主题（静默 ${Math.round(snap.idleForMs / 1000)}s）→ ` +
        `自动释放 serve，端口 ${portOf(server)}`
    );
    await release();
    return true;
  };

  timer = setInterval(() => {
    tick().catch(() => {});
  }, tickMs);
  // 不靠这个定时器维持进程存活：进程该由 http server 撑着；server 关掉后自然结束。
  timer.unref?.();

  return { noteActivity, snapshot, tick, stop, released: () => released };
}

function portOf(server) {
  try {
    const a = server.address();
    return a && typeof a === 'object' ? a.port : String(a ?? '');
  } catch {
    return '';
  }
}
