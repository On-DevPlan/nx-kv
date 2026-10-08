// 实时任务输入 service —— 按「工作目录（cwd）」划分的主题（topic）+ 主题任务队列 +
// 阻塞等待 + 内嵌弹窗。
//
// 解决的问题：agent 在一个对话里需要用户继续给任务时，不必结束本轮、等用户去
// 原始输入框打字，而是把 `nx-kv sessiontask wait --cwd "<工作目录>" --summary "<当前现状>"`
// 当作 **本轮最后一个动作**调用——命令阻塞、自动打开浏览器弹窗；用户在弹窗/面板回填，
// 命令解除阻塞、把新任务作为结果返回给 agent，agent 接着干。
//
// 关键设计：
//   1. **工作目录即主题，主题拥有队列。** wait 传入工作目录（默认进程 cwd），归一化后
//      作为主题 key；同一目录的多次 wait（即便现状措辞不同）共用同一个任务队列，
//      不同目录 → 不同主题 → 队列互不串。任务可在一个主题队列里逐条堆积，agent 按序领取。
//   2. **现状总结只作状态展示。** --summary 是 agent 当前状态（人读），每次 wait 刷新，
//      不再参与队列分桶；用户据此一眼看清 agent 做到哪、卡在哪。
//   3. **纯本地协调，不依赖 KV 后端登录态。** 数据落本机文件，弹窗由本进程临时起的
//      http 服务器直出，未登录也能用。
//   4. **排队语义。** 用户可提前回填：主题已有 pending 时 wait 立即取走、不开窗；
//      没有 pending 才开窗阻塞。
//   5. **超时是业务结果不是错误。** 默认阻塞 2 分钟；超时返回 {status:'timeout'}、
//      exit 0，agent 据此安静收尾结束本轮，绝不抛异常。
//
// 跨进程：弹窗与 wait 同进程时靠内存 waiter 即时唤醒；任务由别的进程写入（如常驻
// serve 的面板页）时，wait 用轮询兜底（见 POLL_MS）。
import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { APP_DIR } from '../../core/paths.js';
import { badInput } from '../../core/errors.js';
import { openBrowser } from '../../core/open.js';
import { renderPopupPage } from './popup.js';

export const DEFAULT_TIMEOUT_MS = 180_000; // 阻塞默认 3 分钟（推荐值）
const POLL_MS = 500; // 跨进程兜底轮询间隔
export const DEFAULT_TIMEOUT_SEC = 180; // 推荐阻塞时长（3 分钟）
export const MAX_TIMEOUT_SEC = 600; // 阻塞时长上限（10 分钟）
export const MAX_SUMMARY = 2000; // 现状（状态）长度上限（原 200，已放宽）
export const MAX_TEXT = 20_000; // 单条任务内容长度上限

// ─── 存储位置：可环境变量覆盖（测试隔离） ───────────────────────────

export function storePath() {
  return process.env.NX_KV_SESSIONTASK_STORE || join(APP_DIR, 'sessiontasks.json');
}

// ─── 工作目录 → 主题 ───────────────────────────────────────────────

/**
 * 归一化工作目录并解析主题。
 * @param {string} [raw] 目录路径；缺省/空 → 进程当前 cwd
 * @returns {{cwd:string, key:string}}
 */
export function normalizeCwd(raw) {
  const trimmed = raw && String(raw).trim() ? String(raw).trim() : '';
  let cwd;
  try {
    cwd = resolve(trimmed || process.cwd());
  } catch {
    cwd = process.cwd();
  }
  const name = basename(cwd);
  return { cwd, name, key: topicKeyFor(name) };
}

// 主题以「目录名」标识：在名为 br_ct 的目录里执行 CLI → 自动领取 br_ct 主题队列的任务；
// 同名目录共用同一队列。Windows 折叠目录名大小写。
export function topicKeyFor(name) {
  const fold = process.platform === 'win32' ? String(name).toLowerCase() : String(name);
  return crypto.createHash('sha1').update(fold, 'utf8').digest('hex').slice(0, 16);
}

// ─── 现状（状态文本） ──────────────────────────────────────────────

// 归一化：折叠所有连续空白为单空格、去首尾。wait 必填；add 可选（仅刷新状态）。
export function normalizeSummary(raw, { optional = false } = {}) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) {
    if (optional) return '';
    throw badInput('缺少 --summary "<当前现状总结>"（agent 当前状态，展示给用户）');
  }
  if (s.length > MAX_SUMMARY) {
    throw badInput(`--summary 过长（≤${MAX_SUMMARY} 字，当前 ${s.length} 字）`);
  }
  return s;
}

// 任务正文：必填、限长
function normalizeText(raw) {
  const body = String(raw ?? '').trim();
  if (!body) throw badInput('任务内容不能为空');
  if (body.length > MAX_TEXT) {
    throw badInput(`任务内容过长（≤${MAX_TEXT} 字，当前 ${body.length} 字）`);
  }
  return body;
}

// ─── 时间 ───────────────────────────────────────────────────────────

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function stampNow(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// ─── 存储读写（原子写 + 损坏容忍 + v1/v2 迁移） ───────────────────

function emptyStore() {
  return { version: 4, settings: { timeoutSec: DEFAULT_TIMEOUT_SEC }, topics: {} };
}

// 归一化超时秒数：非法/缺省 → 推荐值；超上限截断为 10 分钟
export function clampTimeoutSec(sec) {
  let n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) n = DEFAULT_TIMEOUT_SEC;
  n = Math.floor(n);
  if (n > MAX_TIMEOUT_SEC) n = MAX_TIMEOUT_SEC;
  return n;
}

// 旧的等待点（v2 slot / v1 session）转主题：旧 key 来自现状摘要、无 cwd 信息，
// 故保留原 key，用现状摘要截一段作主题名、cwd 留空。
function legacyTopic(key, b) {
  const summary = (b && b.summary) || key;
  return {
    key,
    cwd: '',
    name: summary.length > 40 ? summary.slice(0, 40) + '…' : summary,
    summary,
    createdAt: (b && b.createdAt) || stampNow(),
    updatedAt: (b && b.updatedAt) || stampNow(),
    waiting: !!(b && b.waiting),
    waitingUntil: (b && b.waitingUntil) || '',
    tasks: b && Array.isArray(b.tasks) ? b.tasks : [],
  };
}

async function loadStore() {
  let topics = null;
  let settings = null;
  try {
    const raw = await fsp.readFile(storePath(), 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      if (data.topics && typeof data.topics === 'object') {
        topics = data.topics;
      } else if (data.slots && typeof data.slots === 'object') {
        // v2（slots 桶）→ topics
        topics = {};
        for (const [k, b] of Object.entries(data.slots)) topics[k] = legacyTopic(k, b);
      } else if (data.sessions && typeof data.sessions === 'object') {
        // v1（sessions 桶）→ topics
        topics = {};
        for (const [k, b] of Object.entries(data.sessions)) topics[k] = legacyTopic(k, b);
      }
      if (data.settings && typeof data.settings === 'object') settings = data.settings;
    }
  } catch {
    /* 损坏/缺失 → 空 store */
  }
  if (!topics) return emptyStore();
  return {
    version: 4,
    settings: { timeoutSec: clampTimeoutSec(settings && settings.timeoutSec) },
    topics,
  };
}

async function saveStore(data) {
  const p = storePath();
  await fsp.mkdir(dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, p);
}

// 取（必要时新建）某个主题
function topicOf(store, key, cwd, name = '') {
  const nm = name || (cwd ? basename(cwd) : '') || key;
  let t = store.topics[key];
  if (!t || !Array.isArray(t.tasks)) {
    t = {
      key,
      cwd: cwd || '',
      name: nm,
      createdAt: stampNow(),
      updatedAt: stampNow(),
      waiting: false,
      waitingUntil: '',
      summary: '',
      tasks: [],
    };
    store.topics[key] = t;
  }
  if (cwd) t.cwd = cwd;
  if (name) t.name = name;
  else if (cwd) t.name = basename(cwd) || t.name;
  return t;
}

function nextTaskId(tasks) {
  let max = 0;
  for (const t of tasks) {
    const id = Number(t.id) || 0;
    if (id > max) max = id;
  }
  return max + 1;
}

function normalizeTask(t) {
  return {
    id: Number(t.id) || 0,
    text: String(t.text ?? ''),
    status: t.status === 'consumed' ? 'consumed' : 'pending',
    roundSummary: String(t.roundSummary ?? ''),
    createdAt: String(t.createdAt ?? ''),
    consumedAt: String(t.consumedAt ?? ''),
  };
}

function topicView(t) {
  const tasks = t.tasks.map(normalizeTask);
  return {
    key: t.key,
    cwd: t.cwd || '',
    name: t.name || '',
    summary: t.summary || '',
    waiting: !!t.waiting,
    waitingUntil: t.waitingUntil || '',
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    pending: tasks.filter((x) => x.status !== 'consumed').length,
    total: tasks.length,
    tasks,
  };
}

// ─── 进程内 waiter：key -> { resolve(task) } ───────────────────────

const waiters = new Map();

function markConsumed(task, roundSummary) {
  task.status = 'consumed';
  task.consumedAt = stampNow();
  // 记录该任务所回应的「agent 上一轮完成总结」（本轮等待时的现状）
  if (roundSummary) task.roundSummary = roundSummary;
  return task;
}

// 取走该主题第一条 pending；没有则返回 null。roundSummary 显式指定本轮完成总结，
// 缺省回落到主题当前 summary（等待中即本轮现状）。
export async function consumeFirstPending(key, roundSummary) {
  const store = await loadStore();
  const t = store.topics[key];
  if (!t) return null;
  const task = t.tasks.find((x) => x.status !== 'consumed');
  if (!task) return null;
  markConsumed(task, roundSummary || t.summary || '');
  t.updatedAt = stampNow();
  await saveStore(store);
  return normalizeTask(task);
}

// 在 store 里把某主题置为等待/结束，并刷新现状
async function setWaiting(key, cwd, summary, waiting, deadline) {
  const store = await loadStore();
  const t = topicOf(store, key, cwd);
  t.waiting = waiting;
  t.waitingUntil = waiting && deadline ? stampNow(deadline) : '';
  if (summary) t.summary = summary;
  t.updatedAt = stampNow();
  await saveStore(store);
}

// ─── CRUD ───────────────────────────────────────────────────────────

function settingsView(s) {
  return {
    timeoutSec: clampTimeoutSec(s && s.timeoutSec),
    recommendedSec: DEFAULT_TIMEOUT_SEC,
    maxSec: MAX_TIMEOUT_SEC,
  };
}

// 总览：返回全部主题（面板据此分组展示与回填）+ 超时设置，按最近更新排序
export async function listTasks() {
  const store = await loadStore();
  const topics = Object.values(store.topics)
    .map(topicView)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { topics, waiting: topics.filter((t) => t.waiting).length, settings: settingsView(store.settings) };
}

export async function getSettings() {
  const store = await loadStore();
  return settingsView(store.settings);
}

// 清理旧脏数据：只动「非等待中」的主题——
//   1) 旧模型迁移来的无 cwd 主题（“旧数据，无目录”）；
//   2) 空主题（没有任何任务）；
//   3) allFinished 时，连同「已全部领取、无待领」的主题一起清。
// 等待中的主题一律保留；dryRun 只报告不改动。
export async function pruneTopics({ allFinished = false, dryRun = false } = {}) {
  const store = await loadStore();
  const removed = [];
  for (const [key, t] of Object.entries(store.topics)) {
    if (t.waiting) continue;
    const tasks = Array.isArray(t.tasks) ? t.tasks : [];
    const hasPending = tasks.some((x) => x.status !== 'consumed');
    const isLegacy = !t.cwd;
    const isEmpty = tasks.length === 0;
    const isFinished = allFinished && tasks.length > 0 && !hasPending;
    if (isLegacy || isEmpty || isFinished) {
      const reason = isLegacy ? '旧模型无目录' : isEmpty ? '空主题' : '已完成无待领';
      removed.push({ key, name: t.name || key, cwd: t.cwd || '', reason });
    }
  }
  if (!dryRun) {
    for (const r of removed) delete store.topics[r.key];
    if (removed.length) await saveStore(store);
  }
  return { status: 'ok', dryRun: !!dryRun, count: removed.length, removed };
}

// 配置等待超时（页面可调；推荐 180=3 分钟，最大 600=10 分钟，超上限自动截断）
export async function updateSettings({ timeoutSec } = {}) {
  const n = Number(timeoutSec);
  if (!Number.isFinite(n) || n <= 0) {
    throw badInput(`超时时间需为 1-${MAX_TIMEOUT_SEC} 秒（推荐 ${DEFAULT_TIMEOUT_SEC}）`);
  }
  const store = await loadStore();
  store.settings = { timeoutSec: clampTimeoutSec(n) };
  await saveStore(store);
  return settingsView(store.settings);
}

export async function getTask({ cwd: rawCwd, id } = {}) {
  const { key, cwd } = normalizeCwd(rawCwd);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  const store = await loadStore();
  const t = store.topics[key];
  const task = t && t.tasks.find((x) => Number(x.id) === want);
  if (!task) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : cwd}」里没有 #${want} 任务`);
  }
  return normalizeTask(task);
}

/**
 * 向某主题（工作目录）的队列回填任务。
 * 若本进程正有 wait 在等该主题 → 直接投递并唤醒；否则入队堆积。
 */
export async function addTask({ cwd: rawCwd, summary: rawSummary, text } = {}) {
  const { key, cwd } = normalizeCwd(rawCwd);
  const summary = normalizeSummary(rawSummary, { optional: true });
  const body = normalizeText(text);

  const store = await loadStore();
  const t = topicOf(store, key, cwd);
  const task = normalizeTask({ id: nextTaskId(t.tasks), text: body, status: 'pending', createdAt: stampNow() });
  t.tasks.push(task);
  t.updatedAt = stampNow();
  if (summary) t.summary = summary;

  const waiter = waiters.get(key);
  const delivered = !!waiter;
  if (waiter) {
    markConsumed(task, t.summary);
    waiters.delete(key);
    t.waiting = false;
    t.waitingUntil = '';
  }

  await saveStore(store); // 先落盘再唤醒：wait 返回时数据必然一致
  if (waiter) waiter.resolve(normalizeTask(task));

  return {
    status: 'ok',
    key,
    cwd,
    name: t.name,
    summary: t.summary,
    task: normalizeTask(task),
    delivered,
    queued: !delivered,
  };
}

export async function updateTask({ cwd: rawCwd, id, text } = {}) {
  const { key, cwd } = normalizeCwd(rawCwd);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  const body = String(text ?? '').trim();
  if (!body) throw badInput('--text 不能为空');
  if (body.length > MAX_TEXT) throw badInput(`任务内容过长（≤${MAX_TEXT} 字）`);

  const store = await loadStore();
  const t = store.topics[key];
  const task = t && t.tasks.find((x) => Number(x.id) === want);
  if (!task) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : cwd}」里没有 #${want} 任务`);
  }
  task.text = body;
  t.updatedAt = stampNow();
  await saveStore(store);
  return { status: 'ok', key, cwd, name: t.name, task: normalizeTask(task) };
}

export async function removeTask({ cwd: rawCwd, id } = {}) {
  const { key, cwd } = normalizeCwd(rawCwd);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');

  const store = await loadStore();
  const t = store.topics[key];
  const index = t ? t.tasks.findIndex((x) => Number(x.id) === want) : -1;
  if (index < 0) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : cwd}」里没有 #${want} 任务`);
  }
  const [removed] = t.tasks.splice(index, 1);
  t.updatedAt = stampNow();
  await saveStore(store);
  return { status: 'ok', key, cwd, name: t.name, removed: normalizeTask(removed) };
}

// ─── 阻塞等待：核心入口 ─────────────────────────────────────────────

/**
 * 针对某主题（工作目录）等待用户回填下一条任务。
 * @param {string}  [cwd]     工作目录（主题按目录名识别）；缺省 → 进程当前 cwd
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
} = {}) {
  const { key, cwd, name } = normalizeCwd(rawCwd);
  const summary = normalizeSummary(rawSummary); // 现状必填

  // 超时：显式 --timeout（秒/毫秒）优先；否则用页面配置；统一夹到 1-600
  let sec;
  if (timeoutSec !== undefined && timeoutSec !== null) sec = timeoutSec;
  else if (timeoutMs !== undefined && timeoutMs !== null) sec = Number(timeoutMs) / 1000;
  else sec = (await loadStore()).settings.timeoutSec;
  const tmo = clampTimeoutSec(sec) * 1000;

  // 1. 主题队列已有 pending → 立即取走，不开窗、不阻塞；记录本轮完成总结
  const queued = await consumeFirstPending(key, summary);
  if (queued) return { status: 'ok', key, cwd, name, summary, task: queued, queued: true };

  // 2. 没有 pending → 起内嵌弹窗服务器
  const server = await startPopupServer(key, cwd, summary, tmo);
  const addr = `http://127.0.0.1:${server.address().port}/`;

  // 3. 结果承诺：两个生产者（同进程 waiter / 跨进程轮询）+ 超时
  let resolveOutcome;
  const outcome = new Promise((r) => {
    resolveOutcome = r;
  });
  waiters.set(key, {
    resolve: (task) => resolveOutcome({ kind: 'task', task, delivered: true }),
  });

  const poll = setInterval(() => {
    consumeFirstPending(key)
      .then((task) => {
        if (task) resolveOutcome({ kind: 'task', task, delivered: false });
      })
      .catch(() => {
        /* 瞬时读写错误，下一轮再试 */
      });
  }, POLL_MS);

  const timer = setTimeout(() => resolveOutcome({ kind: 'timeout' }), tmo);

  // 登记「等待中」（含截止时刻与现状），面板/弹窗据此显示倒计时
  await setWaiting(key, cwd, summary, true, new Date(Date.now() + tmo));

  // waiter/轮询就位后再回调，保证 onReady 里立刻回填也能被接住
  if (typeof onReady === 'function') {
    try {
      await onReady({ addr, key, cwd, name, summary });
    } catch {
      /* 钩子异常不得影响 wait */
    }
  }

  if (open) openBrowser(addr);

  let result;
  try {
    const r = await outcome;
    result =
      r.kind === 'timeout'
        ? { status: 'timeout', key, cwd, summary, timeoutMs: tmo }
        : { status: 'ok', key, cwd, name, summary, task: r.task, delivered: r.delivered, queued: false };
  } finally {
    clearInterval(poll);
    clearTimeout(timer);
    waiters.delete(key);
    await setWaiting(key, cwd, '', false);
    await stopServer(server);
  }
  return result;
}

// ─── 内嵌弹窗服务器 ─────────────────────────────────────────────────

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(html);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1024 * 1024) throw new Error('请求体过大');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// 与主 api.js 同一套跨站防护：弹窗服务器虽只绑 127.0.0.1，浏览器里任意页面都能
// 向它发请求，非本机来源一律挡。
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const h = new URL(origin).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1';
  } catch {
    return false;
  }
}

async function handlePopup(req, res, key, cwd, summary, timeoutMs) {
  const url = new URL(req.url, 'http://127.0.0.1/');
  const method = (req.method || 'GET').toUpperCase();

  try {
    if ((method === 'GET' || method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
      sendHtml(res, renderPopupPage({ key, cwd, summary, timeoutMs }));
      return;
    }

    if (url.pathname === '/api/sessiontasks' && method === 'GET') {
      sendJson(res, 200, { ok: true, data: await listTasks() });
      return;
    }

    if (url.pathname === '/api/sessiontasks' && method === 'POST') {
      if (!originAllowed(req)) {
        sendJson(res, 403, { ok: false, error: '跨站请求被拒绝（弹窗仅接受本机来源）', code: 'BLOCKED' });
        return;
      }
      const body = await readBody(req);
      sendJson(res, 200, { ok: true, data: await addTask({ cwd, text: body.text }) });
      return;
    }

    if (url.pathname === '/api/sessiontasks/item' && method === 'DELETE') {
      if (!originAllowed(req)) {
        sendJson(res, 403, { ok: false, error: '跨站请求被拒绝（弹窗仅接受本机来源）', code: 'BLOCKED' });
      } else {
        const body = await readBody(req);
        sendJson(res, 200, { ok: true, data: await removeTask({ cwd, id: body.id }) });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: '不存在: ' + method + ' ' + url.pathname });
  } catch (err) {
    const code = err && err.code === 'INVALID_INPUT' ? 400 : err && err.code === 'NOT_FOUND' ? 404 : 500;
    sendJson(res, code, { ok: false, error: String((err && err.message) || err), code: err.code || 'INTERNAL' });
  }
}

function startPopupServer(key, cwd, summary, timeoutMs) {
  const server = http.createServer((req, res) => handlePopup(req, res, key, cwd, summary, timeoutMs));
  return new Promise((resolve_, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve_(server));
  });
}

function stopServer(server) {
  return new Promise((resolve_) => {
    const force = setTimeout(() => {
      try {
        server.closeAllConnections();
      } catch {
        /* Node 版本不支持则忽略，close 仍会兜底 */
      }
    }, 800);
    server.close(() => {
      clearTimeout(force);
      resolve_();
    });
  });
}
