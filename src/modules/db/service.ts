// 存储子命令的实现（`nx-kv db …`）。
//
// 三条约定与其它模块一致：
//   1. **失败抛 AppError，正常结果返回对象** —— 由 runtime/cli.js 统一渲染；
//   2. 每个 action 都复用 `core/db/bootstrap.js` 的同一个 `bootstrap()`：
//      迁移逻辑只有一份，CLI 与「启动时自动迁移」不可能给出两个不同的库；
//   3. 这里的函数是 `async`（便于 CLI 调用方统一 await），但**内部只有同步 DB 调用**
//      —— 需要异步 I/O 时在事务外做（本文件没有异步 I/O）。
import { existsSync } from 'node:fs';
import { APP_DIR } from '../../core/paths.js';
import { openStore, closeDb, dbPath, getBootstrapResult } from '../../core/db/index.js';
import {
  archiveLegacyFiles,
  backupsDir,
  inspectStore,
  removeDbFiles,
} from '../../core/db/bootstrap.js';
import { backupDatabase, fileHasContent, getMeta } from '../../core/db/migrator.js';
import { tableCounts, statusDistribution, verifyStore } from '../../core/db/verify.js';
import { CURRENT_SCHEMA_VERSION, REQUIRED_NODE_VERSION } from '../../core/db/version.js';
import { nowMs, stampFileTag } from '../../core/db/time.js';

/** 任务状态分布（tasks.status → 行数）。 */
export type Distribution = Record<string, number>;

/** `db status` 的结果形状。 */
export interface StatusShape {
  path: string;
  exists: boolean;
  dbFileExists: boolean;
  node: string;
  requiredNode: string;
  currentSchemaVersion: number;
  storeKind: string | null;
  userVersion: number;
  tables: number;
  counts: Record<string, number>;
  distribution: Distribution;
  migratedFromJsonAt: string | null;
  backupsDir: string;
  appDir: string;
}

/** legacy JSON 改名后的一条记录。 */
export interface ArchivedEntry {
  from: string;
  to: string;
}

/** `db migrate` 的结果形状（dry-run / 正常两态共用一个宽形状）。 */
export interface MigrateShape {
  action: string;
  path: string;
  existed: boolean;
  schemaVersion: number;
  planned?: string | null;
  report?: any;
  upgradedFrom?: number | null;
  backup?: string | null;
  archived?: ArchivedEntry[];
  counts?: Record<string, number>;
  distribution?: Distribution;
}

/** 单条校验项。 */
export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

/** `db verify` 的结果形状。 */
export interface VerifyShape {
  ok: boolean;
  checks: VerifyCheck[];
  counts: any;
  distribution: Distribution;
  state: any;
}

/** `db backup` 的结果形状。 */
export interface BackupShape {
  path: string;
  removed: string[];
  dir: string;
  keep: number;
  version: number;
}

/**
 * 库状态。**不触发升级**（只读连接）：`db status` 是诊断命令，不该改任何东西。
 * 库文件不存在时会建一个空库（首次使用 `nx-kv db status` 就能看到 schema_version），
 * 但**不做 JSON 导入** —— 导入必须显式 `db migrate`。
 */
export async function status(): Promise<StatusShape> {
  const path = dbPath();
  const existed = fileHasContent(path);
  if (existed) {
    // 只读打开：能看版本、能看行数，但不会建表/升级/导入
    const db: any = openStore({ readOnly: true, importLegacyData: false });
    return shapeStatus(db, path, { existed });
  }
  const db: any = openStore({ importLegacyData: false });
  return shapeStatus(db, path, { existed });
}

function shapeStatus(db: any, path: string, { existed }: { existed: boolean }): StatusShape {
  const state: any = inspectStore(db);
  const counts: Record<string, number> = state.tables > 0 ? tableCounts(db) : {};
  const distribution: Distribution = state.tables > 0 ? statusDistribution(db) : { pending: 0, claimed: 0, done: 0, cancelled: 0 };
  const migratedFromJsonAt = state.hasMeta ? getMeta(db, 'migrated_from_json_at') : null;
  return {
    path,
    exists: existed,
    dbFileExists: existsSync(path),
    node: process.versions.node,
    requiredNode: REQUIRED_NODE_VERSION,
    currentSchemaVersion: CURRENT_SCHEMA_VERSION,
    storeKind: state.storeKind,
    userVersion: state.userVersion,
    tables: state.tables,
    counts,
    distribution,
    migratedFromJsonAt: migratedFromJsonAt || null,
    backupsDir: backupsDir(),
    appDir: APP_DIR,
  };
}

/**
 * 迁移：无标志 = 从 JSON 导入；版本落后 = 走升级链。两者都在同一个事务语义下。
 *
 * `--dry-run` 的落地方式是「事务末尾 ROLLBACK 不 COMMIT」：能完整跑一遍导入与校验，
 * 但库里什么都不留、legacy JSON 也不改名。这是迁移前唯一安全的"看一眼"手段。
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] 演练（回滚）
 * @param {boolean} [opts.apply]  显式执行（默认就是执行；这个标志只是让脚本自证意图）
 */
export async function migrate({ dryRun = false, apply = false }: { dryRun?: boolean; apply?: boolean } = {}): Promise<MigrateShape> {
  const path = dbPath();
  const existed = fileHasContent(path);
  void apply; // 默认行为就是执行；--apply 只是让脚本显式声明意图（两者等价）

  const db: any = openStore({ importLegacyData: true, dryRun });
  const result: any = getBootstrapResult() || { action: 'none', report: null };

  // 演练：库里什么都不该留（bootstrap 已经 ROLLBACK），连归档也不能发生。
  if (dryRun) {
    const planned = result.action;
    const plannedReport = result.report;
    // ROLLBACK 后库文件只剩一个空壳（SQLite 建文件是打开时的事，不归事务管）。
    // 本次之前不存在的库 → 连文件一起清掉，让 `--dry-run` 真正零副作用。
    if (!existed) {
      closeDb();
      removeDbFiles(path);
    }
    return {
      action: 'dry-run',
      path,
      existed,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      planned,
      report: plannedReport,
    };
  }

  const archived: ArchivedEntry[] = [];
  if (result.action === 'imported') {
    // 成功之后才改名：失败路径必须保证 JSON 一个字节不动。
    const out = archiveLegacyFiles(APP_DIR, nowMs());
    archived.push(...out.renamed);
  }

  return {
    action: result.action,
    path,
    existed,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    upgradedFrom: result.upgradedFrom,
    backup: result.backup ? result.backup.path : null,
    report: result.report,
    archived,
    counts: tableCounts(db),
    distribution: statusDistribution(db),
  };
}

/** 逐项校验（不抛错；失败由 CLI 退出码体现）。 */
export async function verify(): Promise<VerifyShape> {
  const db: any = openStore({ importLegacyData: false });
  const out: any = verifyStore(db, { appDir: APP_DIR });
  if (!out.ok) process.exitCode = 1;
  return out;
}

/**
 * `VACUUM INTO` 备份。**不能 copy .db**：WAL 下复制会拿到不一致快照。
 * @param {object} [opts]
 * @param {string} [opts.dir] 备份目录（缺省 `~/.nx-kv/backups/`）
 * @param {number} [opts.keep=5] 保留最近几份
 */
export async function backup({ dir, keep = 5 }: { dir?: string; keep?: number } = {}): Promise<BackupShape> {
  const db: any = openStore({ importLegacyData: false });
  const target = dir ? String(dir) : backupsDir();
  const keepCount = Number(keep) || 0;
  const tag = `nxkv-manual-${stampFileTag()}`;
  const out = backupDatabase(db, { dir: target, tag, keep: keepCount });
  return { path: out.path, removed: out.removed, dir: target, keep: keepCount, version: inspectStore(db).userVersion };
}

// ─── 渲染（纯文本，给人和 agent 看）────────────────────────────────────

const fmtMs = (ms: any): string => (ms ? new Date(Number(ms)).toISOString() : '（无）');

export function renderStatus(d: StatusShape): string {
  const lines = [
    '存储: SQLite（node:sqlite）',
    `库文件: ${d.path}${d.dbFileExists ? '' : '  （不存在，已按空库打开）'}`,
    `Node:  ${d.node}（要求 >= ${d.requiredNode}）`,
  ];
  if (!d.storeKind && d.tables === 0) {
    lines.push('状态:  空库（没有表；跑 nx-kv db migrate 建表并从 JSON 导入）');
    return lines.join('\n');
  }
  lines.push(`标志:  store_kind=${d.storeKind || '（缺失！这不是 nx-kv 的库）'}`);
  lines.push(`版本:  user_version=${d.userVersion}（程序支持 ${d.currentSchemaVersion}）`);
  if (d.migratedFromJsonAt) lines.push(`来源:  由 JSON 迁入于 ${fmtMs(d.migratedFromJsonAt)}`);
  lines.push('');
  lines.push('表行数:');
  const width = Math.max(...Object.keys(d.counts).map((k) => k.length), 8);
  for (const [k, v] of Object.entries(d.counts)) lines.push(`  ${k.padEnd(width + 2)}${v}`);
  const dist = d.distribution;
  lines.push('');
  lines.push(
    `任务状态: pending=${dist.pending} claimed=${dist.claimed} done=${dist.done} cancelled=${dist.cancelled}`
  );
  lines.push(`备份目录: ${d.backupsDir}`);
  return lines.join('\n');
}

export function renderMigrate(d: MigrateShape): string {
  const lines: string[] = [];
  if (d.action === 'dry-run') {
    lines.push('演练模式（--dry-run）：全部动作在事务内跑完，收尾 ROLLBACK，不改任何东西。');
    lines.push(`库文件: ${d.path}${d.existed ? '' : '（当前不存在）'}`);
    lines.push(`计划动作: ${d.planned}（created / imported / upgraded / none）`);
    if (d.report) {
      const imp = d.report.imported;
      lines.push(
        `将导入: repos=${imp.repos} members=${imp.members} topics=${imp.topics} tasks=${imp.tasks} ` +
          `presence=${imp.presence} links=${imp.links} deps=${imp.deps} goals=${imp.goals} ` +
          `goal_checks=${imp.goalChecks} refs=${imp.refs} bindings=${imp.refBindings} ` +
          `templates=${imp.templates} settings=${imp.settings}`
      );
      const dist = d.report.distribution;
      lines.push(
        `状态分布: pending=${dist.pending} claimed=${dist.claimed} done=${dist.done} cancelled=${dist.cancelled}`
      );
      lines.push(`警告 ${d.report.warnings.length} 条 / 丢弃记账 ${d.report.discarded.length} 条（详见 --json）`);
    }
    return lines.join('\n');
  }

  if (d.action === 'none' || d.action === 'raced') {
    lines.push(`已是当前状态（user_version=${d.schemaVersion}），本次 0 行写入。`);
    lines.push(`库文件: ${d.path}`);
    if (d.upgradedFrom !== undefined && d.upgradedFrom !== null) {
      lines.push(`（本次从 v${d.upgradedFrom} 升级而来）`);
    }
    return lines.join('\n');
  }

  if (d.action === 'upgraded') {
    lines.push(`schema 已升级: v${d.upgradedFrom} → v${d.schemaVersion}`);
    if (d.backup) lines.push(`升级前备份: ${d.backup}`);
    return lines.join('\n');
  }

  if (d.action === 'created') {
    lines.push(`已建库（无 legacy JSON 可导入）: ${d.path}`);
    lines.push(`user_version=${d.schemaVersion}`);
    return lines.join('\n');
  }

  // imported
  const imp = d.report ? d.report.imported : {};
  const dist = d.report ? d.report.distribution : {};
  lines.push(`迁移完成: ${d.path}`);
  lines.push(
    `导入 repos=${imp.repos} members=${imp.members} topics=${imp.topics} tasks=${imp.tasks} ` +
      `presence=${imp.presence} links=${imp.links} deps=${imp.deps} goals=${imp.goals} ` +
      `goal_checks=${imp.goalChecks} refs=${imp.refs} bindings=${imp.refBindings} ` +
      `templates=${imp.templates} settings=${imp.settings}`
  );
  lines.push(
    `状态分布: pending=${dist.pending} claimed=${dist.claimed} done=${dist.done} cancelled=${dist.cancelled}`
  );
  if (d.report && d.report.warnings.length) {
    lines.push(`警告 ${d.report.warnings.length} 条:`);
    for (const w of d.report.warnings.slice(0, 12)) lines.push('  · ' + JSON.stringify(w));
    if (d.report.warnings.length > 12) lines.push(`  … 其余 ${d.report.warnings.length - 12} 条见 --json`);
  }
  if (d.report && d.report.discarded.length) {
    const agg = new Map();
    for (const it of d.report.discarded) agg.set(it.what, (agg.get(it.what) || 0) + (it.count || 1));
    lines.push('丢弃记账: ' + [...agg].map(([k, v]) => `${k}=${v}`).join(' '));
  }
  if (d.archived && d.archived.length) {
    lines.push('legacy JSON 已改名备份（未删除）:');
    for (const a of d.archived) lines.push(`  · ${a.from} → ${a.to}`);
  }
  if (d.backup) lines.push(`升级前备份: ${d.backup}`);
  return lines.join('\n');
}

export function renderVerify(d: VerifyShape): string {
  const lines: string[] = [];
  lines.push(`校验 ${d.state.path}（user_version=${d.state.userVersion}）`);
  for (const c of d.checks) {
    lines.push(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  -- ' + c.detail : ''}`);
  }
  lines.push('');
  lines.push(
    `结论: ${d.ok ? '全部通过' : '有失败项（见上面的 FAIL）'}；` +
      `tasks=${d.counts.tasks}（pending=${d.distribution.pending} claimed=${d.distribution.claimed} ` +
      `done=${d.distribution.done} cancelled=${d.distribution.cancelled}）`
  );
  return lines.join('\n');
}

export function renderBackup(d: BackupShape): string {
  const lines = [
    `备份完成: ${d.path}`,
    `目录: ${d.dir}（保留最近 ${d.keep} 份${d.keep === 0 ? '，不清理' : ''}）`,
    `源库 user_version=${d.version}`,
  ];
  if (d.removed && d.removed.length) lines.push(`清理旧备份: ${d.removed.join(', ')}`);
  return lines.join('\n');
}
