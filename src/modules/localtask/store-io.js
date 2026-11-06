// （#54 自 service.js 拆出）store 读写层：localtasks.json 的加载/原子落盘 + 损坏隔离
// （.corrupt-*）+ 主题桶/任务行原语（topicOf/nextTaskId）+ 基础输入校验（summary/text）
// 与时间工具（stampNow/parseStampMs）。
// 任务 #66：读写的「串行队列 + 原子写 + EPERM 退避 + 损坏隔离」已收口到
// core/json-store.js（SQLite 迁移时只换那一层的 driver），这里只剩本 store 的
// 白名单重建 / v1/v2 迁移语义。
import { basename } from 'node:path';
import { badInput } from '../../core/errors.js';
import { createJsonStore } from '../../core/json-store.js';
import { DEFAULT_TASK_SUFFIX, clampTaskSuffixList, clampAckPromptList, clampDeliveryTemplate, clampAttachTemplate } from './task-templates.js';
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

// 损坏隔离 / 串行写队列 / tmp+rename 原子写 / EPERM 退避——全部由 createJsonStore
// 统一提供（CORRUPT_KEEP=3：坏文件改名 .corrupt-* 最多留 3 份，防止下次 save 原地
// 覆盖把数据无声清零）。这里只保留本 store 独有的语义：
//   - legacy 兜底（改用 topics.json 前的旧文件，一次性迁移读取）
//   - v2 slots / v1 sessions 桶 → topics 的版本迁移
//   - settings 白名单式重建（未列出的字段在读时被丢掉，新增设置项必须补一行）
function normalizeRawStore(data) {
  if (!data || typeof data !== 'object') return null; // 形状不认识 ≠ 文件损坏 → 落 empty，不隔离
  let topics = null;
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
  if (!topics) return null;
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : null;
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
      ackPrompt: settings && Object.prototype.hasOwnProperty.call(settings, 'ackPrompt')
        ? clampAckPromptList(settings.ackPrompt)
        : [],
      // 交付上下文模板（#62）/ 附件段提示词（#82）：字段存在才认，缺省 = 空（用内置默认）。
      // ⚠️ 白名单里必须有这两个键——之前 deliveryTemplate 漏在这里，写盘成功、读时被
      // 剥掉，serve 重启即静默丢失（#82 两进程实测抓到）。
      deliveryTemplate: settings && Object.prototype.hasOwnProperty.call(settings, 'deliveryTemplate')
        ? clampDeliveryTemplate(settings.deliveryTemplate)
        : '',
      attachTemplate: settings && Object.prototype.hasOwnProperty.call(settings, 'attachTemplate')
        ? clampAttachTemplate(settings.attachTemplate)
        : '',
    },
    topics,
  };
}

const store = createJsonStore({
  path: storePath,
  empty: emptyStore,
  normalize: normalizeRawStore,
  legacyPath: legacyStorePath,
  quarantineKeep: 3,
});

export async function loadStore() {
  return store.load();
}

/** @public 供 SnapshotStore topic-adapter 原子落盘（与内部写路径同一队列，由 json-store 提供） */
export function saveStore(data) {
  return store.save(data);
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

// 外部写（不经引擎 Mutator）落盘前把主题的 workflowRevision 顶一格。
// 为什么必须：引擎侧落盘有 revision CAS（saveAtomic），但这条 CAS 只对「引擎自己的写」
// 成立——外部改任务行（设 blockBy / 领取 / 完成 / 删除）不动 revision，引擎**在途**的
// 过期快照（scheduler 定时器 / close 没等到的 runOnce）落盘时 CAS 照样通过，
// applySnapshotToTopic 会把过期边**重建**回全队列 blockBy，把刚写进去的依赖洗掉
// （现场：CI 上 localtask-attribution「历史脏数据但带本地依赖」偶发搬家，就是依赖被
// 在途写洗空后守卫放行）。顶一格让过期快照必然 CAS 冲突 → fail-open 丢弃；
// 引擎写全是任务行的可重投影，丢了无副作用，下一次 sync 会按新任务行重新投影。
export function bumpWorkflowRevision(topic) {
  if (!topic) return;
  topic.workflowRevision = (Number(topic.workflowRevision) || 0) + 1;
}
// "YYYY-MM-DD HH:mm:ss"（本地）→ epoch ms；无法解析返回 NaN
export function parseStampMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}
