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
//   2. **全局主题兜底（工作窃取）。** 除按目录划分的本地队列外，还有一个跨目录共享的
//      「全局主题」（key '__GLOBAL__'）：本地队列取不到 pending 时，任何 wait 都自动去
//      全局领（显式传 --cwd 也不例外）；全局也没有才阻塞。任务用 addTask({global:true})
//      （CLI --global）发布进池子，谁闲谁领——类似 Go 调度器的 local runq + global runq。
//   3. **现状总结只作状态展示。** --summary 是 agent 当前状态（人读），每次 wait 刷新，
//      不再参与队列分桶；用户据此一眼看清 agent 做到哪、卡在哪。
//   4. **纯本地协调，不依赖 KV 后端登录态。** 数据落本机文件，弹窗由本进程临时起的
//      http 服务器直出，未登录也能用。
//   5. **排队语义。** 用户可提前回填：主题已有 pending 时 wait 立即取走、不开窗；
//      没有 pending 才开窗阻塞。
//   6. **超时是业务结果不是错误。** 默认阻塞 3 分钟（页面可调，上限 10 分钟）；超时返回 {status:'timeout'}、
//      exit 0，agent 据此安静收尾结束本轮，绝不抛异常。
//
// 跨进程：弹窗与 wait 同进程时靠内存 waiter 即时唤醒；任务由别的进程写入（如常驻
// serve 的面板页）时，wait 用轮询兜底（见 POLL_MS）。
import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// ─── 全局主题：跨目录共享队列（工作窃取）───────────────────────────
//
// 参考 Go runtime scheduler 的两层队列：每个 P 有 local runq，空了去 global runq
// 取，还没有才 park。这里的对应物：每个工作目录一个本地主题队列，wait 在本地
// 取不到 pending 时自动去「全局主题」领；全局也没有才阻塞。
// 任务侧用 addTask({global:true})（CLI --global）把不限定接收方的任务发布进池子。
//
// 全局主题是真实存在的主题对象（复用 topics 存储），但有特殊行为：
//   - key 固定 '__GLOBAL__'，与目录名哈希出的 16 位 hex key 永不冲突；cwd 恒为空
//   - 永不进入 waiting 状态（它是任务源，不是等待源）——countWaitingTopics 自然不计
//   - prune/remove 默认跳过（受保护），--force 才能删；等待语义（setWaiting/cancel）不适用
export const GLOBAL_KEY = '__GLOBAL__';
export const GLOBAL_NAME = '全局任务';
export const GLOBAL_CWD = ''; // 全局主题永不指向真实目录

export function isGlobalKey(key) {
  return key === GLOBAL_KEY;
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

// 落盘串行化：同进程内多个写操作可能重叠（如 poll 消费落盘与 finally 复位等待态、
// 全局 FIFO 唤醒与另一路 clearWaiting）——它们共用同一个 .tmp 中转文件，不排队的话
// A 的 rename 会把 tmp 消耗掉，B 再 rename 就 ENOENT。链式队列保证同进程顺序写。
// （跨进程仍靠 rename 原子性 last-writer-wins，与本模块既有语义一致。）
let saveQueue = Promise.resolve();
function saveStore(data) {
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

function nextTaskId(tasks) {
  let max = 0;
  for (const t of tasks) {
    const id = Number(t.id) || 0;
    if (id > max) max = id;
  }
  return max + 1;
}

// 领取耗时（秒）：**发布 → 被领取**的时间差。
// 数据本来就在（createdAt / consumedAt），这里算成派生字段，省得每个使用方自己算，
// 也省得存一份会漂移的冗余副本。
// 只有真的被领走的才有值；还没被领的返回 null（那是"还在等"，由使用方按当前时间算）。
function pickupSecOf(t) {
  if (!t || t.status !== 'consumed') return null;
  const created = parseStampMs(t.createdAt);
  const consumed = parseStampMs(t.consumedAt);
  if (!Number.isFinite(created) || !Number.isFinite(consumed)) return null;
  return Math.max(0, Math.round((consumed - created) / 1000));
}

function normalizeTask(t) {
  return {
    id: Number(t.id) || 0,
    text: String(t.text ?? ''),
    status: t.status === 'consumed' ? 'consumed' : 'pending',
    roundSummary: String(t.roundSummary ?? ''),
    createdAt: String(t.createdAt ?? ''),
    consumedAt: String(t.consumedAt ?? ''),
    // 领取耗时：从发布到被领取过了多久（秒）。还没被领的是 null。
    pickupSec: pickupSecOf(t),
    // 领取审计：这条**从哪个池**被领走（local/global）、**被谁**领走（领取方的目录）。
    claimedFrom: String(t.claimedFrom ?? ''),
    claimedBy: String(t.claimedBy ?? ''),
    claimedByName: String(t.claimedByName ?? ''),
    // 软删除标记：删除不再不可逆（可 restore 回来）。词汇与同仓 timegoal 对齐
    // （那边叫 archivedAt + 保留期 + purge）。
    deletedAt: String(t.deletedAt ?? ''),
  };
}

// 主题的截止时刻（epoch ms）。优先用 waitingUntilMs（毫秒精度，新数据都有），
// 老数据没有这个字段时才回退解析 waitingUntil 字符串（秒级精度）。
export function deadlineMsOf(t) {
  if (!t) return NaN;
  if (Number.isFinite(t.waitingUntilMs) && t.waitingUntilMs > 0) return t.waitingUntilMs;
  return parseStampMs(t.waitingUntil);
}

// 主题是否「真的有人在等」——**必须看截止时刻，不能只看 waiting 标志**。
//
// waiting 标志由 wait 进程写入、结束时复位；跨进程可见，但 wait 被强杀
// （SIGKILL / 任务管理器杀 / 终端关掉 / 机器崩了）时 finally 不会执行，标志
// 就**永久残留**。曾出现过：gs-ac 的 wait 被杀后，标志一直挂着，面板永远显示
// 「等待中 已等 760:35 · 剩 0:00」，用户点「关闭」也没有进程来消费。
//
// 判据：waiting 为真**且**截止时刻还没过。截止时刻已过 = 那个 wait 本来也该
// 收尾了（超时），此时的 waiting 是残留，不是"有人正等着"。
//
// 唯一会误判的窗口：wait 进程还活着、但刚好卡在超时那一瞬（<1s）——那时
// 它下一拍就会自己收尾，短暂显示"已结束"无伤大雅。
export function isLiveWaiting(t, nowMs = Date.now()) {
  if (!t || !t.waiting) return false;
  const until = deadlineMsOf(t);
  if (!Number.isFinite(until)) return false; // 没有截止时刻 = 脏数据，不算等待中
  return until > nowMs;
}

// ─── 仓库上下文（repos 模块的本地登记）───────────────────────────────
//
// 仓库登记住在**另一个模块的另一个 store**（~/.nx-kv/repos.json）。
// 这里只读它来补上下文，**不让本地任务的核心依赖它**：
//   - 动态 import：不在启动路径上，别的模块没装仓库登记也不影响本地任务；
//   - 失败即"没有上下文"：仓库登记坏了绝不能把本地任务带崩。
let reposMod = null;
async function repoContextIndex() {
  try {
    if (!reposMod) reposMod = await import('../repos/service.js');
    return { mod: reposMod, map: await reposMod.contextMap() };
  } catch {
    return null;
  }
}

// 按目录路径取仓库上下文（取不到就是 null —— 没登记过的目录很正常）
function repoCtxOf(index, cwd) {
  if (!index || !index.map || !cwd) return null;
  return index.map.get(index.mod.normalizePathKey(cwd)) || null;
}

function topicView(t, repoCtx = null) {
  const tasks = t.tasks.map(normalizeTask);
  const live = isLiveWaiting(t);
  return {
    key: t.key,
    cwd: t.cwd || '',
    name: t.name || '',
    summary: t.summary || '',
    // 提交方（add --summary）留下的补充说明：与 agent 的「当前现状」分开存，
    // 两个写入者不再抢同一个字段（以前谁后写谁覆盖，面板上的现状会乱跳）。
    submitSummary: t.submitSummary || '',
    // 这个队列被哪些路径用过（队列按目录名识别，同名目录共用）
    cwds: Array.isArray(t.cwds) && t.cwds.length ? t.cwds.slice() : t.cwd ? [t.cwd] : [],
    // 仓库上下文（来自 repos 模块的本地登记）：目录路径对得上已登记仓库时，
    // 把仓库信息带出来 —— agent 领任务时就知道这条任务属于哪个仓库、周围关联哪些看板。
    // 对不上就是 null（没登记过的目录很正常，不该因此报错）。
    repo: repoCtx || null,
    // waiting 是**对外的真相**：僵尸标志在这里被抹平，面板才不会一直转圈
    waiting: live,
    // 残留标志单独透出，UI 可以说明"上次等待超时、进程已退出"而不是装作从没有过
    staleWaiting: !!t.waiting && !live,
    waitingUntil: t.waitingUntil || '',
    waitingUntilMs: Number(t.waitingUntilMs) || 0,
    waitingSince: t.waitingSince || '',
    cancelRequested: !!t.cancelRequested,
    isGlobal: isGlobalKey(t.key),
    // 手动登记的目录（面板「添加目录」）：空主题也不被 prune 清掉
    manual: !!t.manual,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    pending: tasks.filter((x) => x.status !== 'consumed' && !x.deletedAt).length,
    // 开/关两个计数分开给（Kanboard 的 nb_open_tasks / nb_closed_tasks）：
    // 面板上「N 待领 · M 已领」比一个总数有用得多——一眼看出还剩多少活、已经干完多少。
    consumed: tasks.filter((x) => x.status === 'consumed' && !x.deletedAt).length,
    // 软删除的条数（还在队列里，可恢复）
    deleted: tasks.filter((x) => !!x.deletedAt).length,
    total: tasks.length,
    tasks,
  };
}

// ─── 进程内 waiter：key -> { resolve(task) } ───────────────────────

const waiters = new Map();

// 进程内「愿意从全局领任务」的等待者（FIFO）。任何本地主题的 wait 在本地空、
// 全局也空而阻塞时，除了挂进 waiters（等本目录回填），还挂到这里——
// 同进程 addTask({global:true}) 投递时按先来后到投给最早阻塞的 waiter。
const globalWaiters = [];

// 注册全局兜底 waiter；返回注销函数（wait 在拿到任务/超时/被关闭时都要调用，
// 否则已结束的 wait 还留在队列里占位）。summary 随注册固化——全局投递领取时
// 记进 task.roundSummary 的是「领取方 agent 当时的现状」，而非全局池自己的现状。
// by 随注册固化——领取后记进 task.claimedBy，事后能看出「这条是谁领的」。
function registerGlobalWaiter(onTask, summary, by) {
  const entry = { onTask, summary: summary || '', by: by || null, settled: false };
  globalWaiters.push(entry);
  return () => {
    if (entry.settled) return;
    entry.settled = true;
    const i = globalWaiters.indexOf(entry);
    if (i >= 0) globalWaiters.splice(i, 1);
  };
}

// 弹出第一个未注销的 waiter（FIFO）；无人等返回 null。
// 取出即标记 settled，保证一条任务只唤醒一个 waiter。
function takeGlobalWaiter() {
  while (globalWaiters.length) {
    const entry = globalWaiters.shift();
    if (!entry.settled) {
      entry.settled = true;
      return entry;
    }
  }
  return null;
}

function markConsumed(task, roundSummary, meta = {}) {
  task.status = 'consumed';
  task.consumedAt = stampNow();
  // 记录该任务所回应的「agent 上一轮完成总结」（本轮等待时的现状）
  if (roundSummary) task.roundSummary = roundSummary;
  // 领取审计：这条**从哪个池**被领走、**被谁**领走。
  // 全局池里的任务被别的目录的 agent 领走时，光看"它在全局池里"看不出谁干的。
  if (meta.from) task.claimedFrom = meta.from;
  if (meta.byKey) task.claimedBy = meta.byKey;
  if (meta.byName) task.claimedByName = meta.byName;
  return task;
}

// 取走该主题第一条 pending；没有则返回 null。roundSummary 显式指定本轮完成总结，
// 缺省回落到主题当前 summary（等待中即本轮现状）。
// by = 领取方身份 {key,name,cwd}（wait 传入），用于记领取审计。
export async function consumeFirstPending(key, roundSummary, by) {
  const store = await loadStore();
  const t = store.topics[key];
  if (!t) return null;
  const task = t.tasks.find((x) => x.status !== 'consumed' && !x.deletedAt);
  if (!task) return null;
  markConsumed(task, roundSummary || t.summary || '', {
    from: isGlobalKey(key) ? 'global' : 'local',
    byKey: by && by.key,
    byName: by && by.name,
  });
  t.updatedAt = stampNow();
  await saveStore(store);
  return normalizeTask(task);
}

// 在 store 里把某主题置为等待/结束，并刷新现状。
// waitingSince 是「等待起点」，面板据此显示「已等多久」——waitingUntil（截止时刻）
// 只能反推剩余，反推不出起点（超时值可被改写），所以两者都存。
// 全局主题是任务源不是等待源，永不置等待态（no-op）。
async function setWaiting(key, cwd, summary, waiting, deadline) {
  if (isGlobalKey(key)) return;
  const store = await loadStore();
  const t = topicOf(store, key, cwd);
  t.waiting = !!waiting;
  t.waitingUntil = waiting && deadline ? stampNow(deadline) : '';
  // **毫秒精度的截止时刻**（epoch ms）。waitingUntil 那串是给人看的、只有秒级精度，
  // 而 stampNow 是「截断」不是「四舍五入」——短时限（秒级）时截断误差能吃掉整个窗口：
  // wait 若恰好在某秒最后 40ms 启动，真实 deadline 是 S+1.97s，存成 "S+1" 解析回来
  // 就是 S+1.000，比 now 还早 → 被判成「没在等」→ 事件流永远推不出 waiting。
  // 判据一律走 deadlineMsOf()：优先读这个精确值，老数据才回退解析字符串。
  t.waitingUntilMs = waiting && deadline ? deadline.getTime() : 0;
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
  if (isGlobalKey(key)) return;
  const store = await loadStore();
  const t = store.topics[key];
  if (!t) return;
  t.waiting = false;
  t.waitingUntil = '';
  t.waitingUntilMs = 0;
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
  // 全局主题不是等待源（永不 waiting），无从关闭
  if (isGlobalKey(key)) {
    return { cancelled: false, key, name: GLOBAL_NAME, cwd: '', reason: 'global_not_waitable' };
  }
  const store = await loadStore();
  const t = store.topics[key];
  if (!t || !isLiveWaiting(t)) {
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

// ─── 时间目标到点 → 本轮立刻收尾 ───────────────────────────────────────
//
// 以前 wait 只认两种结束：拿到任务，或自己的超时（最长 10 分钟）。
// 但如果这个目录挂着**时间目标**，预算到点这一局就该结束了 —— agent 不该在
// 预算外继续空等（它等的正是"下一条任务"，而预算已经用完）。
//
// 探针来自 timegoal 模块（独立 store，NX_KV_TIMEGOAL_STORE）：
//   - 用**动态 import**：两个模块互不依赖是刻意设计（见 timegoal/service.js 的
//     模块边界说明），这里只在真的 wait 时才按需加载，不给启动路径加负担。
//   - **fail-open**：加载失败 / 读不到 / 这个目录没有目标 → 一律当作"没有截止
//     时刻"，wait 照原样按超时走。探针坏了绝不能把 wait 卡死。
//   - 键是同一个：两个模块的 topicKeyFor 都是 sha1(小写目录名) 前 16 位，
//     所以「同名目录」= 同一个 key = 同一个目标。
//
// ⚠️ **只在"等待期间到期"才取消**：等待开始时目标就已经过期的，**不**取消。
// 否则一个用完了预算的目录会永远等不了（每次 wait 都秒回 cancelled）——
// 那不是"到点自动取消"，那是把目录焊死了。这种情况该由 agent 自己的
// `timegoal check`（reached:true）去处理。
let goalProbe = null;
async function readGoalDeadlineMs(key) {
  if (!key || isGlobalKey(key)) return 0;
  try {
    if (!goalProbe) goalProbe = await import('../timegoal/service.js');
    const g = await goalProbe.probeGoalExpiry(key);
    if (!g || g.reached) return 0; // 已经到点的：不参与自动取消
    const ms = Number(g.deadlineMs);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  } catch {
    return 0;
  }
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

// ─── 目录登记（面板「添加目录」）────────────────────────────────────
//
// wait/add 也会建主题，但那是**被动**创建：空主题会被 prune 当脏数据清掉。
// 手动登记的目录要能常驻（用户想先占个位、之后再绑 timegoal / 排任务），
// 所以打 `manual:true` 标记，prune 一律跳过。重复登记幂等（已存在则只刷新标记）。
export async function addTopic({ cwd: rawCwd } = {}) {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const { key, cwd, name } = normalizeCwd(rawCwd);
  const store = await loadStore();
  const existed = !!store.topics[key];
  const t = topicOf(store, key, cwd, name);
  t.manual = true;
  t.updatedAt = stampNow();
  await saveStore(store);
  return { status: 'ok', existed, key, name, cwd, topic: topicView(t) };
}

// 总览：返回全部主题（面板据此分组展示与回填）+ 超时设置，按最近更新排序；
// 全局主题永远置顶（共享池是所有 worker 的候补来源，放最显眼处）。
//
// 注意：**全局主题不在这里凭空造**。全局池空着的时候 store 里就是没有它
// （它只有真的往池子里投过东西才存在）。看板层（board.js）负责补一行"全局任务池"
// 占位，保证用户永远找得到往全局池加任务的入口——服务层的契约保持原样。
export async function listTasks() {
  const store = await loadStore();
  // 仓库上下文一次读一张表（逐主题读文件太浪费）
  const repoIndex = await repoContextIndex();
  const topics = Object.values(store.topics)
    .map((t) => topicView(t, repoCtxOf(repoIndex, t.cwd)))
    .sort(
      (a, b) =>
        Number(!!b.isGlobal) - Number(!!a.isGlobal) ||
        String(b.updatedAt).localeCompare(String(a.updatedAt))
    );
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
// 等待中的主题与全局主题一律保留；dryRun 只报告不改动。
//
// **僵尸等待标志不算"等待中"**：wait 被强杀后残留的 waiting:true 会让主题
// 永远躲过清理（gs-ac 就这么卡住的）。用 isLiveWaiting 判定——截止已过 = 没人
// 在等 = 可以清。
export async function pruneTopics({ allFinished = false, dryRun = false } = {}) {
  const store = await loadStore();
  const removed = [];
  for (const [key, t] of Object.entries(store.topics)) {
    // prune 走同一套判定（scope:'prune'）：全局共享池 / 等待中 / 手动登记 → 保留。
    // （prune 是"清旧脏数据"，不因未领取任务而跳过——它本来就只清空主题/旧模型主题。）
    if (!deleteGuard(t, { force: false, key, scope: 'prune' }).ok) continue;
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

// 任务级寻址：显式 key 优先（全局主题只能按 key 定位——它没有 cwd），否则按工作目录
//
// ⚠️ 同时给了 --cwd 与 --key、且两者**指向不同主题**时，现在直接报错。
// 以前是静默以 key 为准 —— 改错一个 key 就动到了别的目录的队列，没人会发现。
// 两者指向同一个主题时（脚本常见写法）照常工作，不破坏既有用法。
function resolveTaskKey({ key: rawKey, cwd: rawCwd }) {
  if (rawKey && String(rawKey).trim()) {
    const k = String(rawKey).trim();
    if (rawCwd && String(rawCwd).trim()) {
      const byCwd = normalizeCwd(rawCwd).key;
      if (byCwd !== k) {
        throw badInput(
          `--cwd 与 --key 指向不同的主题（--cwd → ${byCwd}，--key → ${k}），请只给一个`
        );
      }
    }
    return k;
  }
  return normalizeCwd(rawCwd).key;
}

export async function getTask({ cwd: rawCwd, key: rawKey, id } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
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
 * 向某主题（工作目录）的队列回填任务；global=true 时投递到全局主题（共享池）。
 * 若本进程正有 wait 在等该主题/全局池 → 直接投递并唤醒；否则入队堆积。
 * 全局投递的唤醒链：显式 wait 全局 key 者（罕见）→ globalWaiters FIFO → 入队。
 */
export async function addTask({ cwd: rawCwd, summary: rawSummary, text, global: toGlobal = false } = {}) {
  const body = normalizeText(text);
  const summary = normalizeSummary(rawSummary, { optional: true });

  const store = await loadStore();
  let key;
  let cwd;
  let t;
  if (toGlobal) {
    // 全局主题：cwd 恒空、名字固定；--cwd 显式给出也忽略（--global 优先）。
    // 但**不静默**：被忽略的 cwd 会在返回值里带出来（ignoredCwd），
    // 由 CLI/面板如实告诉用户"你给的目录没生效，任务进了全局池"。
    // （gh/kubectl 遇到矛盾参数会直接报错；这里为了不打断既有脚本，
    //   选择"照做 + 明说"，而不是改语义。）
    key = GLOBAL_KEY;
    cwd = GLOBAL_CWD;
    t = topicOf(store, key, cwd, GLOBAL_NAME);
  } else {
    ({ key, cwd } = normalizeCwd(rawCwd));
    t = topicOf(store, key, cwd);
  }

  const task = normalizeTask({ id: nextTaskId(t.tasks), text: body, status: 'pending', createdAt: stampNow() });
  t.tasks.push(task);
  t.updatedAt = stampNow();
  // 提交方的补充说明写**自己的字段**（submitSummary），不再覆盖 t.summary。
  // t.summary 是「agent 当前现状」（由 setWaiting 写）——两个写入者抢同一个字段时，
  // 面板上"当前现状"一会儿是 agent 的、一会儿是提交者的，看着像乱跳。
  if (summary) t.submitSummary = summary;

  // 唤醒分两步：先在 store 里标记消费，saveStore 之后才 resolve——保证 wait 返回时
  // 数据必然一致（沿用旧本地路径的顺序）。
  let delivered = false;
  let wake = null; // (task) => void

  if (toGlobal) {
    const direct = waiters.get(GLOBAL_KEY); // 显式等全局 key 的（罕见路径）
    if (direct) {
      markConsumed(task, t.summary, { from: 'global', byKey: GLOBAL_KEY, byName: GLOBAL_NAME });
      waiters.delete(GLOBAL_KEY);
      t.waiting = false;
      t.waitingUntil = '';
      delivered = true;
      wake = direct.resolve;
    } else {
      const gw = takeGlobalWaiter(); // FIFO：最早阻塞的先领
      if (gw) {
        markConsumed(task, gw.summary, {
          // roundSummary 记领取方 wait 的现状；claimedBy 记领取方是谁
          from: 'global',
          byKey: gw.by && gw.by.key,
          byName: gw.by && gw.by.name,
        });
        delivered = true;
        wake = gw.onTask;
      }
    }
  } else {
    const waiter = waiters.get(key);
    if (waiter) {
      markConsumed(task, t.summary, { from: 'local', byKey: key, byName: t.name });
      waiters.delete(key);
      t.waiting = false;
      t.waitingUntil = '';
      delivered = true;
      wake = waiter.resolve;
    }
  }

  await saveStore(store); // 先落盘再唤醒：wait 返回时数据必然一致
  if (wake) wake(normalizeTask(task));

  return {
    status: 'ok',
    key,
    cwd,
    name: t.name,
    summary: t.summary,
    isGlobal: toGlobal,
    // --global 与 --cwd 同时给时，cwd 被忽略（--global 优先）。不静默：
    // 把被忽略的那个带出来，让调用方能如实告诉用户"任务进了全局池，不是你给的目录"。
    ignoredCwd: toGlobal && rawCwd && String(rawCwd).trim() ? String(rawCwd).trim() : '',
    task: normalizeTask(task),
    delivered,
    queued: !delivered,
  };
}

export async function updateTask({ cwd: rawCwd, key: rawKey, id, text } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
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
  return { status: 'ok', key, cwd: t.cwd || cwd, name: t.name, task: normalizeTask(task) };
}

export async function removeTask({ cwd: rawCwd, key: rawKey, id, purge = false } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');

  const store = await loadStore();
  const t = store.topics[key];
  const index = t ? t.tasks.findIndex((x) => Number(x.id) === want) : -1;
  if (index < 0) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : cwd}」里没有 #${want} 任务`);
  }
  const task = t.tasks[index];
  if (purge) {
    // 彻底清除：把行真的摘出去（不可恢复）。软删除区里的"清干净"用这个。
    t.tasks.splice(index, 1);
    t.updatedAt = stampNow();
    await saveStore(store);
    return { status: 'ok', purged: true, key, cwd: t.cwd || cwd, name: t.name, removed: normalizeTask(task) };
  }
  // 软删除：行留在原地，只打一个 deletedAt 标记。
  // 为什么不是直接删：删除是最容易让人后悔的一步，而"恢复"只要一条命令。
  // 词汇与同仓的 timegoal 对齐（那边是 archivedAt + 保留期 + purge）。
  // 行不摘出去 → nextTaskId 的 max 仍覆盖它，编号不会被复用 ✓
  task.deletedAt = stampNow();
  task.trashIndex = index; // 恢复时放回原位
  t.updatedAt = stampNow();
  await saveStore(store);
  return { status: 'ok', purged: false, key, cwd: t.cwd || cwd, name: t.name, removed: normalizeTask(task) };
}

/**
 * 恢复一条被软删除的任务（撤销删除）。
 * 与 removeTask 互为逆操作：任务仍在队列里，只是带着 deletedAt 标记。
 */
export async function restoreTask({ cwd: rawCwd, key: rawKey, id } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
  const { cwd } = normalizeCwd(rawCwd);
  const want = Number(id);
  if (!Number.isFinite(want) || want <= 0) throw badInput('缺少参数 --id <任务编号>');

  const store = await loadStore();
  const t = store.topics[key];
  const task = t && t.tasks.find((x) => Number(x.id) === want);
  if (!task) {
    const { notFound } = await import('../../core/errors.js');
    throw notFound(`主题「${t ? t.name : cwd}」里没有 #${want} 任务`);
  }
  if (!task.deletedAt) {
    return { status: 'ok', restored: false, reason: 'not_deleted', key, cwd: t.cwd || cwd, name: t.name, task: normalizeTask(task) };
  }
  task.deletedAt = '';
  delete task.trashIndex;
  t.updatedAt = stampNow();
  await saveStore(store);
  return { status: 'ok', restored: true, key, cwd: t.cwd || cwd, name: t.name, task: normalizeTask(task) };
}

// ─── 主题删除（单个 / 批量） ───────────────────────────────────────

// 定位主题 key：显式 --key 优先，否则按工作目录（目录名）推导
// 与 resolveTaskKey 同一套规则（--cwd 与 --key 矛盾时报错），别再各写一份。
function resolveTopicKey({ key: rawKey, cwd: rawCwd }) {
  return resolveTaskKey({ key: rawKey, cwd: rawCwd });
}

// ─── 删除判定：四条删除路径共用同一套规则 ──────────────────────────────
//
// 以前「删任务 / 删主题 / 批量删除 / prune」各有各的保护规则，
// 面板只暴露其中两套 → 同一个动作在 CLI 与面板上表现不一样，看着像乱。
// 现在规则只写一份，四个入口都调它：
//
//   protected（全局共享池）→ 需要 --force
//   waiting（正阻塞等待）  → 需要 --force（agent 会超时收尾）
//   has_pending（有未领取）→ 需要 --force（活还没人领）
//   manual（手动登记的目录）→ 只在 prune 里保留，不参与普通删除
//
// force=true 仍然强删（老用法不变）。
export const DELETE_REASONS = {
  protected: '全局共享池',
  waiting: '等待中',
  has_pending: '有未领取任务',
  manual: '手动登记',
};

/**
 * 判定一个主题能不能删。
 * @returns {{ok:boolean, reason?:string, pending?:number, message?:string}}
 */
export function deleteGuard(topic, { force = false, key = '', scope = 'topic' } = {}) {
  if (isGlobalKey(key)) {
    return force
      ? { ok: true }
      : { ok: false, reason: 'protected', message: '全局主题是共享任务池，默认不能删除（确认要清空请加 --force）' };
  }
  if (isLiveWaiting(topic)) {
    return force
      ? { ok: true }
      : { ok: false, reason: 'waiting', message: '主题正在等待中，不能删除（确认要删请加 --force，agent 将超时收尾）' };
  }
  const pending = countPending(topic);
  // prune 只清"旧脏数据"，不是"删主题"：它不因未领取任务而跳过
  //（否则会改变 prune 既有语义——它本来就只清空主题/旧模型主题）。
  if (scope !== 'prune' && pending > 0 && !force) {
    return {
      ok: false,
      reason: 'has_pending',
      pending,
      message: `主题「${topic.name || key}」还有 ${pending} 条未领取任务，删除会一并丢掉（确认要删请加 --force）`,
    };
  }
  if (scope === 'prune' && topic.manual) {
    return { ok: false, reason: 'manual', message: '手动登记的目录不会被 prune 清理（请用 topic remove）' };
  }
  return { ok: true };
}

// 主题里还有多少条**未领取且未删除**的任务（= 还没人领的活）。
// 删除保护用它：队列里还堆着活就不该被一声不吭地清空。
function countPending(t) {
  if (!t || !Array.isArray(t.tasks)) return 0;
  return t.tasks.filter((x) => x.status !== 'consumed' && !x.deletedAt).length;
}

// 删除整个主题（连同其全部任务）。默认拒绝删除「等待中」主题——那会让正阻塞的
// agent 只能等到超时；force=true 才强删（agent 随后超时收尾）。
// 全局主题同样默认拒绝（共享池，删掉会让所有 worker 的候补来源消失）；
// force=true 清空全局任务池。
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
  // 删除判定只写一份（deleteGuard）：全局共享池 / 等待中 / 有未领取任务 → 都要 --force。
  const guard = deleteGuard(t, { force, key });
  if (!guard.ok) throw badInput(guard.message);
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
    // 判定与单删共用同一套规则（deleteGuard）——批量与单个的语义必须一致
    const g = deleteGuard(t, { force, key });
    if (!g.ok) {
      skipped.push({ key, name: t.name, cwd: t.cwd, reason: g.reason, pending: g.pending || 0 });
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
export async function reorderTasks({ cwd: rawCwd, key: rawKey, id, beforeId, afterId } = {}) {
  const key = resolveTaskKey({ key: rawKey, cwd: rawCwd });
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
    throw notFound(`主题（key ${key}）不存在`);
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
  return { status: 'ok', key, cwd: t.cwd || '', name: t.name, topic: topicView(t) };
}

// ─── 从远程清单导入任务 ────────────────────────────────────────────────
//
// 「提交方 → 远程清单 → 本地队列」这条链的最后一公里：把远程（KV 后端）上还没人领的
// 任务**搬进本机的任务队列**，让本机的 agent 能领到它。
//
// 导入完成即回填远程：那条远程任务标记为已完成，note 写明「被本地哪个队列领走了」
// （远程清单 topic=goal 的 #74：「当从全局任务导入完成过后，就直接把这个任务标记为
// 已经完成，然后返回提示就是说本地的某一个队列领取了这个任务」）。
//
// 顺序是刻意的：**先落本地，再标远程完成**。反过来（先标远程）一旦本地写失败，
// 任务就两头都没了 —— 提交方看不到、本机也没有。
//
// 依赖边界：远程通道住在 todo 模块（另一个 store，且要登录态）。这里用**动态 import**
// + fail-soft：没登录 / 远程不可达 → 明确报错，但**不牵连本地任务的其它功能**。
let todoMod = null;
async function todoService() {
  if (!todoMod) todoMod = await import('../todo/service.js');
  return todoMod;
}

/**
 * 合并两个来源的"要导入的远程任务内容"：**ref**（CLI 的 `--ref`，可给多次）与
 * **refs**（面板发的列表）。
 *
 * 为什么两个键：CLI 的 flag 叫 `--ref`（沿用 todo 模块"按内容定位"的约定），
 * 面板一次要导多条，发的是 `refs`；HTTP body 里未声明的键会原样透传，所以两个
 * 都可能到 action 的 ctx 里。**只认一个就会整批丢掉**——曾经只读 `ctx.ref`，
 * 面板那次导入静默地导了 0 条。
 *
 * 单独抽成纯函数是为了能单测（真跑导入要连远程后端，单测里连不上）。
 */
export function mergeImportRefs(refs, ref) {
  const a = Array.isArray(refs) ? refs : [];
  const b = Array.isArray(ref) ? ref : [];
  return [...a, ...b].map((r) => String(r ?? '').trim()).filter(Boolean);
}

/**
 * 从远程清单导入任务到本地队列。
 *
 * @param {object}  opts
 * @param {string}  [opts.cwd]     目标本地目录（不给则用当前目录）
 * @param {boolean} [opts.global]  true = 导入到全局共享池
 * @param {Array}   [opts.refs]    要导入的远程任务**内容整串**（面板发这个）
 * @param {Array}   [opts.ref]     同上，CLI 的 `--ref` 走这个键
 * @param {string}  [opts.topic]   远程主题（消歧用）
 * @param {number}  [opts.pick]    同内容多条时的编号（消歧用）
 * @param {number|string} [opts.groupId] 远程工作空间（缺省 = 当前）
 */
export async function importRemoteTasks({
  cwd: rawCwd,
  global: toGlobal = false,
  refs,
  ref,
  topic,
  pick,
  groupId,
} = {}) {
  const list = mergeImportRefs(refs, ref);
  if (!list.length) throw badInput('要导入的远程任务不能为空（按内容指定 --ref）');

  const todo = await todoService();
  // 远程这一侧：读当前工作空间的未完成任务（不含历史，面板轮询时才不会拉一坨 done 回来）
  const remote = await todo.listTodos({ status: 'open', groupId });
  const openTasks = Array.isArray(remote.open) ? remote.open : [];

  // 本地落点：先算清楚（global 优先；cwd 缺省用当前目录）
  const local = toGlobal
    ? { key: GLOBAL_KEY, name: GLOBAL_NAME, cwd: GLOBAL_CWD }
    : (() => {
        const n = normalizeCwd(rawCwd);
        return { key: n.key, name: n.name, cwd: n.cwd };
      })();

  const results = [];
  for (const ref of list) {
    const item = { ref: ref.slice(0, 60), imported: false, remoteDone: false };
    // 1) 定位远程那条（按内容；同内容多条时用 topic/pick 消歧，绝不替用户猜）
    let hit = null;
    try {
      hit = await todo.getTodo(ref, { topic, pick, groupId });
    } catch (e) {
      // 远程找不到（已被别人领走 / 内容写错）→ 如实报告这一条失败，其余照导
      item.error = String((e && e.message) || e);
      results.push(item);
      continue;
    }
    const remoteTask = hit && (hit.task || hit);
    const text = String((remoteTask && remoteTask.text) || ref);

    // 2) 先落本地
    const added = await addTask({ cwd: local.cwd, text, global: toGlobal });
    item.imported = true;
    item.localId = added.task.id;
    item.localTopic = added.topic && added.topic.name;

    // 3) 再把远程那条标完成，note 写明「本地的哪一个队列领走了它」
    try {
      await todo.doneTodo(text, {
        result: `已导入到本地队列「${item.localTopic || local.name}」（本地 #${added.task.id}）`,
        topic: remoteTask && remoteTask.topic ? remoteTask.topic : topic,
        pick,
        groupId,
      });
      item.remoteDone = true;
    } catch (e) {
      // 远程标完成失败：本地已经有这条了，**如实报告**（不能装作成功）
      item.error = `本地已导入，但远程标记失败：${String((e && e.message) || e)}`;
    }
    results.push(item);
  }

  const imported = results.filter((r) => r.imported).length;
  const remoteDone = results.filter((r) => r.remoteDone).length;
  return {
    status: imported ? 'ok' : 'nothing',
    target: { key: local.key, name: local.name, cwd: local.cwd, global: !!toGlobal },
    imported,
    remoteDone,
    failed: results.filter((r) => !r.imported).length,
    results,
    openCount: openTasks.length,
    // 人话提示（#74 要求的「本地的某一个队列领取了这个任务」）
    message: imported
      ? `已从远程导入 ${imported} 条到「${local.name}」；远程对应任务已标记完成 ${remoteDone} 条`
      : '没有导入任何任务',
  };
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
  const startStore = await loadStore();
  let sec;
  if (timeoutSec !== undefined && timeoutSec !== null) sec = timeoutSec;
  else if (timeoutMs !== undefined && timeoutMs !== null) sec = Number(timeoutMs) / 1000;
  else sec = startStore.settings.timeoutSec;
  const tmo = clampTimeoutSec(sec) * 1000;
  const suffix = startStore.settings.taskSuffix; // 返回任务时追加的收尾指令（本轮固定）

  // 1. 主题队列已有 pending → 立即取走，不开窗、不阻塞；记录本轮完成总结
  const queued = await consumeFirstPending(key, summary, by);
  if (queued) {
    return { status: 'ok', key, cwd, name, summary, task: withTaskSuffix(queued, suffix), queued: true, source: 'local', repo: repoCtx };
  }

  // 1b. 本地空 → 去全局主题（共享池）领。这是所有 wait 的**无条件默认兜底**：
  //     与是否显式传 --cwd 无关——本地取不到就一定来全局扫一眼，全局也没有才阻塞。
  //     （防止调用方习惯性传 cwd 导致共享池永远无人领取。）
  const fromGlobal = await consumeFirstPending(GLOBAL_KEY, summary, by);
  if (fromGlobal) {
    return {
      status: 'ok',
      key,
      cwd,
      name,
      summary,
      task: withTaskSuffix(fromGlobal, suffix),
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
  const deepLink = deepLinkUrl(key, cwd, panelInfo.port || DEFAULT_PORT);

  // 3. 结果承诺：三个生产者（同进程本地 waiter / 同进程全局 FIFO / 跨进程轮询）+ 超时
  let resolveOutcome;
  const outcome = new Promise((r) => {
    resolveOutcome = r;
  });
  waiters.set(key, {
    resolve: (task) => resolveOutcome({ kind: 'task', task, delivered: true }),
  });
  // 全局兜底：同进程有人 addTask({global:true}) 时按 FIFO 唤醒本 wait
  const unregisterGlobal = registerGlobalWaiter(
    (task) => resolveOutcome({ kind: 'task', task, delivered: true, source: 'global' }),
    summary,
    by
  );

  const poll = setInterval(() => {
    // 跨进程兜底轮询：先查本地，再查全局（本地优先；同轮至多 resolve 一次）
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

  // 时间目标到点 → 立刻收尾本轮（等的是"下一条任务"，预算用完了就没必要等）。
  // 与用户点「关闭等待」同一条出口：status:"timeout" + cancelled:true。
  // 只认"等待开始时还在跑"的目标（goalDeadlineMs>0）——已经过期的目标不参与。
  const goalPoll = setInterval(() => {
    if (goalDeadlineMs && Date.now() >= goalDeadlineMs) {
      resolveOutcome({ kind: 'cancelled', reason: 'goal_expired' });
    }
  }, POLL_MS);
  goalPoll.unref?.();

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

  let result;
  try {
    const r = await outcome;
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
            task: withTaskSuffix(r.task, suffix),
            delivered: r.delivered,
            queued: false,
            source: r.source || 'local',
            repo: repoCtx,
          };
  } finally {
    clearInterval(poll);
    clearInterval(cancelPoll);
    clearInterval(goalPoll);
    clearInterval(review);
    clearTimeout(timer);
    waiters.delete(key);
    unregisterGlobal();
    await clearWaiting(key);
  }
  return result;
}

// ─── 面板空闲自释放所需的观测接口（panel-guard.js 调用）────────────

// 当前有多少主题「真的在等待」——常驻面板的空闲自释放据此否决退出：
// 有 agent 正阻塞等人时，面板是唯一提醒来源，绝不能在此时释放。
//
// waiting 标志由 wait 进程写入、结束复位，跨进程可见；但 wait 被强杀（SIGKILL）时
// 标志会残留。判据统一走 isLiveWaiting（含「截止时刻已过 = 不算等待」这道闸）。
export async function countWaitingTopics() {
  const store = await loadStore();
  const now = Date.now();
  let n = 0;
  for (const t of Object.values(store.topics)) {
    if (isLiveWaiting(t, now)) n += 1;
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
    // 目录可能还不存在（全新机器 / CI runner：第一次跑就是干净的用户目录）。
    // 旧实现只 writeFileSync，ENOENT 被下面的 catch 静默吞掉——registerPanel
    // 表面上成功、实际一条没落盘，queryPanelPresence 因此永远发现不了非默认端口面板。
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify({ panels: list }, null, 2), 'utf8');
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

// 复查节奏与重开上限。抽到模块级是为了能被单测直接引用（不用起服务器）。
const REVIEW_MS = 5_000;
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

function panelOrigin(port) {
  return `http://127.0.0.1:${port || DEFAULT_PORT}`;
}

// 深链到面板「本地任务」页并选中当前主题（key 优先，cwd 兜底）。
// 端口取实际发现的面板（可能不是默认端口）。
function deepLinkUrl(key, cwd, port) {
  return `${panelOrigin(port)}/#/localtask?key=${encodeURIComponent(key)}&cwd=${encodeURIComponent(cwd)}`;
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
      // 截止时刻走 deadlineMsOf()：优先毫秒精度的 waitingUntilMs，老数据才解析字符串。
      // 之前这里自己解析 waitingUntil（秒级），短时限下截断误差会让「正在等」被判成
      // 「没在等」→ 事件流永远推不出 waiting（tests/unit/localtask-sse.test.mjs 曾
      // 因此有 ~4% 的 flake）。
      const deadline = deadlineMsOf(t);
      const isWaiting = !!t.waiting && Number.isFinite(deadline) && deadline > now;
      let st = state.get(t.key);

      if (isWaiting) {
        // 「是不是新一轮等待」用**毫秒精度的 deadline** 判定：waitingUntil 字符串只有
        // 秒级，同一秒内开始的两次等待字符串相同，靠它判会漏掉新一轮。
        if (!st || st.phase !== 'waiting' || st.deadline !== deadline) {
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
            isGlobal: isGlobalKey(t.key),
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
            isGlobal: isGlobalKey(t.key),
            waitingUntil: t.waitingUntil,
            remainSec: sec,
            remainMs: Math.max(0, st.deadline - now),
            label: `${sec}s`,
          };
        }
      } else if (st && st.phase === 'waiting') {
        const outcome = consumedCount(t) > st.consumed0 ? 'delivered' : 'timeout';
        state.set(t.key, { phase: 'ended' });
        yield { type: 'resolved', key: t.key, cwd: t.cwd || '', name: t.name || '', isGlobal: isGlobalKey(t.key), outcome };
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
            isGlobal: isGlobalKey(t.key),
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
    // 断线重连提示（浏览器 EventSource 默认 3s 重连，这里写明确一点）。
    // 对齐 opencode 的 SSE 加固做法（event.ts:21-28）。
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(': connected\n\n');
  // addEventStreamConn 内部已把 conn 加入 sseConns（panelPresence 据此统计活标签），
  // 我们不再直接引用——心跳 / 失败剔除 / 断开清理都由它托管。
  addEventStreamConn(req, res);
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  let seq = 0;
  try {
    for await (const ev of watchEvents({ cwd, key, signal: ac.signal })) {
      // 单调 id：浏览器重连后可带着 Last-Event-ID 回来（这里只保证不重复，
      // 事件本身是从 store 派生的，重放也不会串）。
      seq += 1;
      res.write(`id: ${seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    }
  } catch {
    /* 客户端断开 / 瞬时读盘错误，静默结束 */
  }
}

// CLI 传输：**逐行 NDJSON**（一行一个事件），与 HTTP 的 SSE 同源（都用 watchEvents）。
//
// 以前 CLI 跑 `localtask events` 必崩：那条 action 原本只做 SSE，
// 直接摸 `ctx.__raw.req` —— 而 `__raw` 只在 HTTP 传输下才注入，CLI 进程里是 undefined。
// 现在按传输方式分流，CLI 这条命令真能用（CHANGELOG 当初承诺的「CLI 等价逐行 NDJSON」）。
//
// 它是**长连**：命令会一直打印到用户 Ctrl+C（stdout 被关闭即结束）。
export async function streamEventsNDJSON({ cwd, key, signal, timeoutSec, limit } = {}) {
  const ac = new AbortController();
  // agent 需要能**给这条长连划个边界**：gh run watch 有 --exit-status / --interval，
  // 这里给 --timeout（最长监听多少秒）与 --limit（最多几条事件）。都不给就是无限流。
  const timer =
    Number.isFinite(timeoutSec) && timeoutSec > 0 ? setTimeout(() => ac.abort(), timeoutSec * 1000) : null;
  let n = 0;
  try {
    for await (const ev of watchEvents({ cwd, key, signal: signal || ac.signal })) {
      process.stdout.write(`${JSON.stringify(ev)}\n`);
      n += 1;
      if (Number.isFinite(limit) && limit > 0 && n >= limit) break;
    }
  } catch {
    /* Ctrl+C / 管道断开：静默收尾 */
  } finally {
    if (timer) clearTimeout(timer);
  }
}
