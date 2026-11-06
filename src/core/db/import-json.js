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
// · `claimedFrom/By/ByName`、`remote`、`migratedTo` 不迁移（审计已裁定）。
// · `tasks.seq` 保持原 `id`（对外编号不能漂），`topics.next_seq = max(seq)+1`。
// · 内嵌 `timegoal`（本机 7 条**值全是 null**，实际 0 条）→ `goals` + `goal_checks`；
//   队列级 timegoal 丢弃并报告。
// · `blockBy` / `forkOf` 的 `"topicKey:id"` 两段都要重映射；解析失败的边记报告丢弃
//   （一条脏边不能让整个迁移回滚）。本机两者都是空 → 实际 0 边。
// · `refs` 磁盘上从来没有过：初值从 `repos.json` 的 DocRef（doc / docLinks /
//   repoDocs）+ `docs/` 树扫描重建；`ref_relations` 本轮留空。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { topicKeyOf, GLOBAL_TOPIC_KEY } from '../topic-key.js';
import { groupKeyOf } from '../keys.js';
import { anyTimeMs, nowMs } from './time.js';
import { setMeta } from './migrator.js';
import crypto from 'node:crypto';

/** legacy 写入层的正文上限（迁移时超长按截断 + 标记，不整体失败）。 */
export const MAX_BODY = 20_000;

/** 迁移时承载「对不上真实仓库的队列」的哨兵仓库 key。 */
export const SENTINEL_REPO_KEY = '__unbound__';
export const SENTINEL_REPO_NAME = '未绑定仓库';

/** legacy 文件名（只认这几个；`repos.backup.*.json` 不参与）。 */
export const LEGACY_FILES = {
  localtasks: 'localtasks.json',
  sessiontasks: 'sessiontasks.json',
  repos: 'repos.json',
  timegoals: 'timegoals.json',
  templates: 'templates.json',
  config: 'config.json',
};

/** config.json 里属于「偏好」的 4 个字段（其余是凭据，**绝不进库**）。 */
export const CONFIG_PREF_KEYS = ['autoSyncAttachments', 'attachmentsDir', 'gitRepoRoot', 'gitDevRoot'];

/** localtasks store 里属于「本机设置」的 5 个字段。 */
export const LOCALTASK_SETTING_KEYS = [
  'timeoutSec',
  'taskSuffix',
  'ackPrompt',
  'deliveryTemplate',
  'attachTemplate',
];

/** 稳定的 ref id：locator 的纯函数（同一份文档换台机器也是同一个 id）。 */
export function refIdOf(locator) {
  return 'ref_' + crypto.createHash('sha1').update(String(locator), 'utf8').digest('hex').slice(0, 16);
}

/** 空报告。所有分支都填它，调用方（CLI / 测试）只读这一个对象。 */
export function emptyReport() {
  return {
    sources: [],
    imported: {
      repos: 0,
      members: 0,
      topics: 0,
      tasks: 0,
      presence: 0,
      links: 0,
      deps: 0,
      goals: 0,
      goalChecks: 0,
      refs: 0,
      refBindings: 0,
      templates: 0,
      settings: 0,
    },
    distribution: { pending: 0, claimed: 0, done: 0, cancelled: 0 },
    warnings: [],
    discarded: [],
  };
}

const jsonText = (v) => JSON.stringify(v === undefined ? null : v);

/**
 * legacy 任务的 5 步嵌套判据。
 *
 * @param {object} task legacy 任务行
 * @returns {{status: string, unknown: boolean, archived: boolean, hasSummary: boolean}}
 */
export function mapLegacyStatus(task) {
  const raw = String((task && task.status) ?? '').trim();
  const summaryRaw = task ? task.roundSummary : undefined;
  const hasSummary = summaryRaw !== undefined && summaryRaw !== null && String(summaryRaw).trim() !== '';

  // 第 0 步：**新词直通**。T02 之后 JSON 里可能已是 pending/claimed/done/cancelled
  // （跑过 rewrite-json-status.mjs 的机器），它们不是 legacy 词，原样认领 ——
  // 「两条都要认」：旧词按判据映射，新词原样保留。
  if (raw === 'claimed' || raw === 'done' || raw === 'cancelled') {
    return { status: raw, unknown: false, archived: raw === 'cancelled', hasSummary };
  }

  // 第 2 步：pending 优先于一切 —— 即使带了 roundSummary（历史残留 / 就地重开的空串）
  if (raw === 'pending') return { status: 'pending', unknown: false, archived: false, hasSummary };
  // 第 3 步
  if (raw === 'consumed') {
    return { status: hasSummary ? 'done' : 'claimed', unknown: false, archived: false, hasSummary };
  }
  // 第 4 步
  if (raw === 'archived') {
    return { status: hasSummary ? 'done' : 'cancelled', unknown: false, archived: true, hasSummary };
  }
  // 第 5 步：未知状态不猜语义 —— 当 pending（可领）并报告，因为"丢失"比"重领"更糟
  return { status: 'pending', unknown: true, archived: false, hasSummary };
}

// ─── 读 legacy 文件 ────────────────────────────────────────────────────

function readJson(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    return { ok: true, data: JSON.parse(raw), path };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, missing: true, path };
    return { ok: false, error: String((err && err.message) || err), path };
  }
}

/**
 * 探测 legacy 数据。
 *
 * `localtasks.json` 缺失时回落到 `sessiontasks.json`（改名前的旧文件），
 * 与运行期 `legacyStorePath()` 同口径 —— 只认「主文件不在」这一种情况。
 *
 * @returns {{files: object, any: boolean}}
 */
export function scanLegacy(appDir) {
  const files = {};
  for (const [kind, name] of Object.entries(LEGACY_FILES)) {
    files[kind] = readJson(join(appDir, name));
  }
  if (!files.localtasks.ok && files.localtasks.missing && files.sessiontasks.ok) {
    files.localtasks = files.sessiontasks;
    files.localtasksFromLegacyName = true;
  }
  const any = ['localtasks', 'repos', 'timegoals', 'templates', 'config'].some((k) => files[k] && files[k].ok);
  return { files, any };
}

// ─── repos / members ──────────────────────────────────────────────────

/** 哨兵仓库必须**永远在场**：topics.repo_key 是 NOT NULL 外键，没有它连一条队列都建不出来。
 *  幂等（已存在跳过）。bootstrap 在建表后无条件调用 —— 与「有没有 legacy JSON」无关。 */
export function ensureSentinelRepo(db, atMs, report = emptyReport()) {
  const exists = db.get('SELECT key FROM repos WHERE key = :k', { k: SENTINEL_REPO_KEY });
  if (exists) return;
  db.run(
    `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version,
                        deleted_at, created_at, updated_at)
     VALUES (:key, 'repo', :name, :desc, '', '', -1, :ext, '', 0, NULL, :at, :at)`,
    {
      key: SENTINEL_REPO_KEY,
      name: SENTINEL_REPO_NAME,
      desc: '迁移时承载"对不上真实仓库"的队列与全局池；不是用户登记的仓库（面板默认隐藏）',
      ext: jsonText({ ext_sentinel: 1 }),
      at: atMs,
    }
  );
  report.imported.repos += 1;
}

function importRepos(db, reposData, atMs, report) {
  const repos = Array.isArray(reposData && reposData.repos) ? reposData.repos : [];
  const boards = Array.isArray(reposData && reposData.boards) ? reposData.boards : [];

  ensureSentinelRepo(db, atMs, report);

  const seen = new Set([SENTINEL_REPO_KEY]);
  const legacyIdToKey = new Map(); // 旧 r_xxx → 新 key
  const boardLegacyIdToKey = new Map(); // 旧 b_xxx → 组 key

  repos.forEach((r, index) => {
    const key = String((r && r.key) || '').trim();
    if (!key) {
      report.warnings.push({ what: 'repo', why: 'key 为空（repos.key 是身份，不能伪造）', legacy: r && r.id });
      return;
    }
    if (seen.has(key)) {
      report.warnings.push({ what: 'repo', why: 'key 重复', key });
      return;
    }
    seen.add(key);
    if (r.id) legacyIdToKey.set(String(r.id), key);

    // 审计裁定：不做远程融合、不做"按路径猜 key"，key 原样入驻；
    // legacy 的 type（ref / dev）不是新 schema 的二分（repo/group），存 ext 取证。
    const ext = {};
    if (r.id) ext.ext_legacy_id = String(r.id);
    if (r.type) ext.ext_legacy_type = String(r.type);
    if (r.notes) ext.ext_notes = String(r.notes);
    if (r.icon) ext.ext_icon = String(r.icon);
    if (Array.isArray(r.remotes) && r.remotes.length) ext.ext_remotes = r.remotes.map(String);
    if (r.keyCustom) ext.ext_key_custom = 1;
    if (r.keyUpdatedAt) ext.ext_key_updated_at = stringOrNull(r.keyUpdatedAt);
    // `linked` 里 kind='board' 的是 repo_group_members 的反向查询（下面的入组边负责），
    // kind='ref' 的是"参考仓库"关系 —— 新 schema 没有这张表，存 ext 取证 + 报告。
    const refLinks = Array.isArray(r.linked) ? r.linked.filter((x) => x && x.kind === 'ref').map((x) => String(x.id)) : [];
    if (refLinks.length) {
      ext.ext_linked_refs = refLinks;
      report.discarded.push({ what: 'repo.linked(kind=ref)', key, count: refLinks.length, note: '新 schema 无仓库↔仓库关系表，存 ext 取证' });
    }

    const createdAt = anyTimeMs(r.addedAt, atMs);
    const updatedAt = anyTimeMs(r.updatedAt, createdAt);
    db.run(
      `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version,
                          deleted_at, created_at, updated_at)
       VALUES (:key, 'repo', :name, :desc, :path, :remote, :sort, :ext, :state, :version,
               :deleted, :created, :updated)`,
      {
        key,
        name: String(r.name || key),
        desc: String(r.desc || ''),
        path: String(r.path || ''),
        remote: String(r.remote || (Array.isArray(r.remotes) ? r.remotes[0] : '') || ''),
        sort: index,
        ext: jsonText(ext),
        state: String(r.state || ''),
        version: Number(r.version) || 0,
        deleted: r.deletedAt ? anyTimeMs(r.deletedAt, null) : null,
        created: createdAt,
        updated: updatedAt,
      }
    );
    report.imported.repos += 1;
  });

  // ── boards → repos(type='group') ──
  // key = `group/<slug(初始 name)>`：**冻结**（name 之后可改，key 不变）。
  // 冻结的理由与 repos.key 同理：key 是身份，跟着显示名漂会让外部引用全断。
  const groupKeys = [];
  boards.forEach((b, index) => {
    const name = String((b && b.name) || '').trim();
    if (!name) {
      report.warnings.push({ what: 'board', why: 'name 为空，无法派生组 key', legacy: b && b.id });
      return;
    }
    let key = groupKeyOf(name);
    if (seen.has(key)) {
      // slug 冲突（同名组 / 与仓库 key 撞车）→ 加序号后缀 + 报告，绝不覆盖
      let n = 2;
      while (seen.has(`${key}-${n}`)) n += 1;
      report.warnings.push({ what: 'board', why: `组 key 冲突，改用后缀 -${n}`, from: key, to: `${key}-${n}` });
      key = `${key}-${n}`;
    }
    seen.add(key);
    groupKeys.push(key);
    if (b.id) boardLegacyIdToKey.set(String(b.id), key);

    const ext = {};
    if (b.id) ext.ext_legacy_id = String(b.id);
    const createdAt = anyTimeMs(b.createdAt, atMs);
    db.run(
      `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version,
                          deleted_at, created_at, updated_at)
       VALUES (:key, 'group', :name, :desc, '', '', :sort, :ext, '', 0, NULL, :created, :updated)`,
      {
        key,
        name,
        desc: String(b.desc || ''),
        sort: index,
        ext: jsonText(ext),
        created: createdAt,
        updated: anyTimeMs(b.updatedAt, createdAt),
      }
    );
    report.imported.repos += 1;
  });

  // ── members（组 ← 仓库）──
  boards.forEach((b, bi) => {
    const groupKey = groupKeys[bi];
    if (!groupKey) return;
    const notesIn = b.repoNotes && typeof b.repoNotes === 'object' ? b.repoNotes : {};
    let keys = Array.isArray(b.repoKeys) ? b.repoKeys : [];
    let notes = notesIn;
    // 老结构（迁移前的存量数据）：成员存随机 id（repoIds / repoNotes 按 id 键）。
    // repos 已全部入库（legacyIdToKey 齐），一次性换算成 key；换算不到的丢弃 + 报告
    //（与 JSON 时代 keys.js migrateRelations 同一口径，只是搬进了导入事务）。
    const oldIds = Array.isArray(b.repoIds) ? b.repoIds : null;
    if (!keys.length && oldIds && oldIds.length) {
      keys = [];
      for (const id of oldIds) {
        const k = legacyIdToKey.get(String(id));
        if (k) keys.push(k);
        else report.warnings.push({ what: 'member', why: 'repoIds 里的 id 换算不到 key（登记缺失），已丢弃', group: groupKey, id: String(id) });
      }
      notes = {};
      for (const [k, v] of Object.entries(notesIn)) notes[legacyIdToKey.get(String(k)) || k] = v;
      report.warnings.push({ what: 'member', why: 'repoIds（旧结构）已换算为 repoKeys', group: groupKey, count: keys.length });
    }
    keys.forEach((repoKeyRaw, position) => {
      const repoKey = String(repoKeyRaw || '').trim();
      if (!repoKey) return;
      if (!db.get('SELECT key FROM repos WHERE key = :k', { k: repoKey })) {
        // 脏数据（组里挂了一个不存在的仓库）→ 记报告丢弃，不整体回滚
        report.warnings.push({ what: 'member', why: '成员仓库不存在，已丢弃', group: groupKey, repo: repoKey });
        return;
      }
      if (repoKey === groupKey) {
        report.warnings.push({ what: 'member', why: '组把自己当成员，已丢弃', group: groupKey });
        return;
      }
      db.run(
        `INSERT INTO repo_group_members (group_key, repo_key, position, note, created_at)
         VALUES (:g, :r, :pos, :note, :at)
         ON CONFLICT(group_key, repo_key) DO NOTHING`,
        { g: groupKey, r: repoKey, pos: position, note: String(notes[repoKey] || ''), at: atMs }
      );
      report.imported.members += 1;
    });
  });

  return { legacyIdToKey, boardLegacyIdToKey, groupKeys, boardNames: boards.map((b) => String((b && b.name) || '')) };
}

function stringOrNull(v) {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

// ─── topics / tasks ───────────────────────────────────────────────────

function importTopicsAndTasks(db, localtasksData, atMs, report) {
  const topics = localtasksData && localtasksData.topics && typeof localtasksData.topics === 'object'
    ? localtasksData.topics
    : {};

  /** legacy topic key → { id, legacyKey } */
  const byLegacyKey = new Map();
  /** 新 key → topic 行（碰撞时合并到同一行） */
  const byNewKey = new Map();

  for (const [legacyKey, t] of Object.entries(topics)) {
    const topic = t && typeof t === 'object' ? t : {};
    // cwd：优先 .cwd，其次 cwds[0]（schema 一条队列一个 cwd，其余丢弃 + 报告）
    let cwd = String(topic.cwd || '').trim();
    if (!cwd && Array.isArray(topic.cwds) && topic.cwds.length) cwd = String(topic.cwds[0] || '').trim();
    if (Array.isArray(topic.cwds) && topic.cwds.length > 1) {
      report.discarded.push({
        what: 'topic.cwds[1..]',
        key: legacyKey,
        count: topic.cwds.length - 1,
        note: 'schema 一条队列一个 cwd',
      });
    }
    const hasTasks = Array.isArray(topic.tasks) && topic.tasks.length > 0;
    if (!cwd && legacyKey !== GLOBAL_TOPIC_KEY && hasTasks) {
      // 异常行（v1/v2 迁移来的、没 cwd 的旧等待点）：挂哨兵 + cwd='' + 报告
      report.warnings.push({
        what: 'topic',
        why: 'cwd 为空且不是全局池（旧 slot/session 迁移残留），cwd 落空串',
        legacyKey,
      });
    }
    const key = topicKeyOf(cwd, '');
    let row = byNewKey.get(key);
    if (row) {
      // 两条 legacy 队列算出同一个 key = 同一个 (cwd, group)。按新口径它们本就是
      // 一条队列 → 合并（旧口径下同名目录共用一条队列正是被修掉的 bug）。
      report.warnings.push({ what: 'topic', why: '与另一条 legacy 队列同 (cwd, group)，已合并', legacyKey, key });
    } else {
      const ext = { ext_legacy_key: legacyKey };
      if (topic.summary) ext.ext_last_summary = String(topic.summary);
      if (topic.manual) ext.ext_manual = 1;
      if (legacyKey === GLOBAL_TOPIC_KEY) ext.ext_global = 1;

      const createdAt = anyTimeMs(topic.createdAt, atMs);
      const res = db.run(
        `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                             deleted_at, created_at, updated_at)
         VALUES (:key, :repo, :cwd, NULL, :name, 1, :ext, :state, :version, NULL, :created, :updated)`,
        {
          key,
          repo: SENTINEL_REPO_KEY,
          cwd,
          name: String(topic.name || ''),
          ext: jsonText(ext),
          state: String(topic.state || ''),
          version: Number(topic.workflowRevision) || 0,
          created: createdAt,
          updated: anyTimeMs(topic.updatedAt, createdAt),
        }
      );
      row = { id: res.lastInsertRowid, taken: new Set(), maxSeq: 0 };
      byNewKey.set(key, row);
      report.imported.topics += 1;
    }
    byLegacyKey.set(legacyKey, { id: row.id, legacyKey });

    // ── 等待态 → topic_presence（瞬态数据独立成表，见 schema 的 P0-4 说明）──
    const waiting = topic.waiting === true || topic.waiting === 1;
    const untilMs = anyTimeMs(
      topic.waitingUntilMs !== undefined ? topic.waitingUntilMs : topic.waitingUntil,
      NaN
    );
    const cancelRequested = topic.cancelRequested === true || topic.cancelRequested === 1;
    if (waiting || cancelRequested || !Number.isNaN(untilMs)) {
      db.run(
        `INSERT INTO topic_presence (topic_id, waiting, since_ms, until_ms, cancel_requested, updated_at)
         VALUES (:id, :waiting, :since, :until, :cancel, :at)
         ON CONFLICT(topic_id) DO UPDATE SET waiting = excluded.waiting, since_ms = excluded.since_ms,
           until_ms = excluded.until_ms, cancel_requested = excluded.cancel_requested,
           updated_at = excluded.updated_at`,
        {
          id: row.id,
          waiting: waiting ? 1 : 0,
          since: numberOrNull(anyTimeMs(topic.waitingSince, NaN)),
          until: numberOrNull(untilMs),
          cancel: cancelRequested ? 1 : 0,
          at: anyTimeMs(topic.updatedAt, atMs),
        }
      );
      report.imported.presence += 1;
    }

    // ── tasks ──
    for (const task of Array.isArray(topic.tasks) ? topic.tasks : []) {
      insertTask(db, { row, legacyKey, task, atMs, report });
    }

    // 其余 legacy 字段：审计已裁定丢弃，如实记账
    if (Array.isArray(topic.subs) && topic.subs.length) {
      report.discarded.push({ what: 'topic.subs', key: legacyKey, count: topic.subs.length, note: '代码 0 引用' });
    }
    if (topic.submitSummary) {
      report.discarded.push({ what: 'topic.submitSummary', key: legacyKey, count: 1, note: '队列是开发侧概念，不进库' });
    }
  }

  // next_seq = max(seq)+1（只增不减；编号复用会让历史引用指向另一条任务）
  for (const [, row] of byNewKey) {
    db.run('UPDATE topics SET next_seq = :n WHERE id = :id', { n: (row.maxSeq || 0) + 1, id: row.id });
  }

  return { byLegacyKey, byNewKey };
}

function numberOrNull(n) {
  return Number.isFinite(n) ? n : null;
}

function insertTask(db, { row, legacyKey, task, atMs, report }) {
  const mapped = mapLegacyStatus(task);
  report.distribution[mapped.status] = (report.distribution[mapped.status] || 0) + 1;
  if (mapped.unknown) {
    report.warnings.push({
      what: 'task.status',
      why: `未知状态 ${JSON.stringify(task && task.status)} → 当 pending`,
      key: legacyKey,
      id: task && task.id,
    });
  }
  if (mapped.archived) {
    report.warnings.push({ what: 'task.status', why: 'archived（本机实测 0 条，按判据第 4 步处理）', key: legacyKey, id: task && task.id });
  }

  const seq = Math.trunc(Number(task && task.id) || 0);
  if (!seq) {
    report.warnings.push({ what: 'task', why: 'id 缺失/非法，无法保持编号', key: legacyKey, id: task && task.id });
    // 编号是身份的一部分：丢一条 / 改一个号都会让「id N 当初指的是哪条」失效。
    // 数据损坏必须整体拒绝（事务回滚、JSON 不动），不能悄悄补一条。
    throw new Error(`legacy 数据损坏：队列 ${legacyKey} 里有任务缺 id（${JSON.stringify(task && task.id)}）`);
  }
  if (row.taken.has(seq)) {
    throw new Error(
      `legacy 数据损坏：队列 ${legacyKey} 里 id ${seq} 重复（tasks.seq 必须与源 id 一一对应）`
    );
  }
  row.taken.add(seq);
  if (seq > row.maxSeq) row.maxSeq = seq;

  const rawBody = String((task && task.text) ?? '');
  let body = rawBody;
  const ext = {};
  if (body.length > MAX_BODY) {
    body = body.slice(0, MAX_BODY);
    ext.ext_body_truncated = 1;
    report.warnings.push({ what: 'task.body', why: `正文超长已截断（${rawBody.length} > ${MAX_BODY}）`, key: legacyKey, id: seq });
  }

  // 审计裁定不建列 → 存 ext 或直接丢弃（都要记账，避免"静默没了"）
  if (task.pickupSec !== undefined) ext.ext_pickup_sec = Number(task.pickupSec) || 0;
  if (task.trashIndex !== undefined) ext.ext_trash_index = Number(task.trashIndex) || 0;
  if (task.ready !== undefined) ext.ext_ready = task.ready ? 1 : 0;
  if (mapped.archived) ext.ext_archived = 1;
  if (task.archivedAt) ext.ext_archived_at = stringOrNull(task.archivedAt);
  if (task.archivedReason) ext.ext_archived_reason = String(task.archivedReason);
  if (task.supersededBy !== undefined && task.supersededBy !== '') ext.ext_superseded_by = task.supersededBy;
  // history[] 整体丢弃（旧"同一条任务内的编辑记录"这个概念随派生模型一起消失）；
  // 非空时存 ext 取证，本机实测 1 条且为 []。
  if (Array.isArray(task.history) && task.history.length) {
    ext.ext_legacy_history = task.history;
    report.discarded.push({ what: 'task.history', key: legacyKey, id: seq, count: task.history.length });
  }
  if (task.remote !== undefined) report.discarded.push({ what: 'task.remote', key: legacyKey, id: seq, count: 1 });
  if (task.claimedBy !== undefined || task.claimedFrom !== undefined || task.claimedByName !== undefined) {
    report.discarded.push({ what: 'task.claimedBy/From/ByName', key: legacyKey, id: seq, count: 1 });
  }
  if (task.migratedTo !== undefined) report.discarded.push({ what: 'task.migratedTo', key: legacyKey, id: seq, count: 1 });

  const createdAt = anyTimeMs(task.createdAt, atMs);
  const updatedAt = anyTimeMs(task.updatedAt, createdAt);
  let claimedAt = numberOrNull(anyTimeMs(task.consumedAt, NaN));
  // 新词直通行可能缺 consumedAt（领取时刻没落 JSON）→ 用创建时刻兜底：
  // 「有 claimed 词却没有领取时刻」比「补一个近似时刻」更糟（verify 的不变量会挂）。
  if (mapped.status === 'claimed' && claimedAt === null) claimedAt = numberOrNull(createdAt);

  let doneAt = null;
  let feedback = '';
  let feedbackAt = null;
  if (mapped.status === 'done') {
    // completedAt 在本机全为空（7 条是空串键）→ 回落到 updatedAt
    doneAt = numberOrNull(anyTimeMs(task.completedAt, NaN));
    if (doneAt === null) doneAt = updatedAt;
    feedback = String(task.roundSummary ?? '');
    feedbackAt = doneAt;
  } else if (mapped.hasSummary) {
    // 非 done 行却有非空 roundSummary：不能塞进 feedback（那是 done 的语义），
    // 但也不能丢 → 存 ext 取证。
    ext.ext_legacy_round_summary = String(task.roundSummary);
    report.warnings.push({ what: 'task.roundSummary', why: `状态 ${mapped.status} 但有非空 roundSummary，已存 ext`, key: legacyKey, id: seq });
  }

  const round = (Number(task.reopenCount) || 0) + 1;
  if (task.reopenCount) report.discarded.push({ what: 'task.reopenCount', key: legacyKey, id: seq, count: 1, note: '→ round = reopenCount+1' });

  db.run(
    `INSERT INTO tasks (topic_id, seq, type, status, version, body, ext, feedback, feedback_at,
                        from_src, blocks_following, claimed_at, done_at, round, deleted_at,
                        created_at, updated_at)
     VALUES (:topic, :seq, '', :status, 0, :body, :ext, :feedback, :feedbackAt,
             :from, :blocks, :claimedAt, :doneAt, :round, :deletedAt, :createdAt, :updatedAt)`,
    {
      topic: row.id,
      seq,
      status: mapped.status,
      body,
      ext: jsonText(ext),
      feedback,
      feedbackAt,
      from: String(task.from || ''),
      blocks: task.blocksFollowing ? 1 : 0,
      claimedAt,
      doneAt,
      round,
      // 软删与状态正交：deletedAt 非空就写 deleted_at，状态照上面的判据走
      deletedAt: numberOrNull(anyTimeMs(task.deletedAt, NaN)),
      createdAt,
      updatedAt,
    }
  );
  report.imported.tasks += 1;

  // 内嵌 timegoal → goals（本机 7 条键存在但值全为 null，实际 0 条）
  if (task.timegoal && typeof task.timegoal === 'object') {
    insertGoal(db, { topicId: row.id, seq, legacyKey, timegoal: task.timegoal, claimedAt, createdAt, report });
    report.discarded.push({ what: 'task.timegoal', key: legacyKey, id: seq, count: 1, note: '已迁入 goals' });
  } else if (task.timegoal === null) {
    report.discarded.push({ what: 'task.timegoal', key: legacyKey, id: seq, count: 1, note: '值为 null，无目标可迁' });
  }
}

function insertGoal(db, { topicId, seq, legacyKey, timegoal, claimedAt, createdAt, report }) {
  const taskRow = db.get('SELECT id FROM tasks WHERE topic_id = :t AND seq = :s', { t: topicId, s: seq });
  if (!taskRow) return;
  const durationSec = Math.trunc(Number(timegoal.durationSec) || 0);
  const startedAt = anyTimeMs(timegoal.startedAt, NaN);
  const start = Number.isFinite(startedAt) ? startedAt : claimedAt || createdAt;
  const deadline = anyTimeMs(timegoal.deadline, NaN);
  const end = Number.isFinite(deadline) ? deadline : start + durationSec * 1000;
  // CHECK (duration_sec > 0) / CHECK (deadline > started_at)：不满足就不插，
  // 记报告（脏数据不能让整个迁移回滚）
  if (durationSec <= 0 || end <= start) {
    report.warnings.push({ what: 'goal', why: '时长或截止时刻非法，已跳过', key: legacyKey, id: seq });
    return;
  }
  const res = db.run(
    `INSERT INTO goals (task_id, duration_sec, started_at, deadline, prompt, state, version,
                        deleted_at, created_at, updated_at)
     VALUES (:task, :dur, :start, :deadline, :prompt, '', 0, NULL, :at, :at)`,
    {
      task: taskRow.id,
      dur: durationSec,
      start,
      deadline: end,
      prompt: String(timegoal.prompt || ''),
      at: start,
    }
  );
  report.imported.goals += 1;

  for (const log of Array.isArray(timegoal.log) ? timegoal.log : []) {
    const at = anyTimeMs(log.at, NaN);
    if (!Number.isFinite(at)) continue;
    db.run(
      `INSERT INTO goal_checks (goal_id, at, elapsed_sec, remaining_sec, overtime_sec, reached, summary)
       VALUES (:g, :at, :elapsed, :remaining, :overtime, :reached, :summary)`,
      {
        g: res.lastInsertRowid,
        at,
        elapsed: Math.trunc(Number(log.elapsedSec) || 0),
        remaining: Math.trunc(Number(log.remainingSec) || 0),
        overtime: Math.trunc(Number(log.overtimeSec) || 0),
        reached: log.reached ? 1 : 0,
        summary: String(log.summary || ''),
      }
    );
    report.imported.goalChecks += 1;
  }
}

// ─── task_links / task_deps ───────────────────────────────────────────

/** `"topicKey:id"` → { legacyKey, seq }；解析不出来返回 null。 */
export function parseTaskRef(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const at = s.lastIndexOf(':');
  if (at <= 0) return null;
  const seq = Math.trunc(Number(s.slice(at + 1)) || 0);
  if (!seq) return null;
  return { legacyKey: s.slice(0, at), seq };
}

function importLinksAndDeps(db, localtasksData, byLegacyKey, atMs, report) {
  const topics = (localtasksData && localtasksData.topics) || {};
  const resolve = (ref) => {
    const parsed = parseTaskRef(ref);
    if (!parsed) return null;
    const topic = byLegacyKey.get(parsed.legacyKey);
    if (!topic) return null;
    const row = db.get('SELECT id FROM tasks WHERE topic_id = :t AND seq = :s', { t: topic.id, s: parsed.seq });
    return row ? row.id : null;
  };

  for (const [legacyKey, t] of Object.entries(topics)) {
    const tasks = Array.isArray(t && t.tasks) ? t.tasks : [];
    for (const task of tasks) {
      const srcId = resolve(`${legacyKey}:${task.id}`);
      if (!srcId) continue;

      // 派生链：forkOf → task_links（方向恒为 新 → 旧，一个任务只有一个来源）
      if (task.forkOf) {
        const dstId = resolve(task.forkOf);
        if (!dstId) {
          report.warnings.push({ what: 'link', why: 'forkOf 解析失败，已丢弃', key: legacyKey, id: task.id, ref: task.forkOf });
        } else if (dstId !== srcId) {
          const type = ['comment', 'reopen', 'feedback'].includes(task.forkKind) ? task.forkKind : 'reopen';
          try {
            db.run(
              `INSERT INTO task_links (src_id, dst_id, type, note, created_at)
               VALUES (:src, :dst, :type, '', :at)`,
              { src: srcId, dst: dstId, type, at: anyTimeMs(task.createdAt, atMs) }
            );
            report.imported.links += 1;
          } catch (err) {
            report.warnings.push({ what: 'link', why: String(err && err.message), key: legacyKey, id: task.id });
          }
        }
      }

      // 编排依赖：blockBy[] → task_deps（一条脏边不能整体回滚）
      for (const ref of Array.isArray(task.blockBy) ? task.blockBy : []) {
        const depId = resolve(ref);
        if (!depId) {
          report.warnings.push({ what: 'dep', why: 'blockBy 解析失败，已丢弃', key: legacyKey, id: task.id, ref });
          continue;
        }
        if (depId === srcId) {
          report.warnings.push({ what: 'dep', why: 'blockBy 指向自己，已丢弃', key: legacyKey, id: task.id });
          continue;
        }
        db.run(
          `INSERT INTO task_deps (task_id, dep_id, created_at) VALUES (:t, :d, :at)
           ON CONFLICT(task_id, dep_id) DO NOTHING`,
          { t: srcId, d: depId, at: atMs }
        );
        report.imported.deps += 1;
      }
    }
  }
}

// ─── goals（timegoals.json，队列级丢弃）────────────────────────────────

function importStandaloneGoals(db, timegoalsData, byLegacyKey, report) {
  const goals = timegoalsData && timegoalsData.goals && typeof timegoalsData.goals === 'object'
    ? timegoalsData.goals
    : {};
  for (const [scope, g] of Object.entries(goals)) {
    if (!scope.startsWith('task:')) {
      // 队列级目标（键就是 `<topicKey>`）：队列是容器，没有"交付"这件事 → 丢弃 + 报告
      report.discarded.push({ what: 'timegoal(queue-scope)', scope, count: 1, note: '只保留任务级目标' });
      continue;
    }
    const parsed = parseTaskRef(scope.slice('task:'.length));
    const topic = parsed ? byLegacyKey.get(parsed.legacyKey) : null;
    if (!topic) {
      report.warnings.push({ what: 'goal', why: '作用域里的队列对不上，已丢弃', scope });
      continue;
    }
    const taskRow = db.get('SELECT id, claimed_at, created_at FROM tasks WHERE topic_id = :t AND seq = :s', {
      t: topic.id,
      s: parsed.seq,
    });
    if (!taskRow) {
      report.warnings.push({ what: 'goal', why: '作用域里的任务对不上，已丢弃', scope });
      continue;
    }
    const durationSec = Math.trunc(Number(g.durationSec) || 0);
    const start = anyTimeMs(g.startedAt, NaN);
    const startMs = Number.isFinite(start) ? start : taskRow.claimed_at || taskRow.created_at;
    const deadlineRaw = anyTimeMs(g.deadline, NaN);
    const deadline = Number.isFinite(deadlineRaw) ? deadlineRaw : startMs + durationSec * 1000;
    if (durationSec <= 0 || deadline <= startMs) {
      report.warnings.push({ what: 'goal', why: '时长或截止时刻非法，已跳过', scope });
      continue;
    }
    const res = db.run(
      `INSERT INTO goals (task_id, duration_sec, started_at, deadline, prompt, state, version,
                          deleted_at, created_at, updated_at)
       VALUES (:task, :dur, :start, :deadline, :prompt, :state, 0, :deleted, :at, :updated)`,
      {
        task: taskRow.id,
        dur: durationSec,
        start: startMs,
        deadline,
        prompt: String(g.prompt || ''),
        state: String(g.state || ''),
        deleted: g.archivedAt ? anyTimeMs(g.archivedAt, null) : null,
        at: startMs,
        updated: anyTimeMs(g.updatedAt, startMs),
      }
    );
    report.imported.goals += 1;
    for (const log of Array.isArray(g.log) ? g.log : []) {
      const at = anyTimeMs(log.at, NaN);
      if (!Number.isFinite(at)) continue;
      db.run(
        `INSERT INTO goal_checks (goal_id, at, elapsed_sec, remaining_sec, overtime_sec, reached, summary)
         VALUES (:g, :at, :elapsed, :remaining, :overtime, :reached, :summary)`,
        {
          g: res.lastInsertRowid,
          at,
          elapsed: Math.trunc(Number(log.elapsedSec) || 0),
          remaining: Math.trunc(Number(log.remainingSec) || 0),
          overtime: Math.trunc(Number(log.overtimeSec) || 0),
          reached: log.reached ? 1 : 0,
          summary: String(log.summary || ''),
        }
      );
      report.imported.goalChecks += 1;
    }
  }
}

// ─── refs / ref_bindings（从 docs 树 + DocRef 重建）─────────────────────

/** docs 树的相对路径 → POSIX（库里的地址永远是正斜杠）。 */
function toPosix(rel) {
  return rel.split(sep).join('/');
}

/** 递归收集 docs 树里的 .md（返回 POSIX 相对路径）。 */
export function listDocFiles(docsRoot) {
  const out = [];
  if (!docsRoot || !existsSync(docsRoot)) return out;
  const walk = (dir, prefix) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, prefix ? `${prefix}/${e.name}` : e.name);
      else if (/\.md$/i.test(e.name)) out.push(prefix ? `${prefix}/${e.name}` : e.name);
    }
  };
  walk(docsRoot, '');
  return out.map(toPosix).sort();
}

/**
 * 索引层初值：`refs` 从来没有过 JSON 数据源，只能从两处重建 ——
 *   1. `repos.json` 的 DocRef（doc / docLinks / repoDocs）
 *   2. `docs/` 树扫描（未被任何 DocRef 指到的 → state='orphan'）
 * 另外按**约定路径**把"仓库介绍 / 组介绍 / 组内成员说明"绑到宿主上
 * （`repo/<key>.md`、`board/<slug>.md`、`group/<slug>/<key>.md`，以及它们的
 *  目录主篇 `<dir>/index.md`）。约定路径是 docs 模块读文档时的回落顺序，
 * 迁移时按同一顺序探一次，绑定关系才不会丢。
 */
function importRefs(db, reposData, docsRoot, atMs, report) {
  const files = listDocFiles(docsRoot);
  if (!files.length) return;
  const fileSet = new Set(files);
  for (const locator of files) {
    db.run(
      `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
       VALUES (:id, 'md', :locator, 'orphan', 0, NULL, :at, :at)
       ON CONFLICT(id) DO NOTHING`,
      { id: refIdOf(locator), locator, at: atMs }
    );
    report.imported.refs += 1;
  }

  const bind = (repoKey, groupKey, locator, type, position, note) => {
    if (!fileSet.has(locator)) return false;
    const id = refIdOf(locator);
    db.run(`UPDATE refs SET state = '' WHERE id = :id`, { id });
    // ON CONFLICT 的冲突目标带表达式（COALESCE）在 SQLite 里要写成一模一样的表达式，
    // 这里用 INSERT OR IGNORE：绑定边重复插是幂等的正常情况，不该报错。
    db.run(
      `INSERT OR IGNORE INTO ref_bindings (repo_key, group_key, ref_id, type, position, note, created_at)
       VALUES (:repo, :group, :ref, :type, :pos, :note, :at)`,
      { repo: repoKey, group: groupKey, ref: id, type, pos: position, note, at: atMs }
    );
    report.imported.refBindings += 1;
    return true;
  };

  const repos = Array.isArray(reposData && reposData.repos) ? reposData.repos : [];
  const boards = Array.isArray(reposData && reposData.boards) ? reposData.boards : [];

  // DocRef（本机 repos.json 没有这些字段，代码保留给别的机器）
  const docRefsOf = (host) => {
    const out = [];
    const pushRef = (ref, note = '') => {
      if (!ref || typeof ref !== 'object') return;
      const rel = String(ref.rel || '').trim();
      const path = String(ref.path || '').trim();
      if (rel) out.push({ locator: rel, type: 'md', note: String(ref.tag || note || ''), extPath: '' });
      else if (path) out.push({ locator: path, type: 'path', note: String(ref.tag || note || ''), extPath: path });
    };
    pushRef(host && host.doc);
    for (const l of Array.isArray(host && host.docLinks) ? host.docLinks : []) pushRef(l);
    if (host && host.repoDocs && typeof host.repoDocs === 'object') {
      for (const [k, v] of Object.entries(host.repoDocs)) pushRef(v, k);
    }
    return out;
  };

  let position = 0;
  for (const r of repos) {
    const key = String((r && r.key) || '').trim();
    if (!key) continue;
    // 约定路径：目录主篇优先，其次旧单文件（与 docs 模块的读回落顺序一致）
    position = 0;
    const boundMain = bind(key, null, `repo/${key}/index.md`, 'repo', position, '');
    if (!boundMain) bind(key, null, `repo/${key}.md`, 'repo', position, '');
    position += 1;
    for (const d of docRefsOf(r)) {
      if (d.extPath) {
        // 外部路径（Obsidian 等）：只在库里留地址，字节在库外
        db.run(
          `INSERT OR IGNORE INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
           VALUES (:id, :type, :locator, '', 0, NULL, :at, :at)`,
          { id: refIdOf(d.locator), type: d.type, locator: d.locator, at: atMs }
        );
        report.imported.refs += 1;
      }
      db.run(
        `INSERT OR IGNORE INTO ref_bindings (repo_key, group_key, ref_id, type, position, note, created_at)
         VALUES (:repo, NULL, :ref, 'repo', :pos, :note, :at)`,
        { repo: key, ref: refIdOf(d.locator), pos: position, note: d.note, at: atMs }
      );
      report.imported.refBindings += 1;
      position += 1;
    }
  }

  // 组（boards）自身的介绍 + 组内成员说明
  for (const b of boards) {
    const name = String((b && b.name) || '').trim();
    if (!name) continue;
    // 组 key 在 importRepos 里可能加了冲突后缀，这里按 type='group' 反查真实 key
    const base = groupKeyOf(name);
    const groupRow =
      db.get("SELECT key FROM repos WHERE key = :k AND type = 'group'", { k: base }) ||
      db.get("SELECT key FROM repos WHERE type = 'group' AND name = :n", { n: name });
    const gk = groupRow ? groupRow.key : base;
    const seg = base.slice('group/'.length);
    const boundGroup = bind(gk, null, `board/${seg}/index.md`, 'group', 0, '');
    if (!boundGroup) bind(gk, null, `board/${seg}.md`, 'group', 0, '');
    for (const repoKeyRaw of Array.isArray(b.repoKeys) ? b.repoKeys : []) {
      const repoKey = String(repoKeyRaw || '').trim();
      if (!repoKey) continue;
      const boundMember = bind(repoKey, gk, `group/${seg}/${repoKey}/index.md`, 'group_repo', 0, '');
      if (!boundMember) bind(repoKey, gk, `group/${seg}/${repoKey}.md`, 'group_repo', 0, '');
    }
  }

  // 没被任何绑定引用的 ref 保持 state='orphan'（面板要能列出"孤儿文档"）
  const orphans = db.get("SELECT count(*) AS c FROM refs WHERE state = 'orphan'");
  if (orphans && orphans.c) {
    report.warnings.push({ what: 'refs', why: '孤儿文档（未被任何宿主绑定）', count: Number(orphans.c) });
  }
}

// ─── templates / settings ─────────────────────────────────────────────

function importTemplates(db, templatesData, atMs, report) {
  const list = Array.isArray(templatesData && templatesData.templates) ? templatesData.templates : [];
  const defaultId = String((templatesData && templatesData.defaultId) || '');
  list.forEach((t, index) => {
    const id = String((t && t.id) || '').trim();
    if (!id) return;
    // legacy 只有"新建任务的骨架正文"这一种用途 → category='newtask'
    db.run(
      `INSERT INTO templates (id, category, name, slot, body, vars_schema, vars, is_default,
                              enabled, sort_order, builtin, state, version, deleted_at,
                              created_at, updated_at)
       VALUES (:id, 'newtask', :name, 'suffix', :body, '[]', :vars, :isDefault,
               1, :sort, :builtin, '', 0, NULL, :at, :at)
       ON CONFLICT(id) DO NOTHING`,
      {
        id,
        name: String(t.name || id),
        body: String(t.body || ''),
        vars: jsonText(t.values && typeof t.values === 'object' ? t.values : {}),
        isDefault: id === defaultId ? 1 : 0,
        sort: index,
        builtin: t.builtin ? 1 : 0,
        at: atMs,
      }
    );
    report.imported.templates += 1;
  });
}

function setSetting(db, key, value, atMs) {
  db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (:k, :v, :at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { k: key, v: jsonText(value), at: atMs }
  );
}

function importSettings(db, localtasksData, configData, atMs, report) {
  const lt = (localtasksData && localtasksData.settings) || null;
  if (lt && typeof lt === 'object') {
    for (const k of LOCALTASK_SETTING_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(lt, k)) continue;
      setSetting(db, 'lt.' + k, lt[k], atMs);
      report.imported.settings += 1;
    }
  }
  if (configData && typeof configData === 'object') {
    // 白名单写入：**只**这四个偏好。token / baseUrl / email / userId / groupId
    // 是凭据与会话身份，绝不允许进库（库会被备份、dump、拷走排障）。
    for (const k of CONFIG_PREF_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(configData, k)) continue;
      setSetting(db, 'app.' + k, configData[k], atMs);
      report.imported.settings += 1;
    }
  }
}

// ─── 主入口 ───────────────────────────────────────────────────────────

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
