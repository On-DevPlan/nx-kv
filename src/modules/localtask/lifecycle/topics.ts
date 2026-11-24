// （#54 自 service.js 拆出）主题级操作：设置视图/更新、目录登记（manual 常驻）、
// 总览（listTasks，全局池置顶）、prune 旧脏数据（与删除共用 deleteGuard 一套判定）。
//
// T03：存储切到 repo/（SQLite）。本文件不再直接读写任何存储形状 ——
// 读走 repo.topics 的 JSON 形态投影，写走窄方法（一个动作一个事务）。
import { existsSync } from 'node:fs';
import { badInput } from '../../../core/errors.js';
import { normalizeCwd } from '../paths.js';
import { normalizeSummary } from '../infra/store-io.js';
import { openLocaltaskStore as openStore, topics as topicsRepo, settings as settingsRepo, txw as tx } from '../infra/repo/index.js';
import { DEFAULT_TIMEOUT_SEC, MAX_TIMEOUT_SEC } from '../infra/repo/settings.js';
import { foreignResolver, isPending, topicView } from './task-view.js';
import { stripFrontmatter } from '../../../shared/frontmatter.js';
import { deleteGuard } from './deletion.js';
import { repoContextIndex, repoCtxOf } from '../infra/repo-ctx.js';
import { topicKeyOf } from '../../../core/topic-key.js';

/** addTopic / pruneTopics 等主题操作的入参（HTTP/CLI body → any）。 */
export type TopicOpInput = any;

/** pendingQueueInfo 单条条目。 */
export interface PendingQueueItem {
  id: number;
  title: string;
  topic: string;
}

/** pendingQueueInfo 的出站形状。 */
export interface PendingQueueInfo {
  topic: string;
  count: number;
  list: PendingQueueItem[];
}

// ─── 目录登记（面板「添加目录」）────────────────────────────────────
//
// wait/add 也会建主题，但那是**被动**创建：空主题会被 prune 当脏数据清掉。
// 手动登记的目录要能常驻（用户想先占个位、之后再绑 timegoal / 排任务），
// 所以打 `manual:true` 标记，prune 一律跳过。重复登记幂等（已存在则只刷新标记）。
export async function addTopic({ cwd: rawCwd, summary: rawSummary }: { cwd?: string; summary?: string } = {}): Promise<Record<string, any>> {
  if (rawCwd === undefined || rawCwd === null || !String(rawCwd).trim()) {
    throw badInput('需要 --cwd "<工作目录>"');
  }
  const { key, cwd, name } = normalizeCwd(rawCwd);
  const summary = normalizeSummary(rawSummary, { optional: true });
  openStore();
  const existed = !!topicsRepo.getTopicRow(key);
  // --summary：登记时顺带写「现状摘要」（面板顶栏那一句的编辑入口也走这里）。
  // 写进 submitSummary（提交方字段），不碰 agent 的 summary——与 add --summary 同一约定。
  tx(() => {
    topicsRepo.ensureTopic(key, { cwd, name });
    topicsRepo.updateTopic(key, { manual: true, submitSummary: summary || '' });
  });
  return { status: 'ok', existed, key, name, cwd, topic: topicView(topicsRepo.getTopic(key)) };
}

// 总览：返回全部主题（面板据此分组展示与回填）+ 超时设置，按最近更新排序；
// 全局主题永远置顶（共享池是所有 worker 的候补来源，放最显眼处）。
//
// 注意：**全局主题不在这里凭空造**。全局池空着的时候库里就是没有它
// 占位，保证用户永远找得到往全局池加任务的入口——服务层的契约保持原样。
export async function listTasks(): Promise<Record<string, any>> {
  openStore();
  // 仓库上下文一次读一张表（逐主题读文件太浪费）
  const repoIndex = await repoContextIndex();
  const readyOpts = { resolveForeign: foreignResolver() };
  const topics = topicsRepo
    .listTopics()
    .map((t) => topicView(t, repoCtxOf(repoIndex, t.cwd), readyOpts))
    .sort(
      (a, b) =>
        String(b.updatedAt).localeCompare(String(a.updatedAt))
    );
  return {
    topics,
    waiting: topics.filter((t) => t.waiting).length,
    settings: settingsRepo.settingsView(),
  };
}

export async function getSettings(): Promise<Record<string, any>> {
  openStore();
  return settingsRepo.settingsView();
}

// 清理旧脏数据：只动「非等待中」的主题——
//   1) 旧模型迁移来的无 cwd 主题（“旧数据，无目录”）；
//   2) 空主题（没有任何任务）；
//   3) allFinished 时，连同「已全部领取、无待领」的主题一起清；
//   4) missingDir 时，清「cwd 已不存在且没有待领任务」的主题
//      （删掉的临时目录 / 测试残留；外接盘没挂载也会命中，所以必须显式开）。
// 等待中的主题与全局主题一律保留；dryRun 只报告不改动。
//
// **僵尸等待标志不算"等待中"**：wait 被强杀后残留的 waiting:true 会让主题
// 永远躲过清理（gs-ac 就这么卡住的）。用 isLiveWaiting 判定——截止已过 = 没人
// 在等 = 可以清。
export async function pruneTopics({
  allFinished = false,
  dryRun = false,
  missingDir = false,
}: { allFinished?: boolean; dryRun?: boolean; missingDir?: boolean } = {}): Promise<Record<string, any>> {
  openStore();
  const removed: Array<{ key: string; name: string; cwd: string; reason: string }> = [];
  for (const t of topicsRepo.listTopics()) {
    // prune 走同一套判定（scope:'prune'）：全局共享池 / 等待中 / 手动登记 → 保留。
    // （prune 是"清旧脏数据"，不因未领取任务而跳过——它本来就只清空主题/旧模型主题。）
    if (!deleteGuard(t, { force: false, key: t.key, scope: 'prune' }).ok) continue;
    const tasks = t.tasks;
    const hasPending = tasks.some(isPending);
    const isLegacy = !t.cwd;
    const isEmpty = tasks.length === 0;
    const isFinished = allFinished && tasks.length > 0 && !hasPending;
    const cwdGone = missingDir && !!t.cwd && !hasPending && !existsSync(String(t.cwd));
    if (isLegacy || isEmpty || isFinished || cwdGone) {
      const reason = isLegacy
        ? '旧模型无目录'
        : isEmpty
          ? '空主题'
          : cwdGone
            ? '目录已不存在'
            : '已完成无待领';
      removed.push({ key: t.key, name: t.name || t.key, cwd: t.cwd || '', reason });
    }
  }
  if (!dryRun) {
    for (const r of removed) topicsRepo.deleteTopic(r.key);
  }
  return { status: 'ok', dryRun: !!dryRun, count: removed.length, removed };
}

/**
 * updateSettings 的入参（全部可选）。
 *
 * #152 起只剩两个真正可写的键：提示词模板正文的唯一真相搬到了插件类
 * （modules/promptplug/plugins/*.ts 的 `templates`），DB 不再存模板，
 * 因此 ackPrompt / deliveryTemplate / attachTemplate / blockTemplates 四个
 * 写入通道一并删除（旧值也不再读取）。
 */
export interface UpdateSettingsInput {
  timeoutSec?: unknown;
}

// 配置等待超时（页面可调）。超时推荐 180=3 分钟、最大 600=10 分钟。
export async function updateSettings({ timeoutSec }: UpdateSettingsInput = {}): Promise<Record<string, any>> {
  const hasTimeout = timeoutSec !== undefined && timeoutSec !== null;
  if (!hasTimeout) {
    throw badInput('请指定 --timeout <秒>（追加模式已固定为 XML，不再可配）');
  }
  if (hasTimeout) {
    const n = Number(timeoutSec);
    if (!Number.isFinite(n) || n <= 0) {
      throw badInput(`超时时间需为 1-${MAX_TIMEOUT_SEC} 秒（推荐 ${DEFAULT_TIMEOUT_SEC}）`);
    }
  }
  openStore();
  settingsRepo.setLtSettings({
    timeoutSec: hasTimeout ? timeoutSec : undefined,
  });
  return settingsRepo.settingsView();
}

/** 任务标题 = 去掉 frontmatter 后的首个非空行（去前导 #，截 80 字）。 */
function taskTitleOf(row: any): string {
  const body = String(stripFrontmatter(String((row && row.text) || ''))).trim();
  const first = body.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  const title = first.replace(/^#+\s*/, '').trim().slice(0, 80);
  return title || `任务 #${Number(row && row.id) || ''}`;
}

/**
 * ext 区块数据：**同一主题**里仍处于 pending 的任务（不含当前刚领走的这条）。
 *
 * 范围口径：只看这条目录队列（global 任务看共享池），不跨主题汇总——agent 的
 * 「还能领多少」指它接下来会从哪个队列取活，混进别的主题会虚报余量。
 * 统计所有活跃 pending（含暂时被依赖挡住的），与面板上的 pending 数同口径；
 * 「待领取」是队列里还压着的活，不只是此刻 ready 的活。
 *
 * 现算而不缓存：一次 getTopic + 内存过滤（同主题通常几十条），而队列会被面板 /
 * 其他进程随时写入，缓存要么过期、要么还得做跨进程失效，代价高于这次读。
 *
 * @param {string} key 主题 key
 * @param {number} [excludeId] 当前正在领取的任务号（不计入余量）
 * @returns {Promise<{topic:string,count:number,list:Array<{id:number,title:string,topic:string}>}>}
 */
export async function pendingQueueInfo(key: string, excludeId?: number | string): Promise<PendingQueueInfo> {
  openStore();
  const t = topicsRepo.getTopic(String(key || ''));
  if (!t) return { topic: '', count: 0, list: [] };
  const exclude = Number(excludeId) || 0;
  const topic = t.name || t.key || '';
  const list: PendingQueueItem[] = (t.tasks || [])
    .filter((x: any) => isPending(x) && Number(x.id) !== exclude)
    .map((x: any) => ({ id: Number(x.id) || 0, title: taskTitleOf(x), topic }));
  return { topic, count: list.length, list };
}

// ─── #199：仓库/组登记时自动持有自己的 topic（幂等）─────────────────────────
//
// 口径：**一个仓库 = 一条目录队列 topic**（cwd=仓库登记路径），**一个组 = 一条组 topic**
// （key=group:<组key>）。登记时就建好，侧栏/命令行就不用再「按目录猜队列」；
// 删除仓库/组时不用手工收尾——topics.repo_key 是 ON DELETE CASCADE，跟着一起走。
//
// SQLite **不支持条件外键**（外键不能带 WHERE），所以「每个仓库必须有且只有一条队列」
// 这种父→子的存在性约束只能靠这里保证：登记时 ensure（本函数）+ 编排后自动刷新
// （syncQueuesQuiet）+ 「仓库管理」页的「刷新队列」按钮（同一个 syncQueues）。

/** 仓库登记后建/取其目录队列 topic。 */
export function ensureRepoQueue({ repoKey, cwd, name }: { repoKey: string; cwd: string; name?: string }): { topicId: number; key: string } {
  const rk = String(repoKey || '').trim();
  const dir = String(cwd || '').trim();
  if (!rk) throw badInput('ensureRepoQueue: 需要仓库 key');
  if (!dir) throw badInput('ensureRepoQueue: 需要仓库登记路径');
  openStore();
  const key = topicKeyOf(dir, '');
  const t = topicsRepo.ensureTopic(key, { cwd: dir, name: name || '', repoKey: rk });
  return { topicId: Number(t.id), key };
}

/** 组登记后建/取其组 topic（key=group:<组key>）。 */
export function ensureGroupQueue({ groupKey, name }: { groupKey: string; name?: string }): { topicId: number; key: string } {
  const gk = String(groupKey || '').trim();
  if (!gk) throw badInput('ensureGroupQueue: 需要组 key');
  openStore();
  const t = topicsRepo.ensureGroupTopic(gk, name || '');
  return { topicId: Number(t.id), key: t.key };
}

/**
 * 补齐老库缺的队列 topic（幂等）：遍历已登记仓库/组，缺的补建。
 * 返回值便于 CLI/日志核对；重复调用无副作用。
 *
 * 直接查 repos 表（同库，不经 repos service）——避免 localtask→repos 的运行时耦合：
 * 这里只需要 key / path / name 三个字段，拿「旧 JSON store 快照」是杀鸡用牛刀。
 */
export async function syncQueues(): Promise<{ repos: number; groups: number }> {
  openStore();
  return tx((conn) => {
    let r = 0;
    let g = 0;
    for (const repo of conn.all("SELECT key, path, name FROM repos WHERE type = 'repo' AND path <> '' AND deleted_at IS NULL")) {
      const rk = String(repo.key || '');
      const cwd = String(repo.path || '');
      if (!rk || !cwd) continue;
      const before = conn.get('SELECT id FROM topics WHERE key = :k', { k: topicKeyOf(cwd, '') });
      ensureRepoQueue({ repoKey: rk, cwd, name: String(repo.name || '') });
      if (!before) r += 1;
    }
    for (const b of conn.all("SELECT key, name FROM repos WHERE type = 'group' AND deleted_at IS NULL")) {
      const gk = String(b.key || '');
      if (!gk) continue;
      const before = conn.get('SELECT id FROM topics WHERE key = :k', { k: `group:${gk}` });
      ensureGroupQueue({ groupKey: gk, name: String(b.name || '') });
      if (!before) g += 1;
    }
    return { repos: r, groups: g };
  });
}

/**
 * 编排（登记 / 加组成员 / 移除 / 删除）后的自动刷新：补齐队列，失败**不拦主操作**。
 *
 * 编排是用户正在做的事，队列只是配套资源——补建失败不该让「加成员」报错；
 * 失败的缺口由「仓库管理」页的「刷新队列」按钮兜（同一份 syncQueues）。
 */
export async function syncQueuesQuiet(): Promise<{ repos: number; groups: number }> {
  try {
    return await syncQueues();
  } catch {
    return { repos: 0, groups: 0 };
  }
}
