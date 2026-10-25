// timegoal 模块 service —— 固化"持续运行 N 小时"任务的时间运算与全局提示词回显。
//
// 设计要点（与 localtask 严格分离）：
//   1. **独立 store**：`~/.nx-kv/timegoals.json`，不读 localtasks.json、不动
//      localtask 的 waiting / tasks / roundSummary。两套并行存储、两套并行循环链路。
//   2. **每 cwd 一对一**：用与 localtask 一致的"目录名 → 16 位 hex key"算法
//      让一个 topic（目录）最多绑定一个 timegoal；set 时已有则覆盖并标 `replaced`。
//   3. **不可变 prompt**：set 写进 store 之后，prompt 字段变成只读事实。
//      后续 `check` 永远从 store 原文回显，不让 agent 改 prompt 或从对话历史里
//      重新拼接——这是"避免偏移"的物理保证。
//   4. **纯函数时间运算**：`evalTimegoal(goal, nowMs)` 不读时钟，单测钉各种边界
//      （到点前/临门/到点整/过线）；`checkTimegoal` 调它前才 `Date.now()`。
//
// 模块边界：
//   - 不依赖 localtask 的 service；本文件里 3 个辅助函数（topicKeyFor /
//     stampNow / parseStampMs）都是 4-6 行的纯工具，本地复制避免跨模块耦合。
//   - 与 localtask wait 互不感知：timegoal 不阻塞、不依赖面板是否存在，
//     agent 按 `reached` 自行决定下一轮动作。
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { APP_DIR } from '../../core/paths.js';
import { badInput } from '../../core/errors.js';

export const MIN_DURATION_SEC = 60; // 最小 1 分钟（避免误设 0 立即到点）
// 上限从「24 小时」放宽到「365 天」。真实场景里"跑一晚上""连续优化几天"是常态，
// 24 小时上限逼着用户去改代码而不是改配置——这正是"从真实角度"最刺手的一处。
export const MAX_DURATION_SEC = 365 * 24 * 3600; // 365 天
export const MAX_PROMPT = 20_000; // prompt 长度上限（与 localtask MAX_TEXT 同档）
export const MAX_LOG_ENTRIES = 200; // 每个 goal 保留的最近检查条数（日志不无限膨胀）
export const ARCHIVE_RETENTION_SEC = 7 * 24 * 3600; // 到点自动归档后保留多久再丢弃日志

// 保留期可用环境变量覆盖（NX_KV_TIMEGOAL_RETENTION_SEC）。
// 默认 7 天：按"消费方轮询间隔 × 安全系数"取——agent 每轮 check 一次，
// 7 天意味着机器关机一周回来仍能读到提示词原文。
export function archiveRetentionSec() {
  const raw = process.env.NX_KV_TIMEGOAL_RETENTION_SEC;
  if (raw === undefined || raw === null || String(raw).trim() === '') return ARCHIVE_RETENTION_SEC;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return ARCHIVE_RETENTION_SEC;
  return Math.floor(n);
}

// ─── 时间字符串工具（与 localtask 对齐的格式）─────────────────────────

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function stampNow(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// "YYYY-MM-DD HH:mm:ss" → epoch ms；无法解析返回 NaN
function parseStampMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

// ─── cwd → 主题 key（与 localtask 一致：Windows 折叠大小写）───────────

export function topicKeyFor(name) {
  const fold = process.platform === 'win32' ? String(name).toLowerCase() : String(name);
  return crypto.createHash('sha1').update(fold, 'utf8').digest('hex').slice(0, 16);
}

// 归一化工作目录：trim → resolve → 用目录名做 key。注意：与 localtask normalizeCwd
// 行为一致但内部不依赖 localtask 模块（独立 store 边界）。
function normalizeCwd(raw) {
  const trimmed = raw && String(raw).trim() ? String(raw).trim() : '';
  const cwd = trimmed ? resolve(trimmed) : process.cwd();
  const name = basename(cwd);
  return { cwd, name, key: topicKeyFor(name) };
}

// ─── 存储（NX_KV_TIMEGOAL_STORE 可覆盖；测试隔离）─────────────────────

export function storePath() {
  return process.env.NX_KV_TIMEGOAL_STORE || join(APP_DIR, 'timegoals.json');
}

function emptyStore() {
  return { version: 1, goals: {} };
}

async function loadStore() {
  let goals = null;
  try {
    const raw = await fsp.readFile(storePath(), 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && data.goals && typeof data.goals === 'object') {
      goals = data.goals;
    }
  } catch {
    /* 缺失或损坏 → 空 store */
  }
  if (!goals) return emptyStore();
  return { version: 1, goals };
}

// 原子写 + 进程内串行化队列；与 localtask service 同模式（Windows 锁偶发 EPERM 重试）。
let saveQueue = Promise.resolve();
function saveStore(data) {
  const run = saveQueue.then(async () => {
    const p = storePath();
    await fsp.mkdir(dirname(p), { recursive: true });
    const tmp = p + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    for (let i = 0; ; i++) {
      try {
        await fsp.rename(tmp, p);
        return;
      } catch (err) {
        if (i >= 4 || (err.code !== 'EPERM' && err.code !== 'EACCES')) throw err;
        await new Promise((r) => setTimeout(r, 25 * (i + 1)));
      }
    }
  });
  saveQueue = run.catch(() => {});
  return run;
}

function goalView(g, { withPrompt = true } = {}) {
  const view = {
    key: g.key,
    cwd: g.cwd,
    name: g.name,
    durationSec: g.durationSec,
    startedAt: g.startedAt,
    deadline: g.deadline,
    // 归档态：到点自动归档。归档后**不再出现在活动列表/看板**，
    // 但仍可被 show/check 查到（agent 最后一轮 check 照样拿到 reached:true + prompt 原文）。
    archived: !!g.archived,
    archivedAt: g.archivedAt || '',
    // 保留期已过：日志被丢弃，**提示词原文仍在**（见 autoRecycle 的说明）。
    purged: !!g.purged,
    purgedAt: g.purgedAt || '',
    logCount: Array.isArray(g.log) ? g.log.length : 0,
    // 总轮次与是否截断：让"只保留最近 200 条"是**可见的**，而不是静默丢历史。
    totalChecks: Number(g.totalChecks) || (Array.isArray(g.log) ? g.log.length : 0),
    logTruncated: !!g.logTruncated,
  };
  if (withPrompt) {
    view.prompt = g.prompt;
  } else if (g.prompt) {
    // 列表不吐完整 prompt：归档区 N 个目标就是 N×20KB，面板每 1.5s 拉一次会白烧带宽。
    // 只给一小段预览；要看全文用 timegoal show（按 cwd 取单个目标）。
    view.promptPreview = g.prompt.length > 120 ? g.prompt.slice(0, 120) + '…' : g.prompt;
  }
  return view;
}

// ─── 输入校验 ──────────────────────────────────────────────────────────

// ─── 时长解析：纯秒数 或 人类单位（5h / 90m / 2d / 5小时）──────────────
//
// 「5 小时」是用户脑子里真实的说法；逼他换算成 18000 秒是本末倒置。
// 纯数字仍然按秒解释（向后兼容：--duration 10800 照旧工作）。
const DURATION_UNITS = {
  ms: 0.001, 毫秒: 0.001,
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1, 秒: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60, 分钟: 60, 分: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, 小时: 3600, 时: 3600,
  d: 86400, day: 86400, days: 86400, 天: 86400,
};
export const DURATION_UNIT_HINT = '10800（秒）/ 5h / 90m / 2d / 5小时';

/**
 * 把用户写的时长解析成整数秒。
 * 纯数字 → 秒；带单位 → 单位换算；其它 → 报错（绝不猜）。
 */
export function parseDuration(raw) {
  if (raw === undefined || raw === null || raw === '') {
    throw badInput(`需要 --duration <时长>（${DURATION_UNIT_HINT}）`);
  }
  if (typeof raw === 'number') return clampDuration(raw);
  const s = String(raw).trim().toLowerCase();
  if (!s) throw badInput(`需要 --duration <时长>（${DURATION_UNIT_HINT}）`);
  // 纯数字 → 秒
  if (/^\d+(\.\d+)?$/.test(s)) return clampDuration(Math.floor(Number(s)));
  const m = /^(\d+(?:\.\d+)?)\s*(.+)$/.exec(s);
  if (!m) throw badInput(`无法解析时长「${raw}」——请用 ${DURATION_UNIT_HINT}`);
  const unit = m[2].trim();
  const mult = DURATION_UNITS[unit];
  if (!mult) throw badInput(`无法识别的时长单位「${unit}」——请用 ${DURATION_UNIT_HINT}`);
  return clampDuration(Math.floor(Number(m[1]) * mult));
}

function clampDuration(n) {
  if (!Number.isFinite(n)) {
    throw badInput(`--duration 必须是整数秒或带单位（${DURATION_UNIT_HINT}），收到: ${n}`);
  }
  const i = Math.floor(Number(n));
  if (i < MIN_DURATION_SEC) {
    throw badInput(`--duration 至少 ${MIN_DURATION_SEC} 秒（避免手滑设 0 立即到点）`);
  }
  if (i > MAX_DURATION_SEC) {
    throw badInput(`--duration 超过上限 ${MAX_DURATION_SEC} 秒（365 天）`);
  }
  return i;
}

function normalizePrompt(raw) {
  const body = String(raw ?? '').trim();
  if (!body) throw badInput('--prompt 不能为空');
  if (body.length > MAX_PROMPT) {
    throw badInput(`--prompt 过长（≤${MAX_PROMPT} 字，当前 ${body.length} 字）`);
  }
  return body;
}

// ─── 纯函数：给定 goal 与 nowMs，算 reached / elapsed / remaining ────────
// 抽出来便于单测钉边界（不依赖系统时钟）。
export function evalTimegoal(goal, nowMs) {
  if (!goal) {
    return { hasGoal: false, reached: false, elapsedSec: 0, remainingSec: 0, overtimeSec: 0 };
  }
  const startMs = parseStampMs(goal.startedAt);
  const deadlineMs = parseStampMs(goal.deadline);
  if (!Number.isFinite(startMs) || !Number.isFinite(deadlineMs)) {
    // 数据损坏：start/ deadline 必须能解析；保守地算到点（避免 agent 误认为没到）
    return { hasGoal: true, reached: true, elapsedSec: 0, remainingSec: 0, overtimeSec: 0 };
  }
  const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const remainingSec = Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  const reached = nowMs >= deadlineMs;
  // 超时多久：到点之后这个数继续涨——「已到点」不再是一个静止的标签，
  // 而是"已经超时 2 小时 13 分"这样能看出严重程度的量。
  const overtimeSec = reached ? Math.max(0, Math.floor((nowMs - deadlineMs) / 1000)) : 0;
  return { hasGoal: true, reached, elapsedSec, remainingSec, overtimeSec };
}

// ─── 自动回收（到点自动归档 + 保留期后自动失效）──────────────────────
//
// 原来的痛点：到点的目标永远挂着，得手动点一次「回收已到点」——设得越多堆得越久
// （真实 store 里就躺着 4 个早已过期的目标）。
//
// 这里的设计是**先归档、再自动失效**，两段各自有理由：
//
//   1. deadline 已过 → 标记 archived（不再出现在活动列表 / 看板 / 面板）。
//      **面板上彻底不再显示**——一个已经结束的目标不该占着用户的界面。
//   2. 归档超过保留期（默认 7 天）→ **整条删掉**（连提示词原文一起）。
//      到这一步它就"自动失效"了：不需要任何人再去点一次「彻底清除」。
//
// 第 1 段为什么要留着（而不是到点即删）：agent 最后一轮 check 必须仍能拿到
// reached:true + prompt 原文，才能写完最终总结停手。到点即删会砸掉这个契约。
// 保留期给了 agent 足够的收尾窗口（最后一轮就在到点后几分钟内发生）。
//
// ⚠️ 契约变更（用户明确选择"面板层失效 + 到期自动清"）：早期版本在保留期后
// **只丢日志、提示词永久保留**（防的是"机器关机一周回来读不到根指令"）。
// 现在改成整条删掉：到期即自动失效。保留期可用 NX_KV_TIMEGOAL_RETENTION_SEC 调整；
// 想让"关机很久后仍能读到"就把这个值调大（调 0 = 到点即失效，但那样最后一轮
// 就可能读不到提示词了）。
const ARCHIVE_RETENTION_MS = () => archiveRetentionSec() * 1000;

function autoRecycle(store, nowMs) {
  let changed = false;
  const retentionMs = ARCHIVE_RETENTION_MS();
  for (const g of Object.values(store.goals)) {
    if (!g) continue;
    if (!g.archived && evalTimegoal(g, nowMs).reached) {
      g.archived = true;
      g.archivedAt = g.archivedAt || stampNow(new Date(nowMs));
      changed = true;
    }
    if (g.archived && !g.purged) {
      // 保留期从 deadline 起算（而不是从"归档那一刻"）：它是可推导的，
      // 不依赖是否有人读过这个目标。
      const deadlineMs = parseStampMs(g.deadline);
      const base = Number.isFinite(deadlineMs) ? deadlineMs : nowMs;
      if (nowMs - base >= retentionMs) {
        // 保留期到 → **自动失效**：整条删掉（提示词原文一起）。
        // 不再需要人工点「彻底清除」——到期就自己没了。
        delete store.goals[g.key];
        changed = true;
      }
    }
  }
  return changed;
}

// 读 store 并顺手回收（到点归档 / 超期丢日志）。
//
// ⚠️ **读路径刻意不落盘**：写盘意味着"一次 list"会触发整文件覆写，
// 而 saveStore 只在**单进程内**串行——面板每 1.5s 拉一次 list，与并发的
// CLI check 互相覆盖是真实风险。归档状态本身可从 deadline 推导，不需要持久化
// 才正确；真正会写盘的路径（check/set/update）会顺手把它落盘。
async function loadRecycledStore({ persist = false } = {}) {
  const store = await loadStore();
  if (autoRecycle(store, Date.now()) && persist) await saveStore(store);
  return store;
}

/**
 * 只读探针：这个 key 上的时间目标**到点了吗**。
 *
 * 存在的理由：localtask 的 wait 是阻塞的，默认要等满自己的超时（最多 10 分钟）。
 * 但如果这个目录挂着时间目标，预算到点这一局就该结束了 —— agent 不该在预算外
 * 继续空等。wait 每轮轮询问一次这个探针，到点就立刻收尾（与用户点「关闭等待」
 * 同一条出口：status:"timeout" + cancelled:true）。
 *
 * 刻意**不写盘、不归档**：读路径写盘意味着"一次探针"会触发整文件覆写（见上面
 * loadRecycledStore 的警告）。到点归档由真正的读写路径负责，探针只回答"到没到点"。
 *
 * @returns {Promise<null | {key,name,cwd,deadline,reached}>} 没有目标 → null
 */
export async function probeGoalExpiry(key) {
  if (!key) return null;
  const store = await loadStore();
  const g = store.goals[key];
  if (!g) return null;
  return {
    key,
    name: g.name || '',
    cwd: g.cwd || '',
    deadline: g.deadline || '',
    deadlineMs: parseStampMs(g.deadline),
    reached: evalTimegoal(g, Date.now()).reached,
  };
}

// ─── CRUD 风格命令（与 localtask 思路一致但命令族更窄）────────────────

/**
 * 设置本目录的 timegoal；已存在则覆盖并标 `replaced:true`。
 */
export async function setTimegoal({ cwd: rawCwd, durationSec: rawDur, prompt: rawPrompt } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const durationSec = parseDuration(rawDur);
  const prompt = normalizePrompt(rawPrompt);
  const { cwd, name, key } = normalizeCwd(rawCwd);

  // 写路径顺手清扫（Redis 式的"主动回收"那一半）：长期没人读时 store 也不会一直堆着
  const store = await loadRecycledStore({ persist: true });
  const replaced = !!store.goals[key];

  const startMs = Date.now();
  const deadlineMs = startMs + durationSec * 1000;
  const goal = {
    key,
    cwd,
    name,
    durationSec,
    prompt,
    startedAt: stampNow(new Date(startMs)),
    deadline: stampNow(new Date(deadlineMs)),
  };
  // set = 开一局新的：归档标记必须清掉，否则新目标会被当成"已归档的旧目标"藏起来
  goal.archived = false;
  goal.archivedAt = '';
  store.goals[key] = goal;
  await saveStore(store);

  return { status: 'ok', replaced, key, name, cwd, goal: goalView(goal) };
}

/**
 * 查看本目录的 timegoal；无则返回 `{hasGoal:false}`。
 */
export async function showTimegoal({ cwd: rawCwd } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const { key, name, cwd } = normalizeCwd(rawCwd);
  const store = await loadRecycledStore();
  const g = store.goals[key];
  if (!g) return { hasGoal: false, key, name, cwd };
  const evalRes = evalTimegoal(g, Date.now());
  return {
    hasGoal: true,
    key,
    name,
    cwd,
    goal: goalView(g),
    reached: evalRes.reached,
    remainingSec: evalRes.remainingSec,
    elapsedSec: evalRes.elapsedSec,
    overtimeSec: evalRes.overtimeSec,
  };
}

/**
 * 时间运算 + 回显原 prompt，并追加一条状态日志。
 * - 每次有效 check 都要求调用方提供 `summary`（当前现状）与 `progress`
 *   （完成度/下一步），空值、缺值、超长都拒绝，保证日志有用且可比较。
 * - 有 goal：日志先成功落盘，再返回 reached/time/prompt 和本次日志记录。
 * - 无 goal：仍需要提交 summary/progress，但不写日志（没有目标就不该有 goal 日志）。
 * `prompt` 永远从 store 原文回显 —— 不让 agent 在长对话里漂移。
 */
export async function checkTimegoal({ cwd: rawCwd, summary: rawSummary, progress: rawProgress } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const summary = normalizeLogField(rawSummary, 'summary', 2000);
  const progress = normalizeLogField(rawProgress, 'progress', 2000);
  const { key, name, cwd } = normalizeCwd(rawCwd);
  // ⚠️ 这里用 persist:true —— check 是**写路径**（每轮都要写一条日志），
  // 所以"自动失效"（超过保留期 → 整条删掉）可以顺便落盘。
  // 读路径（show / list / 面板的 /api/timegoals/all）刻意不落盘：面板每 1.5s
  // 轮询一次，一次读就覆写整个文件会把并发的 CLI 写入冲掉。
  // 于是"自动清"实际发生在：agent 下一轮 check（或 set/update/clear）时 ——
  // 不需要任何人手动点「彻底清除」。
  const store = await loadRecycledStore({ persist: true });
  const g = store.goals[key];
  const nowMs = Date.now();
  if (!g) {
    return {
      hasGoal: false,
      reached: false,
      elapsedSec: 0,
      remainingSec: 0,
      overtimeSec: 0,
      prompt: '',
      summary,
      progress,
      key,
      name,
      cwd,
      now: stampNow(new Date(nowMs)),
    };
  }

  const result = evalTimegoal(g, nowMs);
  const entry = {
    checkedAt: stampNow(new Date(nowMs)),
    elapsedSec: result.elapsedSec,
    remainingSec: result.remainingSec,
    overtimeSec: result.overtimeSec,
    reached: result.reached,
    summary,
    progress,
  };
  if (!Array.isArray(g.log)) g.log = [];
  g.log.push(entry);
  // 日志只留最近 N 条：长跑任务每轮都记，不封顶的话 store 会无限膨胀。
  // 截断是**可见的**（logTruncated / totalChecks），不是静默丢历史。
  g.totalChecks = (Number(g.totalChecks) || 0) + 1;
  if (g.log.length > MAX_LOG_ENTRIES) {
    g.log.splice(0, g.log.length - MAX_LOG_ENTRIES);
    g.logTruncated = true;
  }
  await saveStore(store);

  return {
    ...result,
    prompt: g.prompt, // 永远原文回显，绝不拼接/裁剪
    summary,
    progress,
    checkedAt: entry.checkedAt,
    startedAt: g.startedAt,
    deadline: g.deadline,
    now: stampNow(new Date(nowMs)),
    key,
    name,
    cwd,
    logCount: g.log.length,
    totalChecks: Number(g.totalChecks) || g.log.length,
    logTruncated: !!g.logTruncated,
    archived: !!g.archived,
    purged: !!g.purged,
  };
}

/**
 * 读本目录 timegoal 的检查日志（每次 check 追加一条：现状 + 完成度）。
 * 这是 timegoal 的"历史"——回看每轮干了什么、剩多少时间。
 */
export async function getTimegoalLog({ cwd: rawCwd } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const { key, name, cwd } = normalizeCwd(rawCwd);
  const store = await loadRecycledStore();
  const g = store.goals[key];
  if (!g) return { hasGoal: false, count: 0, entries: [], key, name, cwd };
  const entries = Array.isArray(g.log) ? g.log : [];
  return {
    hasGoal: true,
    count: entries.length,
    // 截断可见：读者能分清"这就是全部轮次"与"只留了最近 200 条"
    totalEntries: Number(g.totalChecks) || entries.length,
    truncated: !!g.logTruncated,
    entries: entries.map((e) => ({
      checkedAt: e.checkedAt || '',
      elapsedSec: Number(e.elapsedSec) || 0,
      remainingSec: Number(e.remainingSec) || 0,
      overtimeSec: Number(e.overtimeSec) || 0,
      reached: !!e.reached,
      summary: String(e.summary || ''),
      progress: String(e.progress || ''),
    })),
    key,
    name,
    cwd,
  };
}

function normalizeLogField(raw, flag, maxLength) {
  const value = String(raw ?? '').trim();
  if (!value) throw badInput(`--${flag} 不能为空（每次 check 都会写入 timegoal 日志）`);
  if (value.length > maxLength) {
    throw badInput(`--${flag} 过长（≤${maxLength} 字，当前 ${value.length} 字）`);
  }
  return value;
}


/**
 * 更新本目录 timegoal 的 prompt（可选同时改时长），**不动 startedAt**。
 *
 * 这是"agent 自己优化提示词"与"用户在 web 上编辑 timegoal"的共同入口。
 * 与 `set` 的关键差异：
 *   - `set`    → 重置起点（计时从头算），适合"开一局新的"
 *   - `update` → 保留起点。改时长时 deadline = startedAt + 新时长，
 *                已用掉的时间仍然算数（不会因为拖了下时长就白赚一段）。
 *
 * `durationSec` 省略 = 时长不变，只换 prompt。
 *
 * ⚠️ **已到点（失效）的目标不能 update**：到期即失效，不可复活；要继续这个目录
 * 的工作请用 `set` 开新一局。
 *
 * 无 goal 时抛错（不存在就没有"更新"对象，与 clear 的宽容返回不同）。
 */
export async function updateTimegoal({ cwd: rawCwd, prompt: rawPrompt, durationSec: rawDur } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const prompt = normalizePrompt(rawPrompt);
  const { cwd, name, key } = normalizeCwd(rawCwd);

  const store = await loadRecycledStore({ persist: true });
  const g = store.goals[key];
  if (!g) {
    throw badInput(`主题「${name}」尚未设置 timegoal——请先 nx-kv timegoal set`);
  }
  // ⚠️ **已到点的目标不可复活**：「失效」就是失效。
  // 以前 update 会把归档的目标救回来（"续上这局"），现在到期即失效——
  // 想继续这个目录的工作，请用 `set` 开新一局（起点从现在重算）。
  if (g.archived) {
    throw badInput(
      `主题「${name}」的时间目标已经到点失效了，不能续上——请用 nx-kv timegoal set 开新一局`
    );
  }
  g.prompt = prompt;
  if (rawDur !== undefined && rawDur !== null && rawDur !== '') {
    const dur = parseDuration(rawDur);
    g.durationSec = dur;
    // 保留起点：deadline = startedAt + 新时长（已用时间仍算数）
    const startMs = parseStampMs(g.startedAt);
    const base = Number.isFinite(startMs) ? startMs : Date.now();
    g.deadline = stampNow(new Date(base + dur * 1000));
  }
  await saveStore(store);
  return { updated: true, key, name, cwd, goal: goalView(g) };
}

/**
 * 删除本目录的 timegoal。无则 `{cleared:false, reason:'no_goal'}`（不抛错，
 * 方便面板"清空"按钮无脑调用）。
 */
export async function clearTimegoal({ cwd: rawCwd } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const { key, cwd, name } = normalizeCwd(rawCwd);
  const store = await loadRecycledStore({ persist: true });
  if (!store.goals[key]) {
    return { cleared: false, reason: 'no_goal', key, name, cwd };
  }
  delete store.goals[key];
  await saveStore(store);
  return { cleared: true, key, name, cwd };
}

/**
 * 列出所有有 timegoal 的目录，按 deadline 升序（最近的先提醒）。
 *
 * **活动目标**（goals）与**已归档目标**（archived）分开返回：
 * 到点即自动归档的活动目标不会再出现在这里——用户不必再手动点「回收已到点」。
 */
export async function listTimegoals() {
  const store = await loadRecycledStore();
  const all = Object.values(store.goals);
  const byDeadline = (a, b) => String(a.deadline).localeCompare(String(b.deadline));
  const active = all.filter((g) => !g.archived).sort(byDeadline);
  const archived = all.filter((g) => g.archived).sort(byDeadline);
  return {
    count: active.length,
    // 列表**不返回完整 prompt**：每个 prompt 上限 20000 字，归档区 N 个目标就是
    // N×20KB，而面板每 1.5s 拉一次 list。要看全文用 `timegoal show --cwd <目录>`。
    goals: active.map((g) => goalView(g, { withPrompt: false })),
    archivedCount: archived.length,
    archived: archived.map((g) => goalView(g, { withPrompt: false })),
  };
}

/**
 * 彻底删除已到点 / 已归档的时间目标（硬删，不是归档）。
 *
 * 用途：面板「彻底清除」按钮 / 手动清理。**只删到点的或已归档的**——还在跑的不动。
 * 注意：正常的"到点回收"是**自动归档**（见 autoRecycle），不需要人来点这个；
 * 保留期过后系统会自动丢掉旧日志（提示词仍留着）；本命令用于把整个目标连提示词一起清掉。
 *
 * @returns {{count:number, removed:Array}} removed 是删除前的快照（供 UI 汇报）
 */
export async function pruneExpired() {
  const store = await loadStore();
  const now = Date.now();
  const removed = [];
  for (const [k, g] of Object.entries(store.goals)) {
    // 已归档的、或已经过线的，都属于"使命完成"——删掉
    if (g.archived || evalTimegoal(g, now).reached) {
      removed.push(goalView(g));
      delete store.goals[k];
    }
  }
  if (removed.length) await saveStore(store);
  return { count: removed.length, removed };
}

