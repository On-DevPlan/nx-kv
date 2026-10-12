// 本地任务（localtask）service —— 按「工作目录（cwd）」划分的主题（topic）+ 主题任务队列 +
// 领取（含阻塞等待子功能）+ 内嵌弹窗。
//
// 解决的问题：agent 在一个对话里需要用户继续给任务时，不必结束本轮、等用户去
// 原始输入框打字，而是把 `nx-kv localtask wait --cwd "<工作目录>" --summary "<当前现状>"`
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
//   5. **超时是业务结果不是错误。** 默认阻塞 3 分钟（页面可调，上限 10 分钟）；超时返回 {status:'timeout'}、
//      exit 0，agent 据此安静收尾结束本轮，绝不抛异常。
//
// 跨进程：弹窗与 wait 同进程时靠内存 waiter 即时唤醒；任务由别的进程写入（如常驻
// serve 的面板页）时，wait 用轮询兜底（见 POLL_MS）。
import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIR, DEFAULT_PORT } from '../../core/paths.js';
import { badInput } from '../../core/errors.js';
import { openBrowser } from '../../core/open.js';

export const DEFAULT_TIMEOUT_MS = 180_000; // 阻塞默认 3 分钟（推荐值）
const POLL_MS = 500; // 跨进程兜底轮询间隔
export const DEFAULT_TIMEOUT_SEC = 180; // 推荐阻塞时长（3 分钟）
export const MAX_TIMEOUT_SEC = 600; // 阻塞时长上限（10 分钟）
export const MAX_SUMMARY = 2000; // 现状（状态）长度上限（原 200，已放宽）
export const MAX_TEXT = 20_000; // 单条任务内容长度上限

// wait 取任务返回时，在 task.text 末尾追加的「收尾指令」（可在面板/CLI 修改；置空关闭）。
// 作用：从每一条任务层面反复强调「计划最后再 wait 一次」，避免 agent 在长对话里漂移、漏调。
// 注意：命令名是 localtask 不是 sessiontask（v0.8.0 重命名后），但默认文案直接复用同一段文字。
export const DEFAULT_TASK_SUFFIX =
  '规划计划，然后完成这个任务；计划的最后一个动作，是再次调用 ' +
  'nx-kv localtask wait（带上 --cwd 当前工作目录、--summary 当前现状、--json）收尾本轮，' +
  '在拿到下一条任务或超时之前不要提前结束。';
const MAX_SUFFIX_LEN = 500; // 收尾追加语长度上限

// 归一化收尾追加语：缺省（旧 store 无此字段）→ 默认；显式传 ''（清空）→ '' 表示关闭。
// 注意：与 timeoutSec 不同——timeoutSec 缺省→推荐值（仍开启），taskSuffix 缺省→默认文本。
// 因此从老 store 读 settings.taskSuffix 时，clampTaskSuffix 会自动补默认；想"关闭"必须显式 ''。
export function clampTaskSuffix(v) {
  if (v === undefined || v === null) return DEFAULT_TASK_SUFFIX;
  let s = String(v).trim();
  if (s.length > MAX_SUFFIX_LEN) s = s.slice(0, MAX_SUFFIX_LEN);
  return s;
}

// ─── 存储位置：可环境变量覆盖（测试隔离）；旧名/旧文件自动兼容 ──────────

export function storePath() {
  return (
    process.env.NX_KV_LOCALTASK_STORE ||
    process.env.NX_KV_SESSIONTASK_STORE || // 改名前的环境变量，兼容既有脚本
    join(APP_DIR, 'localtasks.json')
  );
}

// 改名前的存储文件。显式覆盖（任一环境变量）时不迁移；新文件缺失时读它，
// 首次保存即落到新文件（旧文件保留不删，数据零丢失）。
function legacyStorePath() {
  if (process.env.NX_KV_LOCALTASK_STORE || process.env.NX_KV_SESSIONTASK_STORE) return null;
  return join(APP_DIR, 'sessiontasks.json');
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
  return {
    version: 4,
    settings: { timeoutSec: DEFAULT_TIMEOUT_SEC, taskSuffix: DEFAULT_TASK_SUFFIX },
    topics: {},
  };
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
    let raw;
    try {
      raw = await fsp.readFile(storePath(), 'utf8');
    } catch (err) {
      // 新文件不存在 → 尝试改名前的旧文件（一次性迁移读取；再缺失才落到空 store）
      const legacy = err && err.code === 'ENOENT' ? legacyStorePath() : null;
      if (!legacy) throw err;
      raw = await fsp.readFile(legacy, 'utf8');
    }
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
    settings: {
      timeoutSec: clampTimeoutSec(settings && settings.timeoutSec),
      // 旧 store 可能没存过 taskSuffix（v0.8.0 之前）；clampTaskSuffix 缺省→默认文本。
      // 显式 ''（关闭）会保留——判断条件是「字段存在且非 undefined」，不能只看 falsy。
      taskSuffix: settings && Object.prototype.hasOwnProperty.call(settings, 'taskSuffix')
        ? clampTaskSuffix(settings.taskSuffix)
        : DEFAULT_TASK_SUFFIX,
    },
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
    waitingSince: t.waitingSince || '',
    cancelRequested: !!t.cancelRequested,
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

// 在 store 里把某主题置为等待/结束，并刷新现状。
// waitingSince 是「等待起点」，面板据此显示「已等多久」——waitingUntil（截止时刻）
// 只能反推剩余，反推不出起点（超时值可被改写），所以两者都存。
async function setWaiting(key, cwd, summary, waiting, deadline) {
  const store = await loadStore();
  const t = topicOf(store, key, cwd);
  t.waiting = !!waiting;
  t.waitingUntil = waiting && deadline ? stampNow(deadline) : '';
  t.waitingSince = waiting ? stampNow() : '';
  // 新一轮等待不继承上一轮残留的「关闭」请求，否则刚进来就被立刻收尾
  t.cancelRequested = false;
  if (summary) t.summary = summary;
  t.updatedAt = stampNow();
  await saveStore(store);
}

// wait 结束复位：**仅当主题仍存在**时清等待态，绝不重建——主题可能已被 force 删除，
// 重建会让「删除主题」失效（曾在超时清理路径上把删掉的主题又建回来）。
async function clearWaiting(key) {
  const store = await loadStore();
  const t = store.topics[key];
  if (!t) return;
  t.waiting = false;
  t.waitingUntil = '';
  t.waitingSince = '';
  t.cancelRequested = false;
  t.updatedAt = stampNow();
  await saveStore(store);
}

/**
 * 用户在面板点「关闭」：关掉某主题的等待，让**阻塞中的 wait 立即收尾**。
 *
 * 只翻 store 里的 cancelRequested 标记——wait 端每 0.5s 轮询到就结束本轮（返回
 * status:"timeout" + cancelled:true，与超时同一条出口，agent 照常收尾）。
 * **不删主题、不删任务、不动队列**：等待可以取消，历史照留。
 *
 * @returns {{cancelled:boolean,key:string,name:string,cwd:string,reason?:string}}
 */
export async function cancelWait({ cwd: rawCwd, key: rawKey } = {}) {
  if (!rawKey && !rawCwd) {
    const { badInput } = await import('../../core/errors.js');
    throw badInput('需要 --cwd "<工作目录>" 或 --key "<主题key>"');
  }
  const key = resolveTopicKey({ key: rawKey, cwd: rawCwd });
  const store = await loadStore();
  const t = store.topics[key];
  if (!t || !t.waiting) {
    return { cancelled: false, key, name: (t && t.name) || '', cwd: (t && t.cwd) || '', reason: 'not_waiting' };
  }
  t.cancelRequested = true;
  t.updatedAt = stampNow();
  await saveStore(store);
  return { cancelled: true, key, name: t.name, cwd: t.cwd };
}

// wait 端轮询：该主题是否被请求关闭；取到即清标记（只生效一次）。
async function consumeCancelRequest(key) {
  const store = await loadStore();
  const t = store.topics[key];
  if (!t || !t.cancelRequested) return false;
  t.cancelRequested = false;
  t.updatedAt = stampNow();
  await saveStore(store);
  return true;
}

// ─── CRUD ───────────────────────────────────────────────────────────

function settingsView(s) {
  return {
    timeoutSec: clampTimeoutSec(s && s.timeoutSec),
    recommendedSec: DEFAULT_TIMEOUT_SEC,
    maxSec: MAX_TIMEOUT_SEC,
    // wait 交付任务时追加到 task.text 末尾的收尾提醒；''=关闭；defaultTaskSuffix 供 UI 恢复默认
    taskSuffix: clampTaskSuffix(s && s.taskSuffix),
    defaultTaskSuffix: DEFAULT_TASK_SUFFIX,
    suffixEnabled: !!clampTaskSuffix(s && s.taskSuffix),
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

// 配置等待超时 / 任务收尾追加语（页面可调）。超时推荐 180=3 分钟、最大 600=10 分钟；
// taskSuffix 为 wait 返回任务时追加到 task.text 末尾的固定指令，传 '' 关闭、不传保持不变。
export async function updateSettings({ timeoutSec, taskSuffix } = {}) {
  const hasTimeout = timeoutSec !== undefined && timeoutSec !== null;
  const hasSuffix = taskSuffix !== undefined;
  if (!hasTimeout && !hasSuffix) {
    throw badInput(
      '请至少指定一项：--timeout <秒>，或 --suffix "<收尾追加语>"（--no-suffix 关闭追加、--reset-suffix 恢复默认）'
    );
  }
  const store = await loadStore();
  const next = { ...store.settings };
  if (hasTimeout) {
    const n = Number(timeoutSec);
    if (!Number.isFinite(n) || n <= 0) {
      throw badInput(`超时时间需为 1-${MAX_TIMEOUT_SEC} 秒（推荐 ${DEFAULT_TIMEOUT_SEC}）`);
    }
    next.timeoutSec = clampTimeoutSec(n);
  }
  if (hasSuffix) next.taskSuffix = clampTaskSuffix(taskSuffix);
  store.settings = next;
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

// ─── 主题删除（单个 / 批量） ───────────────────────────────────────

// 定位主题 key：显式 --key 优先，否则按工作目录（目录名）推导
function resolveTopicKey({ key: rawKey, cwd: rawCwd }) {
  if (rawKey && String(rawKey).trim()) return String(rawKey).trim();
  return normalizeCwd(rawCwd).key;
}

// 删除整个主题（连同其全部任务）。默认拒绝删除「等待中」主题——那会让正阻塞的
// agent 只能等到超时；force=true 才强删（agent 随后超时收尾）。
export async function removeTopic({ cwd: rawCwd, key: rawKey, force = false } = {}) {
  if (!rawKey && !rawCwd) {
    throw badInput('需要 --cwd "<工作目录>" 或 --key "<主题key>"');
  }
  const key = resolveTopicKey({ key: rawKey, cwd: rawCwd });
  const store = await loadStore();
  const t = store.topics[key];
  if (!t) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题不存在（key ${key}）`);
  }
  if (t.waiting && !force) {
    throw badInput('主题正在等待中，不能删除（确认要删请加 --force，agent 将超时收尾）');
  }
  const view = topicView(t);
  delete store.topics[key];
  await saveStore(store);
  return { status: 'removed', key, name: t.name, cwd: t.cwd, topic: view };
}

// 批量删除主题：keys / cwds（数组，可并用），或 all=true 清空全部。
// 默认把「等待中」「不存在」计入 skipped 而不删；force=true 连等待中一起删。
export async function removeTopics({ keys, cwds, all = false, force = false } = {}) {
  const hasList = (a) => Array.isArray(a) && a.some((x) => String(x).trim());
  if (!all && !hasList(keys) && !hasList(cwds)) {
    throw badInput('需要 --keys "<key,key>" 或 --cwds "<目录,目录>"，或 --all');
  }

  const store = await loadStore();
  let targets;
  if (all) {
    targets = Object.keys(store.topics);
  } else {
    const list = [];
    if (Array.isArray(keys)) list.push(...keys.map((x) => String(x).trim()).filter(Boolean));
    if (Array.isArray(cwds)) {
      for (const c of cwds) if (String(c).trim()) list.push(normalizeCwd(c).key);
    }
    targets = [...new Set(list)];
  }

  const removed = [];
  const skipped = [];
  for (const key of targets) {
    const t = store.topics[key];
    if (!t) {
      skipped.push({ key, reason: 'not_found' });
      continue;
    }
    if (t.waiting && !force) {
      skipped.push({ key, name: t.name, cwd: t.cwd, reason: 'waiting' });
      continue;
    }
    removed.push({ key, name: t.name, cwd: t.cwd });
    delete store.topics[key];
  }
  if (removed.length) await saveStore(store);
  return { status: 'ok', all: !!all, count: removed.length, removed, skipped };
}

// 调整**待领取**任务的优先级：把 #id 移动到 #beforeId 之前或 #afterId 之后。
// 领取顺序 = tasks 数组里 pending 子序列的先后（consumeFirstPending 取第一条 pending），
// 故只在 pending 之间换位；已领取（历史）任务固定、不可移动。
export async function reorderTasks({ cwd: rawCwd, id, beforeId, afterId } = {}) {
  const { key, cwd } = normalizeCwd(rawCwd);
  const dragId = Number(id);
  const hasBefore = beforeId !== undefined && beforeId !== null;
  const hasAfter = afterId !== undefined && afterId !== null;

  if (!Number.isFinite(dragId) || dragId <= 0) {
    throw badInput('reorder 缺少 --id <要移动的任务编号>');
  }
  if (hasBefore === hasAfter) {
    throw badInput('reorder 需且仅需 --before <编号> 或 --after <编号> 之一');
  }
  const targetId = Number(hasBefore ? beforeId : afterId);
  if (!Number.isFinite(targetId) || targetId <= 0) {
    throw badInput('reorder 的目标任务编号非法');
  }
  if (targetId === dragId) throw badInput('不能把任务移动到它自己旁边');

  const store = await loadStore();
  const t = store.topics[key];
  if (!t) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${cwd}」不存在`);
  }
  const drag = t.tasks.find((x) => Number(x.id) === dragId);
  const target = t.tasks.find((x) => Number(x.id) === targetId);
  if (!drag || !target) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(
      `主题「${t.name}」里找不到任务 #${drag ? targetId : dragId}`
    );
  }
  if (drag.status === 'consumed' || target.status === 'consumed') {
    throw badInput('只有「待领取」任务可以调整优先级（已领取任务是固定历史）');
  }

  const from = t.tasks.indexOf(drag);
  t.tasks.splice(from, 1);
  const ti = t.tasks.indexOf(target); // 删除 drag 后目标下标自动修正
  t.tasks.splice(hasBefore ? ti : ti + 1, 0, drag);
  t.updatedAt = stampNow();

  await saveStore(store);
  return { status: 'ok', key, cwd, name: t.name, topic: topicView(t) };
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
  const startStore = await loadStore();
  let sec;
  if (timeoutSec !== undefined && timeoutSec !== null) sec = timeoutSec;
  else if (timeoutMs !== undefined && timeoutMs !== null) sec = Number(timeoutMs) / 1000;
  else sec = startStore.settings.timeoutSec;
  const tmo = clampTimeoutSec(sec) * 1000;
  const suffix = startStore.settings.taskSuffix; // 返回任务时追加的收尾指令（本轮固定）

  // 1. 主题队列已有 pending → 立即取走，不开窗、不阻塞；记录本轮完成总结
  const queued = await consumeFirstPending(key, summary);
  if (queued) {
    return { status: 'ok', key, cwd, name, summary, task: withTaskSuffix(queued, suffix), queued: true };
  }

  // 2. 没有 pending → 复用常驻主面板（不再起随机端口临时弹窗）：
  //    a) 确保主面板在跑（不存在就 detached 拉起 serve --no-open --auto-exit）；
  //    b) 探测活动 SSE 连接：有活标签就不开新页（避免 Edge 重复开标签）；
  //                没活标签就 openBrowser 深链到当前主题。
  //    失败只降级为纯阻塞——绝不抛错中断 wait。
  //    --no-open 模式（冒烟/CI）不发起任何面板相关动作：不开浏览器、不拉起 serve、不开 SSE。
  //    这样可避免在测试里 spawn 出一堆孤儿进程占着 7877 端口。
  const panelInfo = open ? await ensureMainPanel() : { running: false, started: false, url: '' };
  const presence = panelInfo.running ? await probePresence() : 0;
  const deepLink = deepLinkUrl(key, cwd);

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

  // 关闭轮询：用户在面板点了「关闭」→ 立即收尾本轮（走与超时同一条出口，只多带 cancelled 标记，
  // agent 不必认识新状态，照常结束本轮）。
  const cancelPoll = setInterval(() => {
    consumeCancelRequest(key)
      .then((yes) => {
        if (yes) resolveOutcome({ kind: 'cancelled' });
      })
      .catch(() => {});
  }, POLL_MS);

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
  if (openPage) openBrowser(deepLink);

  // 周期复查：等待期间每 5s 查一次活动标签；万一开始时判错（页面被关），20s 冷却内重开。
  // 不到点不开新页（节流，避免「标签被关 → 立刻开 → 立刻关」抖动）。
  const REVIEW_MS = 5_000;
  const REOPEN_COOLDOWN_MS = 20_000;
  let lastReopenAt = 0;
  const review = setInterval(async () => {
    if (!panelInfo.running || !open) return;
    const n = await probePresence().catch(() => 0);
    if (n > 0) return; // 有活标签，不动
    const now = Date.now();
    if (now - lastReopenAt < REOPEN_COOLDOWN_MS) return; // 冷却中
    lastReopenAt = now;
    openBrowser(deepLink);
  }, REVIEW_MS);
  review.unref?.();

  let result;
  try {
    const r = await outcome;
    result =
      r.kind === 'timeout'
        ? { status: 'timeout', key, cwd, summary, timeoutMs: tmo }
        : r.kind === 'cancelled'
        ? { status: 'timeout', key, cwd, summary, timeoutMs: tmo, cancelled: true }
        : { status: 'ok', key, cwd, name, summary, task: withTaskSuffix(r.task, suffix), delivered: r.delivered, queued: false };
  } finally {
    clearInterval(poll);
    clearInterval(cancelPoll);
    clearInterval(review);
    clearTimeout(timer);
    waiters.delete(key);
    await clearWaiting(key);
  }
  return result;
}

// ─── 面板空闲自释放所需的观测接口（panel-guard.js 调用）────────────

// 当前有多少主题「真的在等待」——常驻面板的空闲自释放据此否决退出：
// 有 agent 正阻塞等人时，面板是唯一提醒来源，绝不能在此时释放。
//
// waiting 标志由 wait 进程写入、结束复位，跨进程可见；但 wait 被强杀（SIGKILL）时
// 标志会残留。所以再过一道「截止时刻」：waitingUntil 已过期视为不在等待——那一刻
// wait 本来也要收尾了，不会误伤正常等待。
export async function countWaitingTopics() {
  const store = await loadStore();
  const now = Date.now();
  let n = 0;
  for (const t of Object.values(store.topics)) {
    if (!t || !t.waiting) continue;
    const until = parseStampMs(t.waitingUntil);
    if (Number.isFinite(until) && until <= now) continue; // 残留标志：截止时刻已过
    n += 1;
  }
  return n;
}

// "YYYY-MM-DD HH:mm:ss"（本地）→ epoch ms；无法解析返回 NaN
function parseStampMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
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
export function panelPresence() {
  const now = Date.now();
  let clients = 0;
  for (const conn of sseConns) {
    if (now - conn.lastOkWrite <= SSE_LIVE_WINDOW_MS) clients += 1;
  }
  return { clients, total: sseConns.size };
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

// 「主面板就绪」=端口上有可响应的服务。
// 这与 /api/ping 不同：ping 是面板壳层每 15s 主动上报「有页面开着」，
// 这里只问「端口上有没有人接 HTTP」——用于决定是否要拉起 serve。
async function probePanelReady(timeoutMs = 900) {
  const url = `${panelBaseUrl()}/api/ping`;
  return new Promise((resolve_) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
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

// 「活动 SSE 连接数」= 主面板上当前正打开的「实时任务」标签数。
// 用于 wait 决策：已有活标签就不重开页面，让那个标签响铃/打角标/弹通知；
// 没有活标签时再 openBrowser 新开深链标签。
//
// 任何失败/旧版无此端点都按 0 处理（保守地开一次页），绝不因探测失败而阻塞 wait。
async function probePresence(timeoutMs = 900) {
  const url = `${panelBaseUrl()}/api/localtasks/presence`;
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
          resolve_(Math.max(0, Number(d && d.clients) || 0));
        } catch {
          resolve_(0);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve_(0);
    });
    req.on('error', () => resolve_(0));
  });
}

function panelBaseUrl() {
  return `http://127.0.0.1:${DEFAULT_PORT}`;
}

// 深链到主面板「实时任务」页并选中当前主题（key 优先，cwd 兜底）。
function deepLinkUrl(key, cwd) {
  return `${panelBaseUrl()}/#/localtask?key=${encodeURIComponent(key)}&cwd=${encodeURIComponent(cwd)}`;
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
  const url = panelBaseUrl() + '/';
  if (await probePanelReady()) return { running: true, started: false, url };

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
    return { running: false, started: false, url };
  }

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    if (await probePanelReady(700)) return { running: true, started: true, url };
  }
  return { running: false, started: true, url };
}

// ─── 等待生命周期事件流（主面板及时通知，避免用户漏过超时）────────────
//
// wait 与常驻主面板通常是两个进程，内存 EventEmitter 跨不过进程，所以事件流
// 不依赖进程内回调，而是轮询 store，从 waiting/waitingUntil 与「已领取数」的变化里
// 派生事件：waiting / reminder（剩余 30s、10s）/ resolved（delivered 或 timeout）。
// HTTP(SSE) 与 CLI(NDJSON) 共用本生成器。

const EVENT_POLL_MS = 500;
const REMINDER_SEC = [30, 10]; // 剩余 ≤30s、≤10s 各提醒一次

// 纯函数：给定剩余秒数与已提醒过的阈值，返回本次应触发的阈值（秒）。便于单测。
export function remindersDue(remainSec, firedSet) {
  const out = [];
  for (const sec of REMINDER_SEC) {
    if (remainSec <= sec && remainSec > 0 && !firedSet.has(sec)) out.push(sec);
  }
  return out;
}

function consumedCount(t) {
  return (Array.isArray(t.tasks) ? t.tasks : []).filter((x) => x.status === 'consumed').length;
}

/**
 * 订阅等待生命周期事件（异步生成器）。
 * @param {{cwd?:string,key?:string,pollMs?:number,signal?:AbortSignal}} opts
 *   不传 cwd/key 则订阅全部主题（主面板总览需要）。
 */
export async function* watchEvents({ cwd: rawCwd, key: rawKey, pollMs = EVENT_POLL_MS, signal } = {}) {
  let onlyKey = null;
  if (rawKey && String(rawKey).trim()) onlyKey = String(rawKey).trim();
  else if (rawCwd && String(rawCwd).trim()) onlyKey = normalizeCwd(rawCwd).key;

  const sleep = (ms) =>
    new Promise((res) => {
      const to = setTimeout(res, ms);
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(to);
            res();
          },
          { once: true }
        );
      }
    });

  const state = new Map();
  let first = true;
  while (!(signal && signal.aborted)) {
    let topics = [];
    try {
      const store = await loadStore();
      topics = Object.values(store.topics).filter(
        (t) => Array.isArray(t.tasks) && (!onlyKey || t.key === onlyKey)
      );
    } catch {
      topics = [];
    }

    const now = Date.now();
    for (const t of topics) {
      const deadline = parseStampMs(t.waitingUntil);
      const isWaiting = !!t.waiting && Number.isFinite(deadline) && deadline > now;
      let st = state.get(t.key);

      if (isWaiting) {
        if (!st || st.phase !== 'waiting' || st.waitingUntil !== t.waitingUntil) {
          st = {
            phase: 'waiting',
            waitingUntil: t.waitingUntil,
            deadline,
            consumed0: consumedCount(t),
            reminders: new Set(),
          };
          state.set(t.key, st);
          yield {
            type: 'waiting',
            key: t.key,
            cwd: t.cwd || '',
            name: t.name || '',
            summary: t.summary || '',
            waitingUntil: t.waitingUntil,
            remainMs: Math.max(0, deadline - now),
            replay: first,
          };
        }
        const remainSec = Math.floor((st.deadline - now) / 1000);
        for (const sec of remindersDue(remainSec, st.reminders)) {
          st.reminders.add(sec);
          yield {
            type: 'reminder',
            key: t.key,
            cwd: t.cwd || '',
            name: t.name || '',
            summary: t.summary || '',
            waitingUntil: t.waitingUntil,
            remainSec: sec,
            remainMs: Math.max(0, st.deadline - now),
            label: `${sec}s`,
          };
        }
      } else if (st && st.phase === 'waiting') {
        const outcome = consumedCount(t) > st.consumed0 ? 'delivered' : 'timeout';
        state.set(t.key, { phase: 'ended' });
        yield { type: 'resolved', key: t.key, cwd: t.cwd || '', name: t.name || '', outcome };
      } else if (!st) {
        state.set(t.key, { phase: 'idle' });
      }

      // 兜底：waiting 标志还在但截止已过（wait 进程异常退出），也派生一次 timeout
      if (t.waiting && (!Number.isFinite(deadline) || deadline <= now)) {
        const cur = state.get(t.key);
        if (!cur || cur.phase === 'waiting') {
          state.set(t.key, { phase: 'ended' });
          yield {
            type: 'resolved',
            key: t.key,
            cwd: t.cwd || '',
            name: t.name || '',
            outcome: 'timeout',
            stale: true,
          };
        }
      }
    }

    first = false;
    await sleep(pollMs);
  }
}

// HTTP 传输：SSE。注册到 sseConns 让 panelPresence 计入（wait 据此判活标签）。
// 客户端断开即中止生成器。SSE 心跳由 addEventStreamConn 统一管。
export async function streamEventsSSE(req, res, { cwd, key } = {}) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  // addEventStreamConn 内部已把 conn 加入 sseConns（panelPresence 据此统计活标签），
  // 我们不再直接引用——心跳 / 失败剔除 / 断开清理都由它托管。
  addEventStreamConn(req, res);
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  try {
    for await (const ev of watchEvents({ cwd, key, signal: ac.signal })) {
      res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    }
  } catch {
    /* 客户端断开 / 瞬时读盘错误，静默结束 */
  }
}
