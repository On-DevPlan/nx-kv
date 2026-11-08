// 打开库并完成「探测 → 建表/导入/升级」的唯一入口。
//
// 为什么所有进程都只能走这一条路：迁移逻辑写两套是这类改造最常见的翻车点 ——
// `nx-kv db migrate` 和「启动时自动迁移」各写一遍，两份最终会给出不同的库。
// 所以 CLI 子命令、serve、测试夹具全部调这里的同一个 `bootstrap()`。
//
// ── 并发（serve 与 CLI 同时首启）──────────────────────────────────────
//
//   P1: BEGIN IMMEDIATE   ── 拿到写锁
//   P2: BEGIN IMMEDIATE   ── busy_timeout 等 5s（阻塞在 BEGIN 上，不是阻塞在第一条 INSERT）
//   P1: 校验 → 建表/导入 → 写 meta + user_version → COMMIT
//   P2: 拿到锁 → **重新读** user_version / meta → 已是当前版本 → 空事务 COMMIT
//
// 四条要点：
//   1. 锁必须拿在 `BEGIN IMMEDIATE` 上，**且必须在读版本之前** —— 先读后锁就是
//      TOCTOU：两个进程都读到"没有标志"，都去导入（一个成功、一个撞 UNIQUE）。
//   2. 读版本的动作放在事务内（tx 体的第一行），配合 1 才是双检。
//   3. 幂等来源：所有动作都是「事务内 + 版本判定」，重复执行到已完成的版本上等于空转。
//   4. 成功后重命名 legacy 文件（不删），让"再跑一次迁移"物理上不可能。
//
// ── 两种拒绝而不是猜的情况 ────────────────────────────────────────────
//
//   · 库比程序新（user_version > CURRENT）：**绝不降级写**。
//   · 有表但没有 meta.store_kind（别人把 SQLite 文件改名成 nxkv.db）：
//     **绝不自动建表** —— 那会把别人的库就地改成我们的结构。
import { existsSync, rmSync, unlinkSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachmentsRootFromEnv, dbPathFromEnv, backupsDirFromEnv, defaultStoreTarget } from '../paths.js';
import {
  archiveAttachmentManifests,
  syncDocAttachmentIndex,
  syncTaskAttachmentIndex,
} from '../attachmentdb.js';
import { badInput } from '../errors.js';
import { openRaw } from './driver.js';
import { tx } from './tx.js';
import {
  CURRENT_SCHEMA_VERSION,
} from './version.js';
import {
  backupDatabase,
  countTables,
  fileHasContent,
  getMeta,
  hasMetaTable,
  migrate,
  setMeta,
  storeKindOf,
  userVersion,
} from './migrator.js';
import { importLegacy, scanLegacy, ensureSentinelRepo, LEGACY_FILES } from './import-json.js';
import { seedBuiltinTemplates } from './seed-templates.js';
import {
  NotNxKvStoreError,
  StoreMigrationError,
  StoreTooNewError,
  isBusyError,
  isReadOnlyError,
} from './errors.js';
import { nowMs, stampFileTag } from './time.js';

/** `meta.store_kind` 的值：库是 nx-kv 自己建的。 */
export const STORE_KIND = 'sqlite';

/** 当前程序版本（写进 `meta.created_by`，排障时能对上版本）。 */
export function appVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

/** 库的当前状态（纯读，不写任何东西）。 */
export function inspectStore(db) {
  const tables = countTables(db);
  const hasMeta = hasMetaTable(db);
  return {
    path: db.path,
    tables,
    hasMeta,
    storeKind: hasMeta ? storeKindOf(db) : null,
    userVersion: userVersion(db),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

/**
 * 建表 + 必要时导入 + 必要时升级。
 *
 * @param {object} db 连接
 * @param {object} [opts]
 * @param {string} [opts.appDir=APP_DIR] legacy 数据所在目录
 * @param {boolean} [opts.importLegacyData=true] 是否执行 JSON → SQLite 导入
 * @param {boolean} [opts.dryRun=false] 收尾 ROLLBACK（`db migrate --dry-run`）
 * @param {number} [opts.atMs] 时刻兜底
 * @returns {object} { action, createdSchema, upgradedFrom, report, state, imported }
 */
export function bootstrap(
  db,
  { appDir = defaultStoreTarget().appDir, importLegacyData = true, dryRun = false, atMs = nowMs() } = {}
) {
  const before = inspectStore(db);
  const legacy = scanLegacy(appDir);
  // 迁移上下文：002 的 apply 需要把 manifest.json / docs 树 / 任务正文一起迁走。
  const migrationContext = {
    attachmentsRoot: attachmentsRootFromEnv(),
    docsRoot: process.env.NX_KV_DOCS_DIR || join(appDir, 'docs'),
    atMs,
  };
  const result = {
    action: 'none',
    createdSchema: false,
    upgradedFrom: null,
    backup: null,
    report: null,
    legacyFiles: Object.entries(legacy.files)
      .filter(([, r]) => r && r.ok)
      .map(([kind, r]) => ({ kind, path: r.path })),
  };

  // ── 只读连接：只探测，不建表、不导入、不升级 ──
  //
  // 理由：诊断类命令（`db status`）不该有副作用；更重要的是**升级必须只发生在一个
  // 地方** —— 拿着只读连接去跑迁移只会得到 "attempt to write a readonly database"，
  // 一条完全指不出真因的报错。
  if (db.readOnly) {
    result.action = 'read-only';
    result.state = before;
    return result;
  }

  // ── 情况 A：库里一张业务表都没有（文件不存在 / 空文件 / 上次中断在建表前）──
  if (before.tables === 0) {
    const out = tx(
      (conn) => {
        // 双检：并发进程可能刚把表建好（锁是在 BEGIN IMMEDIATE 上等的）
        if (countTables(conn) > 0) return { raced: true };
        migrate(conn, { from: 0, context: migrationContext });
        ensureSentinelRepo(conn, atMs); // topics.repo_key 的 FK 目标，无它一条队列都建不出
        setMeta(conn, 'store_kind', STORE_KIND, atMs);
        setMeta(conn, 'schema_version', String(CURRENT_SCHEMA_VERSION), atMs);
        setMeta(conn, 'created_by', 'nx-kv/' + appVersion(), atMs);
        let report = null;
        if (importLegacyData && legacy.any) {
          report = importLegacy(conn, { appDir, atMs });
        }
        // 导入之后立刻把正文引用/文档资源落关系表（002 的 apply 在导入之前跑，
        // 这里补一次，保证「导入的历史任务」也不是只有正文里的 fileId 字符串）。
        syncTaskAttachmentIndex(conn, { atMs });
        syncDocAttachmentIndex(conn, { docsRoot: migrationContext.docsRoot, atMs });
        // 内置模板 seed 放在导入**之后**：legacy templates.json 里用户改过的
        // builtin 行先落库，seed 的 INSERT OR IGNORE 就不会用出厂文本盖掉它。
        seedBuiltinTemplates(conn, atMs);
        return { created: true, report };
      },
      { db, mode: 'IMMEDIATE', rollback: dryRun }
    );
    result.createdSchema = true;
    if (out && out.raced) {
      result.action = 'raced';
    } else if (out && out.report) {
      result.action = 'imported';
      result.report = out.report;
    } else {
      result.action = 'created';
    }
    return result;
  }

  // ── 情况 B：有表 → 必须是我们的库 ──
  if (!before.hasMeta || !before.storeKind) {
    throw new NotNxKvStoreError(db.path);
  }
  if (before.storeKind !== STORE_KIND) {
    throw new NotNxKvStoreError(db.path);
  }
  if (before.userVersion > CURRENT_SCHEMA_VERSION) {
    throw new StoreTooNewError(before.userVersion, CURRENT_SCHEMA_VERSION);
  }

  // ── 情况 C：版本落后 → 先备份（VACUUM INTO，事务外）→ 再逐步升级 ──
  if (before.userVersion < CURRENT_SCHEMA_VERSION) {
    // 升级是"每步一个事务 + 每步提交"，没法像导入那样整段 ROLLBACK。
    // 所以演练遇到升级就直接拒绝，而不是假装演练过（静默把库升上去更糟）。
    if (dryRun) {
      throw badInput(
        `--dry-run 不支持 schema 升级（库是 v${before.userVersion}，程序是 v${CURRENT_SCHEMA_VERSION}）。\n` +
          '升级会逐步提交、无法回滚，请先 `nx-kv db backup` 再直接 `nx-kv db migrate`。'
      );
    }
    result.upgradedFrom = before.userVersion;
    // 升级前备份失败必须中止：没有退路的 schema 变更是不可接受的。
    result.backup = backupDatabase(db, {
      dir: backupsDirFromEnv(),
      from: before.userVersion,
      tag: `nxkv-v${before.userVersion}-${stampFileTag()}`,
      keep: 5,
    });
    const applied = migrate(db, { from: before.userVersion, context: migrationContext });
    result.action = applied.length ? 'upgraded' : 'none';
  }

  // ── 情况 D：还没有从 JSON 迁过，而 legacy 数据在 → 导入 ──
  const alreadyImported = !!getMeta(db, 'migrated_from_json_at');
  if (importLegacyData && !alreadyImported && legacy.any) {
    const report = tx(
      (conn) => {
        if (!!getMeta(conn, 'migrated_from_json_at')) return null; // 双检
        ensureSentinelRepo(conn, atMs); // `db status` 只建表不导入的库，也要有哨兵
        // 同一个事务里再确认一次：空库导入时不覆盖已有数据
        const taskCount = Number((conn.get('SELECT count(*) AS c FROM tasks') || {}).c || 0);
        if (taskCount > 0) {
          setMeta(conn, 'migrated_from_json_at', String(atMs), atMs);
          return null;
        }
        const out = importLegacy(conn, { appDir, atMs });
        // 导入的数据在本事务里落资源关系；失败则整段回滚，不会留下半套关系。
        syncTaskAttachmentIndex(conn, { atMs });
        syncDocAttachmentIndex(conn, { docsRoot: migrationContext.docsRoot, atMs });
        return out;
      },
      { db, mode: 'IMMEDIATE', rollback: dryRun }
    );
    if (report) {
      result.action = 'imported';
      result.report = report;
    }
  }

  // ── 内置模板 seed（幂等；存量库也可能缺新加的 builtin 行）──
  //  只读 / 演练 / 未建表的库跳过（情况 A 已在事务内 seed 过）。
  if (!db.readOnly && !dryRun && before.tables > 0) {
    tx((conn) => seedBuiltinTemplates(conn, atMs), { db, mode: 'IMMEDIATE' });
  }

  // 旧 manifest 台账在迁移阶段已进库；成功后归档（改名不删，留取证）。
  // 运行时不再读写 manifest，归档失败也不影响 DB 作为唯一真相。
  if (!db.readOnly && !dryRun) {
    const archived = archiveAttachmentManifests(migrationContext.attachmentsRoot, stampFileTag(atMs));
    if (archived.length) result.manifestsArchived = archived;
  }

  return result;
}

/**
 * 打开库 + bootstrap，失败时把库文件回滚到"迁移前"（本次新建的直接删掉，可重建）。
 *
 * **并发首启的重试**：两个进程同时启动时，先到的那个在把库切到 WAL / 建表，
 * 后到的可能在第一次写时拿到 `attempt to write a readonly database`（瞬时的 WAL
 * 切换窗口，见 errors.isReadOnlyError）或 `database is locked`。这两种都是
 * 「等一等就好」，所以这里整段重来（关连接 → 重开 → 重新探测），而不是直接判失败。
 * 重试用尽仍失败 → 走失败路径（回滚、日志、退出码 2）。
 *
 * @param {object} [opts]
 * @param {string} [opts.path=dbPathFromEnv()] 库路径（`NX_KV_DB`）
 * @param {string} [opts.appDir=APP_DIR] legacy 数据目录（`NX_KV_HOME`）
 * @param {boolean} [opts.importLegacyData=true]
 * @param {boolean} [opts.dryRun=false]
 * @param {boolean} [opts.readOnly=false]
 * @returns {{db: object, result: object, existedBefore: boolean}}
 */
export function openAndBootstrap({
  path = dbPathFromEnv(),
  appDir = defaultStoreTarget().appDir,
  importLegacyData = true,
  dryRun = false,
  readOnly = false,
  atMs = nowMs(),
  retries = 6,
} = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return attemptOpen({ path, appDir, importLegacyData, dryRun, readOnly, atMs });
    } catch (err) {
      lastErr = err;
      // 只重试"另一个进程正好在动这个库"造成的瞬时错误；真实的失败立刻上抛。
      const transient = isBusyError(err) || isReadOnlyError(err);
      if (!transient || attempt >= retries) throw err;
      sleepSync(40 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** 一次完整的「打开 → bootstrap」，失败时清理成"迁移前状态"。 */
function attemptOpen({ path, appDir, importLegacyData, dryRun, readOnly, atMs }) {
  const existedBefore = fileHasContent(path);

  // 打开失败（路径不可写 / 只读打开一个不存在的库 / 别人的文件不是 SQLite）
  // 不是"迁移失败"：库还没建起来，没什么可回滚，也不该写 migration-failed 日志。
  const db = openRaw(path, { readOnly });

  try {
    const result = bootstrap(db, { appDir, importLegacyData, dryRun, atMs });
    return { db, result, existedBefore };
  } catch (err) {
    try {
      db.close();
    } catch {
      /* 关不掉就继续清理 */
    }
    // 两种"拒绝"不是迁移失败：库文件不是我们建的/不该动，原样保留。
    const rejection = err instanceof NotNxKvStoreError || err instanceof StoreTooNewError;
    if (rejection) throw err;
    // 迁移中途出错：JSON 一字节不动（我们从没写过它），库文件回滚到迁移前状态。
    //
    // **但不能无条件删**：并发首启时"文件在我打开之前不存在"不等于"库是我建的" ——
    // 先到的进程可能刚建好表并且正在用。所以删之前探一次：库里没有已提交的 schema
    // 才允许删（否则动别人的库 = 数据消失）。
    if (!existedBefore && !hasCommittedSchema(path)) removeDbFiles(path);
    const logPath = writeFailureLog(appDir, err);
    // 统一成 StoreMigrationError：调用方只需认一个类型，退出码 2。
    throw new StoreMigrationError(
      `迁移失败，已回滚（legacy JSON 未改动）。明细见 ${logPath || '（日志写入失败）'}\n` +
        `原因：${String(err.message || err)}`,
      { logPath, cause: String((err && err.message) || err) }
    );
  }
}

/** 库里有没有**已提交**的 schema（另一个进程的成果）。探不到就当"有"（保守，不删）。 */
function hasCommittedSchema(path) {
  let probe = null;
  try {
    probe = openRaw(path, { readOnly: true });
    return countTables(probe) > 0 || !!storeKindOf(probe);
  } catch {
    return true;
  } finally {
    if (probe) {
      try {
        probe.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/** 同步小睡（并发重试用）。CLI 进程没有别的事要做，阻塞可接受。 */
function sleepSync(ms) {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, Math.max(0, ms));
}

/** 删掉库文件及其 WAL 附属文件（本次新建的库才允许）。 */
export function removeDbFiles(path) {
  if (!path || path === ':memory:') return;
  for (const p of [path, path + '-wal', path + '-shm', path + '-journal']) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      try {
        rmSync(p, { force: true });
      } catch {
        /* Windows 上偶尔还被句柄占着：留给下次 */
      }
    }
  }
}

/** 写失败明细日志，返回路径（`~/.nx-kv/migration-failed-<时间戳>.log`）。 */
export function writeFailureLog(appDir, err) {
  const path = join(appDir, `migration-failed-${stampFileTag()}.log`);
  const lines = [
    `nx-kv 迁移失败  ${new Date().toISOString()}`,
    `node ${process.versions.node}   platform ${process.platform}`,
    '',
    String((err && err.stack) || err),
    '',
  ];
  try {
    writeFileSync(path, lines.join('\n'), 'utf8');
    return path;
  } catch {
    return null;
  }
}

/**
 * 迁移成功后把 legacy JSON **改名**（不删）。
 *
 * 改名而非删除的理由：① 让"再跑一次迁移"物理上不可能；② 用户能自己 diff；
 * ③ 一旦发现漏迁还有据可查 —— 删除则连证据都没了。
 *
 * **例外：`config.json` 不改名。** 它装的是 5 个凭据（token / baseUrl / email /
 * userId / groupId），迁移后**仍被运行时读取**（凭据留文件是 D4 的裁决）。
 * 改名等于把用户登出，而且下一次 `loadConfig()` 会拿默认值静默覆盖 ——
 * 那是"迁移成功、功能全坏"的最坏形状。它的偏好 4 项已经在 `settings` 表里了。
 *
 * @returns {{renamed: Array<{from: string, to: string, missing?: boolean}>}}
 */
export function archiveLegacyFiles(appDir, atMs = nowMs()) {
  const tag = stampFileTag(atMs);
  const renamed = [];
  for (const name of Object.values(LEGACY_FILES)) {
    // 凭据文件留在原地（见上面的说明）。
    if (name === LEGACY_FILES.config) continue;
    const from = join(appDir, name);
    if (!fileHasContent(from)) continue;
    const base = name.replace(/\.json$/i, '');
    const to = join(appDir, `${base}.migrated-${tag}.json`);
    try {
      // 目标已存在时绝不覆盖（同一秒内跑两次的极端情况）
      if (existsSync(to)) {
        renamed.push({ from, to, skipped: true });
        continue;
      }
      renameSync(from, to);
      renamed.push({ from, to });
    } catch (err) {
      renamed.push({ from, to, error: String((err && err.message) || err) });
    }
  }
  return { renamed };
}

/** 备份目录（给 CLI 用）。 */
export function backupsDir() {
  return backupsDirFromEnv();
}
