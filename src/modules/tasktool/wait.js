// tasktool/wait.js —— wait/get 的阻塞编排（从 localtask/service.js 整体迁入）。
//
// 边界（tasktool = 任务工具语义，localtask = 队列本体）：
//   - 队列读写、唤醒注册表、presence/面板注册表都在 localtask（serve 路由与
//     panel-guard 的一半也长在那边），这里只做**队列编排**：快路径领取 → 阻塞窗口
//     （跨进程轮询 / goal 到点收尾 / 用户关闭）→ 交付组装。
//   - 面板随行（确保主面板 / 深链 / 窗口重开防风暴）已拆到 panel-escort.js——
//     这里只经 escortPanel({ stop() }) 一点相接。
//   - 与队列的耦合全部走 localtask/service.js 的导出面；与计时目标的耦合走
//     同模块的 timegoal.js（探针只读 + 交付时刻的目标上下文）。
import { DEFAULT_PORT } from '../../core/paths.js';
import { formatGoalTiming, renderInstruction } from '../../core/instruction-template.js';
import { buildDeliveryCtx } from './delivery-template.js';
import { parseFrontmatter } from '../../shared/frontmatter.js';
import {
  BLOCK_DEFS,
  resolveBlockTemplates,
} from '../../shared/prompt-blocks.js';
import {
  clampTimeoutSec,
  clearWaiting,
  consumeCancelRequest,
  consumeFirstPending,
  getSettings,
  GLOBAL_KEY,
  isGlobalKey,
  normalizeCwd,
  normalizeSummary,
  pendingQueueInfo,
  probeEffectivePresence,
  registerGlobalWaiter,
  registerTopicWaiter,
  repoContextIndex,
  repoCtxOf,
  setWaiting,
  unregisterTopicWaiter,
} from '../localtask/service.js';
import { ensureMainPanel, deepLinkUrl, escortPanel } from './panel-escort.js';
import { ensureTaskGoal, previewTaskGoal } from './taskgoal.js';
import { readGroupContext } from './groupctx.js';
import { annotateTaskDelivery, attachTemplateCtx } from './attach.js';
import { composeSystemBlocks } from './system-blocks.js';
import * as timegoal from './timegoal.js';

// 跨进程兜底轮询间隔（只定这里的读取节奏；队列写入节奏与它无关）
const POLL_MS = 500;

// 「YYYY-MM-DD HH:mm:ss」→ epoch ms（任务级 goal 的起点 = consumedAt）；解析不了返回 NaN
function parseStampMs(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(v || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

// goal 上下文的**时间运算字段**统一在这里补齐（任务 #82：模板层要能拿剩余/超时做运算，
// 不能只有人话的 remainingHuman）。目录级 show 自带 reached/remainingSec/overtimeSec；
// 任务级只有 deadline 戳——同式解析补算。缺哪个补哪个，已有的不覆盖。
export function enrichGoalTiming(g) {
  if (!g) return g;
  let { remainingSec, overtimeSec, reached } = g;
  remainingSec = Number(remainingSec);
  overtimeSec = Number(overtimeSec);
  if (!Number.isFinite(remainingSec) && !Number.isFinite(overtimeSec)) {
    const ms = parseStampMs(g.deadline);
    if (Number.isFinite(ms)) {
      const diff = Math.round((ms - Date.now()) / 1000);
      remainingSec = diff >= 0 ? diff : 0;
      overtimeSec = diff >= 0 ? 0 : -diff;
    }
  }
  if (reached === undefined) {
    if (Number.isFinite(overtimeSec)) reached = overtimeSec > 0;
    else if (Number.isFinite(remainingSec)) reached = remainingSec <= 0;
  }
  if (Number.isFinite(remainingSec)) {
    g.remainingSec = remainingSec;
    g.remainingMin = Math.ceil(remainingSec / 60);
  }
  if (Number.isFinite(overtimeSec)) g.overtimeSec = overtimeSec;
  if (reached !== undefined) g.reached = reached;
  return g;
}

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
      reached: !!show.reached,
      remainingSec: show.remainingSec,
      overtimeSec: show.overtimeSec,
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

// 组装 wait/get 返回的任务载荷 + 指令。**单一路径**：
//   所有段落（上下文 / 附件 / 时间目标 / ack / 持续 get）一律进返回载荷的
//   instruction 字段；task.text 始终是库存原文，绝不把系统提示词拼进正文。
//   旧 rule 区块已删除：done 指令与收尾要求统一由 ack 区块承载。
// 任何异常都降级为「只回任务」——wait 绝不能因渲染挂掉（与探针同一条 fail-open 纪律）。
//
// preview / trace（任务 #65「预览 get 提示词」）：
//   preview=true → **零副作用**：不问附件云端同步（只读本机仓与镜像）、不启动
//     任务级 timegoal 计时（用声明现算同一份 check 指令）。其余渲染路径与真实领取
//     完全同一条代码，所以预览出来的字符串就是 agent 会拿到的那一份。
//   trace=[]     → 按顺序记下每一段的来源（谁贡献的、开关是否开着），供面板展示
//     「这段是哪来的」。真实领取不传 trace，行为与改造前逐字节一致。
export async function buildTaskDelivery(task, { source, summary, cwd, name, topicKey, params, preview = false, trace, getLoopTpl = '', getLoopWaitMinutes = 0 } = {}) {
  // 附件标注（任务 #15：正文里的 ![名](fileId) 嵌入 → 附件清单 + 本地路径）。
  // fail-open：标注失败绝不拖垮交付；正文没有引用时 annotateTaskDelivery 返回
  // null，载荷与改造前**逐字节一致**（与 todo 读任务的同一条纪律）。
  let att = null;
  let attSync = null;
  try {
    const a = await annotateTaskDelivery(task, { sync: !preview, topicKey });
    if (a) {
      task = a.task;
      att = a;
      attSync = a.sync;
    }
  } catch {
    /* 标注失败照常交付（agent 还能从正文里的嵌入自行处理） */
  }
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
      // 预览走只读版本：同一份 check 指令文本，但不落盘、不起表
      taskGoalCtx = preview
        ? await previewTaskGoal({ topicKey, taskId: task.id, cwd, name: title, timegoal: task.timegoal })
        : await ensureTaskGoal({
            topicKey,
            taskId: task.id,
            cwd,
            name: title,
            timegoal: task.timegoal,
            startedAtMs: parseStampMs(task.consumedAt) || undefined,
          });
    }
    const goal = enrichGoalTiming(taskGoalCtx || (await readGoalCtx(cwd)));

    // 项目组上下文（组概念 + 本项目位置 + 兄弟成员 + 参考文件地址）：只进 instruction。
    // #64 作用域：组材料只挂**组任务**（正文 frontmatter 带 board）；单 repo 主题里
    // 提交的纯项目任务只带项目介绍，不把所属组的材料挂进来。
    const boardMark = String(parseFrontmatter(String((task && task.text) || '')).board || '').trim();
    const groupCtx = await readGroupContext(cwd, { board: boardMark });
    const settings = (await getSettings().catch(() => null)) || {};
    const deliveryCtx = buildDeliveryCtx({ task, goal, source, summary, cwd, name, groupCtx, params });

    // ── 区块 v3：先备好**一份共享 ctx**，所有区块模板都从这份数据取值 ──
    // 任务级 goal → 完整 check 指令；目录级 goal → 状态行（二者都进 timecheck 区块）。
    const goalCheck = taskGoalCtx ? taskGoalCtx.prompt : null;
    const goalStatus = !taskGoalCtx && goal
      ? `〔时间目标「${goal.name || ''}」${goal.remainingHuman || ''}〕`
      : null;
    const attachCtx = att ? attachTemplateCtx(att.task.attachments, att.sync) : { attach: null };
    const baseCtx = {
      ...deliveryCtx,
      // 共享 ctx 里的 goal 同时暴露 check / statusLine，模板不必区分两种来源。
      goal: goal
        ? { ...goal, check: goalCheck || '', statusLine: goalStatus || '' }
        : null,
      ...attachCtx,
      task: task ? { id: task.id, text: String(task.text || '') } : null,
      // 「持续 get」指令模板自身也能用 {{getloop.waitMinutes}}：先把阻塞窗口放进
      // 同一份 ctx，外层 getloop 区块再补 text（同一个对象口径，前后不分裂）。
      getloop: { text: '', waitMinutes: Number(getLoopWaitMinutes) || 0 },
    };
    // 持续 get 模板本身也是模板（可含 {{task.id}} 等），先在变量上下文里渲染成文本，
    // 再由 getloop 区块的 `{{getloop.text}}` 输出。渲染失败同样记告警（不静默）。
    const renderWarnings = [];
    let loopText = '';
    if (getLoopTpl) {
      try {
        loopText = renderInstruction(getLoopTpl, baseCtx) || '';
      } catch (e) {
        renderWarnings.push({
          block: 'getloop',
          label: '持续 get 指令（项目级）',
          message: String((e && e.message) || e).replace(/\s+/g, ' ').trim(),
        });
      }
    }
    // ext（队列余量）：同主题还有多少待领取任务 + 标题，提示优先级。
    // 现算（同主题一次读取），不做缓存；空队列 → null，整段不渲染。
    // 读取失败不阻断领取：按缺失处理，并把原因记进 renderWarnings。
    let extCtx = null;
    try {
      const q = await pendingQueueInfo(topicKey, task && task.id);
      if (q && q.count > 0) extCtx = { topic: q.topic, count: q.count, list: q.list };
    } catch (e) {
      renderWarnings.push({
        block: 'ext',
        label: '待领取队列（ext）',
        message: String((e && e.message) || e).replace(/\s+/g, ' ').trim(),
      });
    }
    const blockCtx = {
      ...baseCtx,
      getloop: loopText
        ? { text: loopText, waitMinutes: Number(getLoopWaitMinutes) || 0 }
        : null,
      ext: extCtx,
    };

    const mode = settings.appendMode === 'plain' ? 'plain' : 'xml';
    // 每个区块按各自列表中选中的生效模板渲染（内置常驻，找不到就回落内置）
    const blockTemplates = resolveBlockTemplates(settings.blockTemplates);
    const segments = [
      { id: 'context', label: '组 / 项目上下文（模板）', traceId: 'delivery' },
      { id: 'attachment', label: '附件段（清单 / 本地路径）', traceId: 'attach' },
      { id: 'timecheck', label: '时间目标（状态 / check 指令）', traceId: 'goal' },
      { id: 'ext', label: '待领取队列（ext）', traceId: 'ext' },
      { id: 'ack', label: 'ack 完成总结提示词', traceId: 'ack' },
      { id: 'getloop', label: '持续 get 指令（项目级）', traceId: 'getloop' },
    ];
    const full = composeSystemBlocks(segments, {
      mode,
      templates: blockTemplates,
      ctx: blockCtx,
      trace,
      warnings: renderWarnings,
    });
    const warnField = renderWarnings.length ? { renderWarnings } : {};
    if (!full) {
      return { task, ...warnField, ...(attSync ? { attachmentsSync: attSync } : {}) };
    }
    // coversBody = 启用区块的任一模板含 {{task.text}}（instruction 自包含任务正文）。
    // 由服务端判定，避免 CLI 端做子串猜测。
    return {
      task,
      instruction: full,
      coversBody: blocksCoverBody(blockTemplates),
      ...warnField,
      ...(attSync ? { attachmentsSync: attSync } : {}),
    };
  } catch {
    return { task };
  }
}

/** 当前生效模板里是否有模板写了 {{task.text}}（instruction 自包含任务正文）。 */
function blocksCoverBody(templates) {
  return BLOCK_DEFS.some((d) => /\{\{\s*task\.text\s*\}\}/.test(String(templates?.[d.id]?.template || '')));
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
  params = {}, // 外部参数（平面扩展）：进交付模板的 ctx（--param k=v）
  instant = false, // get 的「直接领」形态：没有 pending 立即空手而回，不开窗不阻塞
  getLoopTpl = '', // 项目级「持续 get」模板（仅 get/preview 传；wait 不传 → 不出现该区块）
  getLoopWaitMinutes = 0, // 项目级阻塞窗口（分钟）：进 getloop 模板 ctx，让 agent 知道每轮会等多久
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
  // T03：设置走 settings 表（repo/settings），不再有 JSON store 对象
  const startSettings = await getSettings();
  let sec;
  if (timeoutSec !== undefined && timeoutSec !== null) sec = timeoutSec;
  else if (timeoutMs !== undefined && timeoutMs !== null) sec = Number(timeoutMs) / 1000;
  else sec = startSettings.timeoutSec;
  const tmo = clampTimeoutSec(sec) * 1000;

  // 1. 主题队列已有 pending → 立即取走，不开窗、不阻塞；记录本轮完成总结
  const queued = await consumeFirstPending(key, summary, by);
  if (queued) {
    const delivery = await buildTaskDelivery(queued, { source: 'local', summary, cwd, name, topicKey: key, params, getLoopTpl, getLoopWaitMinutes });
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
    const delivery = await buildTaskDelivery(fromGlobal, { source: 'global', summary, cwd, name, topicKey: key, params, getLoopTpl, getLoopWaitMinutes });
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
    consumeCancelRequest(key)
      .then((yes) => {
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
      /* 钩子异常不得影响 wait */
    }
  }

  // 没活标签且主面板在跑 → 开浏览器深链 + 周期复查重开（含初次开页判定）。
  // 全部细节（节流/冷却/上限/降级）在 panel-escort.js；这里只管起停。
  const escort = escortPanel({ open, panelInfo, deepLink, initialPresence: presence });

  let result;
  try {
    const r = await outcome;
    // 交付指令在**返回时刻**组装（此刻的 goal 状态才是真实状态；阻塞期间到点会渲染出已到点）。
    // 只对拿到任务的结果生效——timeout/goal_expired/cancelled 的返回形状是钉死的契约，不动。
    const delivery =
      r.kind === 'task'
        ? await buildTaskDelivery(r.task, { source: r.source || 'local', summary, cwd, name, topicKey: key, params, getLoopTpl, getLoopWaitMinutes })
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

