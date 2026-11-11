// tasktool/panel-escort.js —— wait 阻塞期间的**面板随行**（从 wait.js 整体迁入）。
//
// 职责单一：这里的代码全部是「帮用户把面板窗口伺候好」——确保主面板在跑、
// 算深链、探测活动标签、必要时重开窗口（带节流/冷却/上限的防风暴）。
// 队列语义（领取/唤醒/登记/交付）仍在 wait.js；两边只通过 escortPanel 的
// 返回值 { stop() } 相接。失败一律降级，绝不抛错中断 wait。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../../core/paths.js';
import { openBrowser } from '../../core/open.js';
import {
  findRunningPanelPort,
  probeEffectivePresence,
  shouldReopenWindow,
} from '../localtask/service.js';

const REVIEW_MS = 5_000; // 阻塞期间复查「页面还开着」的间隔

function panelOrigin(port) {
  return `http://127.0.0.1:${port || DEFAULT_PORT}`;
}

// 深链到面板目录工作台并定位当前主题（key 必有；key 缺失时落总览兜底）。
// 端口取实际发现的面板（可能不是默认端口）。经典看板 #/localtask 已下线。
export function deepLinkUrl(key, port) {
  const page = key ? `#/dir/${encodeURIComponent(key)}` : '#/overview';
  return `${panelOrigin(port)}/${page}`;
}

// 本仓库/已安装包的 CLI 入口（src/modules/tasktool/ 上三级到包根）。
function binCliPath() {
  return fileURLToPath(new URL('../../../bin/kv.mjs', import.meta.url));
}

// 确保常驻主面板可用：已在运行直接复用；否则后台 detached 拉起一个独立
// `nx-kv serve --no-open --auto-exit`（unref，不随 wait 退出而关闭），再轮询健康端点。
// 失败只返回 running:false，绝不抛错——wait 仍可阻塞等待 CLI/轮询回填。
//
// --auto-exit：这个实例是**为等用户回填而临时拉起**的，用完就该让位——面板页全部关闭、
// 又没有等待中的主题时自行退出（宽限期见 panel-guard.js）。下一次 wait 需要时会再拉起
// （冷启动 <1s）。用户手动 `nx-kv serve` 的实例不带此标志，不会自己跑掉。
export async function ensureMainPanel() {
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

/**
 * 等待期间的窗口随行：初次开页判定 + 周期复查重开（节流/冷却/总次数上限）。
 * 时序与 wait.js 原实现逐行一致：调用点在 onReady 之后、await outcome 之前。
 *
 * @param {object} p
 * @param {boolean} p.open             wait 的 --no-open 反义（false = 全程不开页）
 * @param {object} p.panelInfo         ensureMainPanel 的返回（running/port/...）
 * @param {string} p.deepLink          deepLinkUrl 的产物
 * @param {number} p.initialPresence   阻塞开始时刻的活性探测值（0 = 没有活标签）
 * @returns {{ stop: () => void }}
 */
export function escortPanel({ open, panelInfo, deepLink, initialPresence }) {
  // 没活标签且主面板在跑 → 开浏览器深链（让用户能在面板里选中主题并响应等待事件）。
  // 已有活标签 / --no-open / 主面板未启动 → 都不开（避免重复标签 + 冒烟/CI 兼容）。
  const openPage = open && initialPresence === 0 && panelInfo.running;
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

  return {
    stop: () => clearInterval(review),
  };
}
