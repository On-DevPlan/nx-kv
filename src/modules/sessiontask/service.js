// 实时任务输入 service —— 按「现状总结」分散的等待点（slot）+ 阻塞等待 + 内嵌弹窗。
//
// 解决的问题：agent 在一个对话里需要用户继续给任务时，不必结束本轮、等用户去
// 原始输入框打字，而是把 `nx-kv sessiontask wait --summary "<当前现状总结>"` 当作
// **本轮最后一个动作**调用——命令阻塞、自动打开浏览器弹窗；用户在弹窗/面板针对
// 该现状回填，命令解除阻塞、把新任务作为结果返回给 agent，agent 接着干。
//
// 关键设计：
//   1. **现状总结即 key。** wait 必须带一句当前现状总结；相同总结 → 同一个等待点，
//      不同总结 → 不同等待点，从而把答复「分散」到各现状下。面板总览每个等待点
//      都显示现状，用户一眼看清、分别回填。
//   2. **纯本地协调，不依赖 KV 后端登录态。** 数据落本机文件，弹窗由本进程临时
//      起的 http 服务器直出，未登录也能用。
//   3. **排队语义。** 用户可提前回填：等待点已有 pending 时 wait 立即取走、不开窗；
//      没有 pending 才开窗阻塞。
//   4. **超时是业务结果不是错误。** 默认阻塞 2 分钟；超时返回 {status:'timeout'}、
//      exit 0，agent 据此安静收尾结束本轮，绝不抛异常。
//
// 跨进程：弹窗与 wait 同进程时靠内存 waiter 即时唤醒；任务由别的进程写入（如常驻
// serve 的面板页）时，wait 用轮询兜底（见 POLL_MS）。
import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { APP_DIR } from '../../core/paths.js';
import { badInput } from '../../core/errors.js';
import { openBrowser } from '../../core/open.js';
import { renderPopupPage } from './popup.js';

export const DEFAULT_TIMEOUT_MS = 120_000; // 阻塞默认 2 分钟
const POLL_MS = 500; // 跨进程兜底轮询间隔
const MAX_SUMMARY = 200; // 现状总结长度上限

// ─── 存储位置：可环境变量覆盖（测试隔离） ───────────────────────────

export function storePath() {
  return process.env.NX_KV_SESSIONTASK_STORE || join(APP_DIR, 'sessiontasks.json');
}

// ─── 现状总结 → key ────────────────────────────────────────────────

// 归一化：折叠所有连续空白为单空格、去首尾；必填
export function normalizeSummary(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) throw badInput('缺少 --summary "<当前现状总结>"（作为等待点的 key）');
  if (s.length > MAX_SUMMARY) throw badInput(`--summary 过长（≤${MAX_SUMMARY} 字）`);
  return s;
}

// 相同现状 → 相同 key；不同现状 → 不同 key。展示仍用现状原文，key 仅作内部标识。
export function keyForSummary(summary) {
  return crypto.createHash('sha1').update(summary, 'utf8').digest('hex').slice(0, 16);
}

// ─── 时间 ───────────────────────────────────────────────────────────

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function stampNow(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// ─── 存储读写（原子写 + 损坏容忍 + v1 迁移） ───────────────────────

function emptyStore() {
  return { version: 2, slots: {} };
}

async function loadStore() {
  try {
    const raw = await fsp.readFile(storePath(), 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      if (data.slots && typeof data.slots === 'object') return { version: 2, slots: data.slots };
      // v1（sessions 桶）迁移为 slots，现状用旧 key 占位
      if (data.sessions && typeof data.sessions === 'object') {
        const slots = {};
        for (const [k, b] of Object.entries(data.sessions)) {
          slots[k] = {
            key: k,
            summary: k,
            createdAt: (b && b.createdAt) || stampNow(),
            updatedAt: stampNow(),
            waiting: false,
            waitingUntil: '',
            tasks: b && Array.isArray(b.tasks) ? b.tasks : [],
          };
        }
        return { version: 2, slots };
      }
    }
  } catch {
    /* 损坏/缺失 → 空 store */
  }
  return emptyStore();
}

async function saveStore(data) {
  const p = storePath();
  await fsp.mkdir(dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, p);
}

// 取（必要时新建）某个等待点
function slotOf(store, key, summary) {
  let s = store.slots[key];
  if (!s || !Array.isArray(s.tasks)) {
    s = {
      key,
      summary,
      createdAt: stampNow(),
      updatedAt: stampNow(),
      waiting: false,
      waitingUntil: '',
      tasks: [],
    };
    store.slots[key] = s;
  }
  if (summary) s.summary = summary; // 同一 key 下刷新现状措辞
  return s;
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
    createdAt: String(t.createdAt ?? ''),
    consumedAt: String(t.consumedAt ?? ''),
  };
}

function slotView(s) {
  const tasks = s.tasks.map(normalizeTask);
  return {
    key: s.key,
    summary: s.summary,
    waiting: !!s.waiting,
    waitingUntil: s.waitingUntil || '',
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    pending: tasks.filter((t) => t.status !== 'consumed').length,
    total: tasks.length,
    tasks,
  };
}

// ─── 进程内 waiter：key -> { resolve(task) } ───────────────────────

const waiters = new Map();

function markConsumed(task) {
  task.status = 'consumed';
  task.consumedAt = stampNow();
  return task;
}

// 取走该等待点第一条 pending；没有则返回 null
export async function consumeFirstPending(key) {
  const store = await loadStore();
  const s = store.slots[key];
  if (!s) return null;
  const task = s.tasks.find((t) => t.status !== 'consumed');
  if (!task) return null;
  markConsumed(task);
  s.updatedAt = stampNow();
  await saveStore(store);
  return normalizeTask(task);
}

// 在 store 里把某等待点置为等待/结束
async function setWaiting(key, summary, waiting, deadline) {
  const store = await loadStore();
  const s = slotOf(store, key, summary);
  s.waiting = waiting;
  s.waitingUntil = waiting && deadline ? stampNow(deadline) : '';
  s.updatedAt = stampNow();
  await saveStore(store);
}

// ─── CRUD ───────────────────────────────────────────────────────────

// 总览：返回全部等待点（面板据此分散展示与回填），按最近更新排序
export async function listTasks() {
  const store = await loadStore();
  const slots = Object.values(store.slots)
    .map(slotView)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { slots, waiting: slots.filter((s) => s.waiting).length };
}

export async function getTask({ summary: rawSummary, id } = {}) {
  const summary = normalizeSummary(rawSummary);
  const key = keyForSummary(summary);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  const store = await loadStore();
  const s = store.slots[key];
  const task = s && s.tasks.find((t) => Number(t.id) === want);
  if (!task) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`现状「${summary}」里没有 #${want} 任务`);
  }
  return normalizeTask(task);
}

/** 针对某现状回填任务。若本进程正有 wait 在等该 key → 直接投递并唤醒；否则排队。 */
export async function addTask({ summary: rawSummary, text } = {}) {
  const summary = normalizeSummary(rawSummary);
  const key = keyForSummary(summary);
  const body = String(text ?? '').trim();
  if (!body) throw badInput('任务内容不能为空');

  const store = await loadStore();
  const s = slotOf(store, key, summary);
  const task = normalizeTask({ id: nextTaskId(s.tasks), text: body, status: 'pending', createdAt: stampNow() });
  s.tasks.push(task);
  s.updatedAt = stampNow();

  const waiter = waiters.get(key);
  const delivered = !!waiter;
  if (waiter) {
    markConsumed(task);
    waiters.delete(key);
    s.waiting = false;
    s.waitingUntil = '';
  }

  await saveStore(store); // 先落盘再唤醒：wait 返回时数据必然一致
  if (waiter) waiter.resolve(normalizeTask(task));

  return { status: 'ok', key, summary, task: normalizeTask(task), delivered, queued: !delivered };
}

export async function updateTask({ summary: rawSummary, id, text } = {}) {
  const summary = normalizeSummary(rawSummary);
  const key = keyForSummary(summary);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');
  const body = String(text ?? '').trim();
  if (!body) throw badInput('--text 不能为空');

  const store = await loadStore();
  const s = store.slots[key];
  const task = s && s.tasks.find((t) => Number(t.id) === want);
  if (!task) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`现状「${summary}」里没有 #${want} 任务`);
  }
  task.text = body;
  s.updatedAt = stampNow();
  await saveStore(store);
  return { status: 'ok', key, summary, task: normalizeTask(task) };
}

export async function removeTask({ summary: rawSummary, id } = {}) {
  const summary = normalizeSummary(rawSummary);
  const key = keyForSummary(summary);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');

  const store = await loadStore();
  const s = store.slots[key];
  const index = s ? s.tasks.findIndex((t) => Number(t.id) === want) : -1;
  if (index < 0) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`现状「${summary}」里没有 #${want} 任务`);
  }
  const [removed] = s.tasks.splice(index, 1);
  s.updatedAt = stampNow();
  await saveStore(store);
  return { status: 'ok', key, summary, removed: normalizeTask(removed) };
}

// ─── 阻塞等待：核心入口 ─────────────────────────────────────────────

/**
 * 针对当前现状等待用户回填下一条任务。
 * @param {string}  summary   当前现状总结（必填，作为等待点 key）
 * @param {number}  timeoutMs 阻塞上限，默认 120000（2 分钟）
 * @param {boolean} open      是否自动打开浏览器弹窗（测试可关）
 * @param {function} onReady  服务器就绪回调 {addr,key,summary}（测试/集成钩子）
 */
export async function waitForTask({
  summary: rawSummary,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  open = true,
  onReady,
} = {}) {
  const summary = normalizeSummary(rawSummary);
  const key = keyForSummary(summary);
  let tmo = Number(timeoutMs);
  if (!Number.isFinite(tmo) || tmo <= 0) tmo = DEFAULT_TIMEOUT_MS;

  // 1. 等待点已有 pending → 立即取走，不开窗、不阻塞
  const queued = await consumeFirstPending(key);
  if (queued) return { status: 'ok', key, summary, task: queued, queued: true };

  // 2. 没有 pending → 起内嵌弹窗服务器
  const server = await startPopupServer(key, summary, tmo);
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
      .then((t) => {
        if (t) resolveOutcome({ kind: 'task', task: t, delivered: false });
      })
      .catch(() => {
        /* 瞬时读写错误，下一轮再试 */
      });
  }, POLL_MS);

  const timer = setTimeout(() => resolveOutcome({ kind: 'timeout' }), tmo);

  // 登记「等待中」（含截止时刻），面板/弹窗据此显示倒计时
  await setWaiting(key, summary, true, new Date(Date.now() + tmo));

  // waiter/轮询就位后再回调，保证 onReady 里立刻回填也能被接住
  if (typeof onReady === 'function') {
    try {
      await onReady({ addr, key, summary });
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
        ? { status: 'timeout', key, summary, timeoutMs: tmo }
        : { status: 'ok', key, summary, task: r.task, delivered: r.delivered, queued: false };
  } finally {
    clearInterval(poll);
    clearTimeout(timer);
    waiters.delete(key);
    await setWaiting(key, summary, false);
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

async function handlePopup(req, res, key, summary, timeoutMs) {
  const url = new URL(req.url, 'http://127.0.0.1/');
  const method = (req.method || 'GET').toUpperCase();

  try {
    if ((method === 'GET' || method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
      sendHtml(res, renderPopupPage({ key, summary, timeoutMs }));
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
      sendJson(res, 200, { ok: true, data: await addTask({ summary, text: body.text }) });
      return;
    }

    if (url.pathname === '/api/sessiontasks/item' && method === 'DELETE') {
      if (!originAllowed(req)) {
        sendJson(res, 403, { ok: false, error: '跨站请求被拒绝（弹窗仅接受本机来源）', code: 'BLOCKED' });
      } else {
        const body = await readBody(req);
        sendJson(res, 200, { ok: true, data: await removeTask({ summary, id: body.id }) });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: '不存在: ' + method + ' ' + url.pathname });
  } catch (err) {
    const code = err && err.code === 'INVALID_INPUT' ? 400 : err && err.code === 'NOT_FOUND' ? 404 : 500;
    sendJson(res, code, { ok: false, error: String((err && err.message) || err), code: err.code || 'INTERNAL' });
  }
}

function startPopupServer(key, summary, timeoutMs) {
  const server = http.createServer((req, res) => handlePopup(req, res, key, summary, timeoutMs));
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
