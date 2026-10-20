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
export const MAX_DURATION_SEC = 86400; // 最大 24 小时（避免手滑设无穷）
export const MAX_PROMPT = 20_000; // prompt 长度上限（与 localtask MAX_TEXT 同档）

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

function goalView(g) {
  return {
    key: g.key,
    cwd: g.cwd,
    name: g.name,
    durationSec: g.durationSec,
    startedAt: g.startedAt,
    deadline: g.deadline,
    prompt: g.prompt,
  };
}

// ─── 输入校验 ──────────────────────────────────────────────────────────

function clampDuration(n) {
  if (!Number.isFinite(n)) throw badInput(`--duration 必须是 1..${MAX_DURATION_SEC} 之间的整数秒`);
  const i = Math.floor(Number(n));
  if (i < MIN_DURATION_SEC) {
    throw badInput(`--duration 至少 ${MIN_DURATION_SEC} 秒（避免手滑设 0 立即到点）`);
  }
  if (i > MAX_DURATION_SEC) {
    throw badInput(`--duration 超过上限 ${MAX_DURATION_SEC} 秒（24 小时）`);
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
    return { hasGoal: false, reached: false, elapsedSec: 0, remainingSec: 0 };
  }
  const startMs = parseStampMs(goal.startedAt);
  const deadlineMs = parseStampMs(goal.deadline);
  if (!Number.isFinite(startMs) || !Number.isFinite(deadlineMs)) {
    // 数据损坏：start/ deadline 必须能解析；保守地算到点（避免 agent 误认为没到）
    return { hasGoal: true, reached: true, elapsedSec: 0, remainingSec: 0 };
  }
  const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const remainingSec = Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  const reached = nowMs >= deadlineMs;
  return { hasGoal: true, reached, elapsedSec, remainingSec };
}

// ─── CRUD 风格命令（与 localtask 思路一致但命令族更窄）────────────────

/**
 * 设置本目录的 timegoal；已存在则覆盖并标 `replaced:true`。
 */
export async function setTimegoal({ cwd: rawCwd, durationSec: rawDur, prompt: rawPrompt } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const durationSec = clampDuration(rawDur);
  const prompt = normalizePrompt(rawPrompt);
  const { cwd, name, key } = normalizeCwd(rawCwd);

  const store = await loadStore();
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
  const store = await loadStore();
  const g = store.goals[key];
  if (!g) return { hasGoal: false, key, name, cwd };
  return { hasGoal: true, key, name, cwd, goal: goalView(g) };
}

/**
 * 时间运算 + 回显原 prompt。这是 skill 的事实源。
 * - 无 goal：`{hasGoal:false, reached:false, prompt:""}`
 * - 有 goal：返回完整对象（reached / elapsedSec / remainingSec / deadline / prompt）
 * `prompt` 永远从 store 原文回显 —— 不让 agent 在长对话里漂移。
 */
export async function checkTimegoal({ cwd: rawCwd } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const { key, name, cwd } = normalizeCwd(rawCwd);
  const store = await loadStore();
  const g = store.goals[key];
  if (!g) {
    return {
      hasGoal: false,
      reached: false,
      elapsedSec: 0,
      remainingSec: 0,
      prompt: '',
      key,
      name,
      cwd,
      now: stampNow(),
    };
  }
  const result = evalTimegoal(g, Date.now());
  return {
    ...result,
    prompt: g.prompt, // 永远原文回显，绝不拼接/裁剪
    startedAt: g.startedAt,
    deadline: g.deadline,
    now: stampNow(),
    key,
    name,
    cwd,
  };
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
 * 无 goal 时抛错（不存在就没有"更新"对象，与 clear 的宽容返回不同）。
 */
export async function updateTimegoal({ cwd: rawCwd, prompt: rawPrompt, durationSec: rawDur } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const prompt = normalizePrompt(rawPrompt);
  const { cwd, name, key } = normalizeCwd(rawCwd);

  const store = await loadStore();
  const g = store.goals[key];
  if (!g) {
    throw badInput(`主题「${name}」尚未设置 timegoal——请先 nx-kv timegoal set`);
  }
  g.prompt = prompt;
  if (rawDur !== undefined && rawDur !== null && rawDur !== '') {
    const dur = clampDuration(rawDur);
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
  const store = await loadStore();
  if (!store.goals[key]) {
    return { cleared: false, reason: 'no_goal', key, name, cwd };
  }
  delete store.goals[key];
  await saveStore(store);
  return { cleared: true, key, name, cwd };
}

/**
 * 列出所有有 timegoal 的目录，按 deadline 升序（最近的先提醒）。
 */
export async function listTimegoals() {
  const store = await loadStore();
  const list = Object.values(store.goals).sort((a, b) =>
    String(a.deadline).localeCompare(String(b.deadline))
  );
  return { count: list.length, goals: list.map(goalView) };
}
