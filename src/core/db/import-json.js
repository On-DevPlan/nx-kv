// 一次性 JSON → SQLite 全量导入（legacy `~/.nx-kv/*.json` → nxkv.db）。
//
// ── 三条不可动摇的原则 ────────────────────────────────────────────────
//
// 1. **一次性全量**。代码迁移可以分批，数据迁移不能：FK 决定 `topics.repo_key →
//    repos.key`，先迁 tasks 再迁 topics 会被外键当场拒绝。
//
// 2. **全在一个事务里**。任何一步失败 → `ROLLBACK` → legacy JSON **一个字节不动** →
//    写失败明细日志 → 退出码 2。半成品库比没有库更糟：它会看起来能用。
//
// 3. **时间字段分三种精度**（见 core/db/time.js）：localTasks/timegoals 是
//    "YYYY-MM-DD HH:mm:ss"（本地），repos 是 ISO（UTC），等待截止是数字。
//    用 `new Date(str)` 解析本地串会整体偏 8 小时，且**不报错**。
//
// ── 状态映射：5 步嵌套判据（顺序即优先级，命中即止）──────────────────
//
//   1. deletedAt 非空            → 写 deleted_at；**状态继续往下判**（软删与状态正交）
//   2. status === 'pending'     → pending      # 即使带 roundSummary 也是 pending
//   3. status === 'consumed'    → roundSummary 非空 ? done : claimed
//   4. status === 'archived'    → roundSummary 非空 ? done : cancelled（+ ext_archived）
//   5. 其它（含未知）            → pending + 报告
//
// **为什么判据必须嵌套在 status 里，不能全局先判 roundSummary**：
// 本机 8 条 `pending` 任务**全都带 `roundSummary` 键**（值是空串 —— 就地重开时被
// 清成 "" 而不是删键），另有 62 条 `consumed` 且值非空。一旦把
// 「roundSummary 非空 → done」提到 status 前面，或写成 `'roundSummary' in t`，
// 这 8 条待领取任务就会被判成已完成、永远领不到，**而且不报错**。
// `completedAt` 在本机 0 条有值（7 条是空串键），它是在老数据之后才加的字段，
// 所以只能在真有值时用来填 done_at，**不能当完成判据**。
//
// ── 迁移口径（与 docs/research/SQLITE-REFACTOR.md §6 对齐，差异见行内注释）──
//
// · 哨兵仓库 `__unbound__`：legacy 队列全都对不上真实仓库（key 是目录名 sha1），
//   全局池 `__GLOBAL__` 也挂它下面；`cwd = ''`。不伪造 repo key、不放松 NOT NULL。
// · `boards` → `repos(type='group')`，key = `group/<slug(初始 name)>`（冻结，
//   name 之后可改），旧 `b_xxx` 存 `ext.ext_legacy_id`。
// · `consumedAt → claimed_at`（75/75 有值，它就是领取时刻）。
// · `roundSummary → feedback`（同一个东西：干完回一句话说结果）。
// · `claimedFrom/By/ByName`、`remote` 不迁移；`migratedTo` 作为**迁出墓碑**保留
//   （丢了它，已搬到云端、本机还挂着 pending 的那条会被当成待领取复活）。
// · `tasks.seq` 保持原 `id`（对外编号不能漂），`topics.next_seq = max(seq)+1`。
// · 内嵌 `timegoal`（本机 7 条**值全是 null**，实际 0 条）→ `goals` + `goal_checks`；
//   队列级 timegoal 丢弃并报告。
//
// 实现按导入管线阶段拆在 import-json/ 子目录：data（常量与纯函数）→ scan（探测）
// → repos → tasks → links（边与独立目标）→ refs → extras（模板与设置）。
// 本文件只保留主入口与事务内自检；公共 API 全部从这里 re-export，import 路径不变。
import { join } from 'node:path';
import { topicKeyOf } from '../topic-key.js';
import { nowMs } from './time.js';
import { setMeta } from './migrator.js';
import { emptyReport } from './import-json/data.js';
import { scanLegacy } from './import-json/scan.js';
import { importRepos } from './import-json/repos.js';
import { importTopicsAndTasks } from './import-json/tasks.js';
import { importLinksAndDeps, importStandaloneGoals } from './import-json/links.js';
import { importRefs } from './import-json/refs.js';
import { importSettings, importTemplates } from './import-json/extras.js';

export {
  CONFIG_PREF_KEYS,
  LEGACY_FILES,
  LOCALTASK_SETTING_KEYS,
  MAX_BODY,
  SENTINEL_REPO_KEY,
  SENTINEL_REPO_NAME,
  emptyReport,
  legacyDurationSec,
  mapLegacyStatus,
  parseTaskRef,
  refIdOf,
} from './import-json/data.js';
export { scanLegacy } from './import-json/scan.js';
export { ensureSentinelRepo } from './import-json/repos.js';
export { listDocFiles } from './import-json/refs.js';

/**
 * 导入自检（**同事务内跑**，读得到自己未提交的写）。
 *
 * 依据设计文档 §6.5：任何一项不匹配就整体回滚、legacy JSON 一字节不动。
 * 放在事务里而不是提交后，是因为"提交完再校验"在失败时无法回滚已经落盘的数据。
 *
 * 逐项：
 *   1. 行数：legacy 任务数 == 库内任务数（seq 一一对应的前提）
 *   2. topics.key = topicKeyOf(cwd, group_key)（派生列不能漂）
 *   3. next_seq > max(seq)（编号只增不减）
 *   4. 词表语义：done 有 done_at 与 feedback；claimed 有 claimed_at 且无 done_at；
 *      pending 无 done_at
 *   5. `PRAGMA foreign_key_check` 空集
 *
 * 正文哈希不在这一步：body 就是本条代码从 text 直接写进去的，比了也是自证。
 * 它留给 `db verify`（那时是与磁盘上的 JSON 对账，才是真校验）。
 */
function validateImport(conn, { expectedTasks }) {
  const problems = [];
  const taskCount = Number((conn.get('SELECT count(*) AS c FROM tasks') || {}).c || 0);
  if (taskCount !== expectedTasks) {
    problems.push(`任务行数 ${taskCount} ≠ legacy ${expectedTasks}`);
  }

  const topics = conn.all('SELECT id, key, cwd, group_key, next_seq FROM topics');
  for (const t of topics) {
    const expect = topicKeyOf(t.cwd, t.group_key || '');
    if (expect !== t.key) problems.push(`队列 ${t.id} 的 key 不是 (cwd,group) 的派生值`);
    const row = conn.get('SELECT max(seq) AS m, count(*) AS c FROM tasks WHERE topic_id = :id', { id: t.id });
    const maxSeq = Number((row && row.m) || 0);
    const cnt = Number((row && row.c) || 0);
    if (cnt > 0 && Number(t.next_seq) <= maxSeq) {
      problems.push(`队列 ${t.id} 的 next_seq=${t.next_seq} ≤ max(seq)=${maxSeq}`);
    }
  }

  const doneBad = Number(
    (
      conn.get(
        "SELECT count(*) AS c FROM tasks WHERE status = 'done' AND (done_at IS NULL OR feedback = '')"
      ) || {}
    ).c || 0
  );
  if (doneBad) problems.push(`done 行缺 done_at/feedback：${doneBad} 条`);
  const claimedBad = Number(
    (
      conn.get(
        "SELECT count(*) AS c FROM tasks WHERE status = 'claimed' AND (claimed_at IS NULL OR done_at IS NOT NULL)"
      ) || {}
    ).c || 0
  );
  if (claimedBad) problems.push(`claimed 行语义不符：${claimedBad} 条`);
  const pendingBad = Number(
    (conn.get("SELECT count(*) AS c FROM tasks WHERE status = 'pending' AND done_at IS NOT NULL") || {}).c || 0
  );
  if (pendingBad) problems.push(`pending 行有 done_at：${pendingBad} 条`);

  const fk = conn.all('PRAGMA foreign_key_check');
  if (fk.length) problems.push(`外键违规 ${fk.length} 处`);

  if (problems.length) {
    throw new Error('导入自检失败（已回滚）：' + problems.slice(0, 8).join('；'));
  }
}

/**
 * 全量导入（**必须在事务内调用**）。
 *
 * @param {object} db 连接
 * @param {object} opts
 * @param {string} opts.appDir legacy 数据所在目录（`~/.nx-kv`）
 * @param {string} [opts.docsDir] docs 树根（默认 appDir/docs）
 * @param {number} [opts.atMs] 无时间可依时的兜底时刻
 * @returns {object} 报告
 */
export function importLegacy(db, { appDir, docsDir, atMs = nowMs() } = {}) {
  if (!appDir) throw new TypeError('importLegacy 需要 appDir');
  const report = emptyReport();
  const { files, any } = scanLegacy(appDir);
  for (const [kind, r] of Object.entries(files)) {
    if (r && r.ok) report.sources.push({ kind, path: r.path });
    else if (r && r.error) report.warnings.push({ what: 'legacy', why: `读取/解析失败：${r.error}`, path: r.path });
  }
  if (!any) {
    report.warnings.push({ what: 'legacy', why: '没有找到任何 legacy JSON（全新建库）' });
    return report;
  }

  const reposData = files.repos && files.repos.ok ? files.repos.data : null;
  const localtasksData = files.localtasks && files.localtasks.ok ? files.localtasks.data : null;

  // 期望的任务总数：**从 legacy 里数**，不是从写进去的行数里数 —— 后者永远相等。
  let expectedTasks = 0;
  for (const t of Object.values((localtasksData && localtasksData.topics) || {})) {
    expectedTasks += Array.isArray(t && t.tasks) ? t.tasks.length : 0;
  }

  // 顺序即外键依赖：repos（含哨兵）→ members → topics → tasks → links/deps → goals
  //                → refs/bindings → templates/settings
  importRepos(db, reposData, atMs, report);
  const { byLegacyKey } = importTopicsAndTasks(db, localtasksData, atMs, report);
  importLinksAndDeps(db, localtasksData, byLegacyKey, atMs, report);
  if (files.timegoals && files.timegoals.ok) importStandaloneGoals(db, files.timegoals.data, byLegacyKey, report);
  importRefs(db, reposData, docsDir || join(appDir, 'docs'), atMs, report);
  if (files.templates && files.templates.ok) importTemplates(db, files.templates.data, atMs, report);
  importSettings(
    db,
    localtasksData,
    files.config && files.config.ok ? files.config.data : null,
    atMs,
    report
  );

  validateImport(db, { expectedTasks });

  setMeta(db, 'migrated_from_json_at', String(atMs), atMs);
  return report;
}
