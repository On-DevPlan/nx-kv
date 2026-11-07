// （#54 自 service.js 拆出）面板 presence 观测与注册表：SSE 连接计数（含心跳剔除）、
// 常驻主面板发现（APP_DIR/panels.json 登记）、逐端口活性探测、窗口重开节流判据
// shouldReopenWindow（panel-guard 与 tasktool/panel-escort 用）。
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR, DEFAULT_PORT } from '../../core/paths.js';
import { atomicWriteTextSync } from '../../core/atomic-file.js';
import { openLocaltaskStore as openStore, topics as topicsRepo } from './repo/index.js';
import { isLiveWaiting } from './task-view.js';
// ─── 面板空闲自释放所需的观测接口（panel-guard.js 调用）────────────

// 当前有多少主题「真的在等待」——常驻面板的空闲自释放据此否决退出：
// 有 agent 正阻塞等人时，面板是唯一提醒来源，绝不能在此时释放。
//
// waiting 标志由 wait 进程写入、结束复位，跨进程可见；但 wait 被强杀（SIGKILL）时
// 标志会残留。判据统一走 isLiveWaiting（含「截止时刻已过 = 不算等待」这道闸）。
export async function countWaitingTopics() {
  openStore();
  const now = Date.now();
  let n = 0;
  for (const t of topicsRepo.listTopics()) {
    if (isLiveWaiting(t, now)) n += 1;
  }
  return n;
}
// 活动 SSE 面板连接（只在常驻 serve 进程内有意义）。每条记录最近一次成功写入的时间，
// wait 据此判断是否真有「活着的」面板标签：心跳写失败（标签已关、TCP 残留）会立刻剔除，
// 超过新鲜窗口没成功写过的连接不计入——避免页面关了却误判在线、整轮零提醒也不开页。
//
// 本期只交付「存在性」接口：panel-guard 只要 clients 数字。SSE 事件流是更上层能力，
// 留到下个 release 再叠加；这里只保留最小数据结构，streamEventsSSE 接入时直接复用。
const SSE_HEARTBEAT_MS = 15000;
const SSE_LIVE_WINDOW_MS = 30000;
const sseConns = new Set();

// 最近一次**任意**面板请求的时间。
// SSE 只挂在「本地任务」页，用户切到别的页 SSE 就断了 → 面板明明开着却报 0。
// 但 App 壳每 15s 打一次 /api/ping（任何页都打）→ 用它兜底才知道"面板还开着"。
let lastPanelRequestAt = 0;

/** serve 每收到一个面板请求就调一次（供 presence 与空闲判定用）。 */
export function notePanelRequest() {
  lastPanelRequestAt = Date.now();
}

export function panelPresence() {
  const now = Date.now();
  let clients = 0;
  for (const conn of sseConns) {
    if (now - conn.lastOkWrite <= SSE_LIVE_WINDOW_MS) clients += 1;
  }
  return {
    clients,
    total: sseConns.size,
    // 面板最近有没有请求过（切到别的页时 SSE 断了，但面板还开着）
    panelActive: now - lastPanelRequestAt <= SSE_LIVE_WINDOW_MS,
  };
}

/**
 * HTTP 面板用的 presence：在进程内计数（SSE + panelActive）之外，再补
 * 「等待中主题数」——App 壳据此在「本地任务」tab 上打角标，用户停在别的页
 * 也知道有 agent 在等回填（wait 因此不必再重开标签）。
 */
export async function httpPanelPresence() {
  const waiting = await countWaitingTopics().catch(() => 0);
  return { ...panelPresence(), waiting };
}

// 给 runtime/api.js 用的最小 SSE 注册表：每次「/api/localtasks/events」连接时
// 调一下 addEventStreamConn(req, res)，把连接纳入 panelPresence 统计。
export function addEventStreamConn(req, res) {
  const conn = { lastOkWrite: Date.now() };
  sseConns.add(conn);
  const beat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
      conn.lastOkWrite = Date.now();
    } catch {
      clearInterval(beat);
      sseConns.delete(conn);
    }
  }, SSE_HEARTBEAT_MS);
  beat.unref?.();
  const cleanup = () => {
    clearInterval(beat);
    sseConns.delete(conn);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  return conn;
}
// ─── 常驻主面板（固定端口）统一入口 ───────────────────────────────────

// 「某端口上有没有可响应的面板」：GET /api/ping。
// 这与 panelActive 不同：ping 在这里只问「端口上有没有人接 HTTP」，
// 用于决定是否复用现成面板 / 拉起 serve。
function pingPort(port, timeoutMs = 700) {
  return new Promise((resolve_) => {
    const req = http.get(`http://127.0.0.1:${port}/api/ping`, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve_(true);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve_(false);
    });
    req.on('error', () => resolve_(false));
  });
}

// 候选端口：默认端口优先，再叠加 panels.json 里登记的端口
// （`serve --port` 或默认端口被占自动顺延出来的面板）。
function candidatePanelPorts() {
  return [...new Set([DEFAULT_PORT, ...readAllPanels().map((p) => Number(p.port))])].filter(
    (p) => Number(p) > 0
  );
}

/**
 * 在给定端口列表里找一个正在响应的面板，返回第一个（按列表顺序）；都没有 → null。
 * 纯候选集版本，便于单测注入端口（默认端口上可能正跑着真实面板）。
 */
export async function findRunningAmongPorts(ports, timeoutMs = 700) {
  const list = [...new Set((Array.isArray(ports) ? ports : []).map(Number))].filter((p) => p > 0);
  const probed = await Promise.all(
    list.map(async (port) => ({ port, up: await pingPort(port, timeoutMs) }))
  );
  const hit = probed.find((r) => r.up);
  return hit ? hit.port : null;
}

/**
 * 在所有候选端口上找一个正在响应的面板，返回其端口（默认端口优先）；都没有 → null。
 * 多端口发现是「wait 不再重复开页面」的关键一环。
 */
export async function findRunningPanelPort(timeoutMs = 700) {
  return findRunningAmongPorts(candidatePanelPorts(), timeoutMs);
}

// 探主面板的 presence 端点。返回 {clients,total}；面板没在跑 / 探测失败 → null。
//
// 注意：**CLI 进程自己查自己的进程内计数恒为 0**（SSE 连接只存在于 serve 进程里），
// 所以 CLI 的 presence 必须去问「常驻主面板」——这正是本函数存在的理由。
async function fetchPanelPresence(timeoutMs = 900, port = DEFAULT_PORT) {
  const url = `http://127.0.0.1:${port}/api/localtasks/presence`;
  return new Promise((resolve_) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const d = j && typeof j === 'object' && j.data ? j.data : j;
          resolve_({
            clients: Math.max(0, Number(d && d.clients) || 0),
            total: Math.max(0, Number(d && d.total) || 0),
            panelActive: !!(d && d.panelActive),
          });
        } catch {
          resolve_(null);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve_(null);
    });
    req.on('error', () => resolve_(null));
  });
}

/**
 * wait 用的活性探测，返回 0 / 1。
 *
 * SSE 活标签（用户停在「本地任务」页）**或** 面板最近有请求（用户停在任意页，
 * App 壳每 15s 打 /api/ping 兜底）都算「面板开着」→ 1；都没有 → 0。
 * 旧口径只数 SSE：用户一切到别的页（SSE 单视图挂载，切页即断）wait 就误判
 * 「没开」，于是重复开标签——这正是本次修复的根因。
 *
 * 任何探测失败都按 0 处理（保守地开一次页），绝不因探测失败而阻塞 wait。
 */
/**
 * 纯判据：一次 presence 快照 → 0 / 1。
 * SSE 活标签或面板最近有请求（停在任意页）都算「面板开着」。
 */
export function effectivePresenceFrom(q) {
  if (!q) return 0;
  const clients = Math.max(0, Number(q.clients) || 0);
  return clients > 0 || q.panelActive ? 1 : 0;
}

export async function probeEffectivePresence(timeoutMs = 900) {
  const q = await queryPanelPresence(timeoutMs).catch(() => null);
  return effectivePresenceFrom(q);
}

/**
 * 面板活跃度（对外）：**逐个问所有跑着面板的端口**再求和。
 *
 * 两个真缺口（结构审计 + 真实 Chrome 复核）：
 *   1. 只问默认端口（7877）：别的端口上的面板（`serve --port` 或端口被占自动顺延）
 *      完全看不见 → wait 会以为「没人开着面板」而多开一个窗口。
 *      serve 起来时把自己登记进 `APP_DIR/panels.json`，这里逐个问。
 *   2. SSE 只挂在「本地任务」页，用户切到别的页 SSE 就断了 → `panelPresence()`
 *      报 0，但面板明明开着。这里额外用「最近有没有面板请求」兜底。
 *
 * 登记文件放在 APP_DIR（不是 store），**不碰 store schema**。
 */
export async function queryPanelPresence(timeoutMs = 900) {
  const registered = readPanelRegistry();
  const ports = [...new Set([DEFAULT_PORT, ...registered.map((p) => p.port)])];
  const results = await Promise.all(
    ports.map(async (port) => {
      const r = await fetchPanelPresence(timeoutMs, port);
      return r ? { port, ...r, reachable: true } : { port, clients: 0, total: 0, reachable: false };
    })
  );
  // 清掉探不到的面板登记（被强杀的进程来不及注销自己，登记会越积越多）
  const dead = registered.filter((p) => !results.some((r) => r.port === p.port && r.reachable));
  if (dead.length) {
    try {
      writePanels(registered.filter((p) => !dead.includes(p)));
    } catch {
      /* ignore */
    }
  }
  const alive = results.filter((r) => r.reachable);
  if (!alive.length) {
    // 一个面板都联系不上 → 退回本进程内计数（并说明来源）
    return { ...panelPresence(), source: 'self', panels: results };
  }
  return {
    clients: alive.reduce((n, r) => n + r.clients, 0),
    total: alive.reduce((n, r) => n + r.total, 0),
    // 面板「最近有请求」也算活着：用户可能停在别的页（SSE 已断）但面板开着
    panelActive: alive.some((r) => r.panelActive),
    source: 'panel',
    panels: results,
  };
}

// ─── 面板注册表（哪些端口上跑着面板）──────────────────────────────────
//
// serve 启动时登记 {port, pid}，退出时注销。presence 逐个探测这些端口。
// 死掉的登记不碍事：探测不到就跳过（还能顺手清掉）。
const PANEL_REGISTRY_FILE = () => join(APP_DIR, 'panels.json');

function readAllPanels() {
  try {
    const raw = readFileSync(PANEL_REGISTRY_FILE(), 'utf8');
    const data = JSON.parse(raw);
    const list = Array.isArray(data && data.panels) ? data.panels : [];
    return list.filter((p) => p && Number(p.port) > 0);
  } catch {
    return [];
  }
}

function writePanels(list) {
  try {
    const f = PANEL_REGISTRY_FILE();
    // 原子写（tmp+rename，收口自 core/atomic-file）：旧实现直接 writeFileSync，
    // 半途被杀会留下半个 JSON——下次 readAllPanels 解析失败，全部登记无声清零。
    // atomicWriteTextSync 内部 mkdirp，首次跑的干净用户目录也不会 ENOENT。
    atomicWriteTextSync(f, JSON.stringify({ panels: list }, null, 2));
  } catch {
    /* 登记失败不影响面板本身 */
  }
}

/** serve 起来时登记自己（同一端口重复登记即覆盖）。 */
export function registerPanel(port) {
  const list = readAllPanels().filter((p) => Number(p.port) !== Number(port));
  list.push({ port: Number(port), pid: process.pid, at: Date.now() });
  writePanels(list);
  return list;
}

/** serve 退出时注销自己。 */
export function unregisterPanel(port) {
  writePanels(readAllPanels().filter((p) => Number(p.port) !== Number(port)));
}

/** 读面板注册表（对外只读）。 */
export function readPanelRegistry() {
  return readAllPanels();
}

// 复查节奏与重开上限（REVIEW_MS 已随 wait 编排迁往 tasktool/wait.js）。
const REOPEN_COOLDOWN_MS = 20_000;
// 一次 wait 最多开 3 个窗口：够救「手滑关掉」，又不至于在浏览器拦截脚本时刷屏。
const MAX_WINDOW_OPENS = 3;

/**
 * 复查时要不要重开窗口。四条判据，任一不满足就不开：
 *   1. 有活标签（presence > 0）→ 用户在看着，别打扰；
 *   2. 已经开够次数 → 停止（浏览器拦了脚本、或用户就是不想看，开再多也没用）；
 *   3. 距上一次开页还在冷却期内 → 等一等（页面加载 + 建立 SSE 需要几秒）；
 *   4. 其余情况才重开（标签被关了 / 第一次没开成）。
 *
 * 抽成纯函数的原因：这段逻辑的 bug 不报错、只表现为「窗口越开越多」，
 * 必须能被单测钉住。
 */
export function shouldReopenWindow({
  presence,
  now,
  lastOpenAt,
  opens,
  cooldownMs = REOPEN_COOLDOWN_MS,
  maxOpens = MAX_WINDOW_OPENS,
} = {}) {
  if (Number(presence) > 0) return false;
  if (Number(opens) >= maxOpens) return false;
  if (Number(lastOpenAt) > 0 && Number(now) - Number(lastOpenAt) < cooldownMs) return false;
  return true;
}
