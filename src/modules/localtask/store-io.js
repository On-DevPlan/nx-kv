// （#54 自 service.js 拆出）store 读写层：localtasks.json 的加载/原子落盘（同进程链式写队列 +
// Windows rename EPERM 退避）+ 损坏隔离（.corrupt-*）+ 主题桶/任务行原语（topicOf/nextTaskId）
// + 基础输入校验（summary/text）与时间工具（stampNow/parseStampMs）。
import fsp from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { badInput } from '../../core/errors.js';
import { DEFAULT_TASK_SUFFIX, clampTaskSuffixList, clampAckPromptList } from './task-templates.js';
import { storePath, legacyStorePath } from './paths.js';
export const DEFAULT_TIMEOUT_MS = 180_000; // 阻塞默认 3 分钟（推荐值）
export const DEFAULT_TIMEOUT_SEC = 180; // 推荐阻塞时长（3 分钟）
export const MAX_TIMEOUT_SEC = 600; // 阻塞时长上限（10 分钟）
export const MAX_SUMMARY = 2000; // 现状（状态）长度上限（原 200，已放宽）
export const MAX_TEXT = 20_000; // 单条任务内容长度上限
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
export function normalizeText(raw) {
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
    settings: { timeoutSec: DEFAULT_TIMEOUT_SEC, taskSuffix: [DEFAULT_TASK_SUFFIX] },
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

// 损坏隔离：store 文件读不出来/解析失败时，先把坏文件**改名保留**（.corrupt-<定宽时间戳>），
// 再让 loadStore 落到空 store——否则下次 saveStore 会把坏文件原地覆盖，全部主题无声清零。
// 最多留 CORRUPT_KEEP 份，超出删最旧（文件名时间戳定宽，字典序即时间序）。
// 仅文件不存在（首次启动）不算损坏：access 探测失败直接返回，不产生备份。
const CORRUPT_KEEP = 3;
async function quarantineCorruptStore() {
  const p = storePath();
  try {
    await fsp.access(p);
  } catch {
    return; // 文件不存在（或探不到）→ 不是「损坏」，不备份
  }
  const ts = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stamp =
    String(ts.getFullYear()) +
    pad(ts.getMonth() + 1) +
    pad(ts.getDate()) +
    '-' +
    pad(ts.getHours()) +
    pad(ts.getMinutes()) +
    pad(ts.getSeconds()) +
    '-' +
    pad(ts.getMilliseconds(), 3);
  try {
    await fsp.rename(p, `${p}.corrupt-${stamp}`);
  } catch {
    return; // 改名失败（Windows 偶发文件锁）→ 保留原文件等下次，绝不吞掉坏文件
  }
  try {
    const dir = dirname(p);
    const prefix = basename(p) + '.corrupt-';
    const corrupts = (await fsp.readdir(dir)).filter((f) => f.startsWith(prefix)).sort();
    for (const f of corrupts.slice(0, Math.max(0, corrupts.length - CORRUPT_KEEP))) {
      await fsp.rm(join(dir, f), { force: true });
    }
  } catch {
    /* 备份清理失败不影响主流程 */
  }
}

export async function loadStore() {
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
    // 损坏 → 坏文件改名隔离（.corrupt-*，最多留 3 份），别让下次 save 把它覆盖掉。
    // 文件不存在的「缺失」路径里 access 探测会失败，不会产生多余备份。
    await quarantineCorruptStore();
  }
  if (!topics) return emptyStore();
  return {
    version: 4,
    settings: {
      timeoutSec: clampTimeoutSec(settings && settings.timeoutSec),
      // 旧 store 可能没存过 taskSuffix（v0.8.0 之前）；缺省→默认模板（单条）。
      // 显式 '' / []（关闭）会保留为 []——判断条件是「字段存在且非 undefined」，不能只看 falsy。
      // v0.14 起存 string[]（多条）；旧 string 单条原样迁入列表，不拆段。
      taskSuffix: settings && Object.prototype.hasOwnProperty.call(settings, 'taskSuffix')
        ? clampTaskSuffixList(settings.taskSuffix)
        : [DEFAULT_TASK_SUFFIX],
      // ack 完成总结提示词（v0.16 起）：字段存在才认，缺省 = 空（不追加）。
      // 注意——这里是**白名单式重建**：没列出的字段会在读时被丢掉，
      // 新增设置项必须在这里补一行，否则「写进去读不回来」。
      ackPrompt: settings && Object.prototype.hasOwnProperty.call(settings, 'ackPrompt')
        ? clampAckPromptList(settings.ackPrompt)
        : [],
    },
    topics,
  };
}

// 落盘串行化：同进程内多个写操作可能重叠（如 poll 消费落盘与 finally 复位等待态、
// 全局 FIFO 唤醒与另一路 clearWaiting）——它们共用同一个 .tmp 中转文件，不排队的话
// A 的 rename 会把 tmp 消耗掉，B 再 rename 就 ENOENT。链式队列保证同进程顺序写。
// （跨进程仍靠 rename 原子性 last-writer-wins，与本模块既有语义一致。）
let saveQueue = Promise.resolve();
/** @public 供 SnapshotStore topic-adapter 原子落盘（与内部写路径同一队列） */
export function saveStore(data) {
  const run = saveQueue.then(async () => {
    const p = storePath();
    await fsp.mkdir(dirname(p), { recursive: true });
    const tmp = p + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    // Windows 上目标文件可能被并发读者（loadStore 的 readFile）或杀软短暂锁住，
    // rename 偶发 EPERM/EACCES——小退避重试几次即可。跨进程并发写也靠原子 rename 兜底。
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
  saveQueue = run.catch(() => {
    /* 失败不阻断后续排队者；本次调用的 rejection 仍返回给调用方 */
  });
  return run;
}

// 取（必要时新建）某个主题
export function topicOf(store, key, cwd, name = '') {
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
  if (cwd) {
    // 主题的身份是 **目录名**（key = 目录名哈希），不是路径。同名目录共用一个队列，
    // 路径可能被另一个同名目录覆盖 —— 以前"最后写入者赢"，面板上显示的路径会
    // 跟着变，看着像队列跑到别处去了。
    // 现在：**第一个路径为准**（稳定），所有见过的路径记进 cwds，面板可如实展示。
    if (!t.cwd) t.cwd = cwd;
    if (!Array.isArray(t.cwds)) t.cwds = [];
    if (!t.cwds.includes(cwd)) t.cwds.push(cwd);
  }
  if (name) t.name = name;
  else if (cwd) t.name = basename(cwd) || t.name;
  return t;
}

export function nextTaskId(tasks) {
  let max = 0;
  for (const t of tasks) {
    const id = Number(t.id) || 0;
    if (id > max) max = id;
  }
  return max + 1;
}
// "YYYY-MM-DD HH:mm:ss"（本地）→ epoch ms；无法解析返回 NaN
export function parseStampMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}
