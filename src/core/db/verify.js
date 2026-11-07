// 迁移后的逐项校验（`nx-kv db verify`）。
//
// 位置很关键：这些断言**不靠肉眼**。R1（把 `consumed` 整体当 `claimed`）的表现是
// 「62 条已交付任务被打成在干，done 全部消失，面板统计全错，而且不报错」——
// 唯一的发现方式是把它写成可执行断言。所以这里逐条给出：
//
//   · 结构：store_kind / user_version / 表行数 / integrity_check / foreign_key_check
//   · 词表语义：done 必有 done_at 与 feedback；claimed 必有 claimed_at 且无 done_at；
//               pending 无 done_at
//   · 身份：每个 topics.key 必须等于 `topicKeyOf(cwd, group_key)`
//   · 编号：`next_seq > max(seq)`（编号只增不减）
//   · 正文：逐条 sha256(body) == sha256(legacy.text)（全量比对，75 条没成本）
//
// 校验结果不抛错（CLI 用它渲染报告），由调用方决定退出码。
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { topicKeyOf } from '../topic-key.js';
import { CURRENT_SCHEMA_VERSION } from './version.js';
import { inspectStore } from './bootstrap.js';
import { getMeta } from './migrator.js';
import { MAX_BODY } from './import-json.js';

/** 所有业务表的行数（`db status` / `db verify` 共用一份清单）。 */
export const COUNTED_TABLES = [
  'repos',
  'repo_group_members',
  'topics',
  'tasks',
  'topic_presence',
  'task_links',
  'task_deps',
  'goals',
  'goal_checks',
  'refs',
  'ref_bindings',
  'task_refs',
  'ref_relations',
  'templates',
  'settings',
];

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

/** 各表行数。 */
export function tableCounts(db) {
  const out = {};
  for (const t of COUNTED_TABLES) {
    const row = db.get(`SELECT count(*) AS c FROM ${t}`);
    out[t] = Number((row && row.c) || 0);
  }
  return out;
}

/** 任务状态分布。 */
export function statusDistribution(db) {
  const rows = db.all('SELECT status, count(*) AS c FROM tasks GROUP BY status');
  const out = { pending: 0, claimed: 0, done: 0, cancelled: 0 };
  for (const r of rows) out[r.status] = Number(r.c);
  return out;
}

/**
 * 找一份可用来对账的 legacy localtasks JSON：优先未改名的主文件，否则取最新的
 * `localtasks.migrated-*.json`。找不到返回 `null`（校验会跳过正文比对并说明原因）。
 */
export function findLegacyLocalTasks(appDir) {
  const candidates = [];
  const push = (name, priority) => candidates.push({ path: join(appDir, name), priority });
  push('localtasks.json', 0);
  let entries = [];
  try {
    entries = readdirSync(appDir);
  } catch {
    entries = [];
  }
  // 定宽时间戳 → 字典序即时间序；同类按名字**倒序**取最新
  const migratedLocal = entries.filter((f) => /^localtasks\.migrated-.*\.json$/i.test(f)).sort().reverse();
  for (const f of migratedLocal) push(f, 1);
  push('sessiontasks.json', 2);
  const migratedSession = entries.filter((f) => /^sessiontasks\.migrated-.*\.json$/i.test(f)).sort().reverse();
  for (const f of migratedSession) push(f, 3);

  // 优先级即口径：`localtasks.json` 是主文件，`sessiontasks.json` 只是改名前的旧文件，
  // 两者**任务数不同**（本机 75 vs 49），挑错了会让校验结论完全失真。
  candidates.sort((a, b) => a.priority - b.priority);
  for (const c of candidates) {
    try {
      return { path: c.path, data: JSON.parse(readFileSync(c.path, 'utf8')) };
    } catch {
      /* 下一个 */
    }
  }
  return null;
}

function parseExt(raw) {
  try {
    const v = JSON.parse(String(raw || '{}'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * 逐项校验。
 *
 * @param {object} db 连接
 * @param {object} [opts]
 * @param {string} opts.appDir legacy 数据目录（用来对账正文哈希）
 * @returns {{ok: boolean, checks: Array<{name: string, ok: boolean, detail?: string}>,
 *            counts: object, distribution: object, state: object}}
 */
export function verifyStore(db, { appDir } = {}) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });

  // ── 结构与版本 ──
  const state = inspectStore(db);
  add('meta.store_kind = sqlite', state.storeKind === 'sqlite', String(state.storeKind));
  add(
    `user_version = ${CURRENT_SCHEMA_VERSION}`,
    state.userVersion === CURRENT_SCHEMA_VERSION,
    String(state.userVersion)
  );
  const metaSchema = getMeta(db, 'schema_version');
  add('meta.schema_version 与 user_version 一致', metaSchema === String(state.userVersion), String(metaSchema));

  const integrity = db.get('PRAGMA integrity_check');
  const integrityText = integrity ? Object.values(integrity).join(',') : '';
  add('integrity_check = ok', integrityText === 'ok', integrityText);

  const fk = db.all('PRAGMA foreign_key_check');
  add('foreign_key_check 无违规', fk.length === 0, fk.length ? JSON.stringify(fk.slice(0, 5)) : '');

  // ── 词表语义（机器可检的形式）──
  const dist = statusDistribution(db);
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  const doneBad = Number(
    (db.get("SELECT count(*) AS c FROM tasks WHERE status = 'done' AND (done_at IS NULL OR feedback = '')") || {}).c || 0
  );
  add('done 行都有 done_at 与非空 feedback', doneBad === 0, `违规 ${doneBad} 条`);

  const claimedBad = Number(
    (db.get("SELECT count(*) AS c FROM tasks WHERE status = 'claimed' AND (claimed_at IS NULL OR done_at IS NOT NULL)") || {}).c || 0
  );
  add('claimed 行有 claimed_at 且 done_at 为空', claimedBad === 0, `违规 ${claimedBad} 条`);

  const pendingBad = Number(
    (db.get("SELECT count(*) AS c FROM tasks WHERE status = 'pending' AND done_at IS NOT NULL") || {}).c || 0
  );
  add('pending 行 done_at 为空', pendingBad === 0, `违规 ${pendingBad} 条`);

  const statusTotal = Number((db.get('SELECT count(*) AS c FROM tasks') || {}).c || 0);
  add('状态分布合计 = tasks 行数', total === statusTotal, `${total} vs ${statusTotal}`);

  // ── topics.key 是 (cwd, group_key) 的纯函数 ──
  const topics = db.all('SELECT id, key, cwd, group_key, next_seq FROM topics');
  const keyBad = [];
  for (const t of topics) {
    const expect = topicKeyOf(t.cwd, t.group_key || '');
    if (expect !== t.key) keyBad.push({ id: t.id, key: t.key, expect });
  }
  add('topics.key = topicKeyOf(cwd, group_key)', keyBad.length === 0, JSON.stringify(keyBad.slice(0, 5)));

  // ── 跨表类型硬规则（FOREIGN KEY 只能保证"行存在"，保证不了"类型对"）──
  const topicGroupBad = Number(
    (db.get(
      `SELECT count(*) AS c FROM topics t LEFT JOIN repos r ON r.key = t.group_key
        WHERE t.group_key IS NOT NULL AND (r.key IS NULL OR r.type <> 'group')`
    ) || {}).c || 0
  );
  add('topics.group_key 指向 type=group 的行', topicGroupBad === 0, `违规 ${topicGroupBad} 条`);

  const topicRepoBad = Number(
    (db.get(
      `SELECT count(*) AS c FROM topics t LEFT JOIN repos r ON r.key = t.repo_key
        WHERE r.key IS NULL OR r.type = 'group'`
    ) || {}).c || 0
  );
  add('topics.repo_key 指向非组行', topicRepoBad === 0, `违规 ${topicRepoBad} 条`);

  const memberTypeBad = Number(
    (db.get(
      `SELECT count(*) AS c FROM repo_group_members m
         LEFT JOIN repos g ON g.key = m.group_key
         LEFT JOIN repos r ON r.key = m.repo_key
        WHERE g.key IS NULL OR g.type <> 'group' OR r.key IS NULL OR r.type = 'group'`
    ) || {}).c || 0
  );
  add('repo_group_members：group_key 是组、repo_key 是仓库', memberTypeBad === 0, `违规 ${memberTypeBad} 条`);

  const bindTypeBad = Number(
    (db.get(
      `SELECT count(*) AS c FROM ref_bindings b
         LEFT JOIN repos h ON h.key = b.repo_key
         LEFT JOIN repos g ON g.key = b.group_key
        WHERE h.key IS NULL
           OR (b.type = 'group' AND h.type <> 'group')
           OR (b.type <> 'group' AND h.type = 'group')
           OR (b.group_key IS NOT NULL AND (g.key IS NULL OR g.type <> 'group'))`
    ) || {}).c || 0
  );
  add('ref_bindings：repo/group 宿主类型正确', bindTypeBad === 0, `违规 ${bindTypeBad} 条`);

  // ── 编号只增不减 ──
  const seqBad = [];
  for (const t of topics) {
    const row = db.get('SELECT max(seq) AS m, count(*) AS c FROM tasks WHERE topic_id = :id', { id: t.id });
    const maxSeq = Number((row && row.m) || 0);
    const cnt = Number((row && row.c) || 0);
    if (cnt > 0 && Number(t.next_seq) <= maxSeq) seqBad.push({ id: t.id, next_seq: t.next_seq, maxSeq });
    if (cnt === 0 && Number(t.next_seq) < 1) seqBad.push({ id: t.id, next_seq: t.next_seq, maxSeq: 0 });
  }
  add('每个队列 next_seq > max(seq)', seqBad.length === 0, JSON.stringify(seqBad.slice(0, 5)));

  // ── 正文哈希 + seq 一一对应（对账 legacy JSON）──
  let legacy = null;
  let hashDetail = '未找到可对账的 legacy JSON（跳过）';
  let hashOk = true;
  if (appDir) {
    legacy = findLegacyLocalTasks(appDir);
    if (legacy) {
      const topicByLegacyKey = new Map();
      for (const t of topics) {
        const ext = parseExt(db.get('SELECT ext FROM topics WHERE id = :id', { id: t.id })?.ext);
        if (ext.ext_legacy_key) topicByLegacyKey.set(String(ext.ext_legacy_key), t);
      }
      const legacyTopics = (legacy.data && legacy.data.topics) || {};
      const problems = [];
      let compared = 0;
      let legacyTasks = 0;
      for (const [legacyKey, lt] of Object.entries(legacyTopics)) {
        const topic = topicByLegacyKey.get(legacyKey);
        const tasks = Array.isArray(lt && lt.tasks) ? lt.tasks : [];
        legacyTasks += tasks.length;
        if (!topic) {
          problems.push({ legacyKey, why: '队列未迁移' });
          continue;
        }
        for (const task of tasks) {
          compared += 1;
          const row = db.get('SELECT body, seq FROM tasks WHERE topic_id = :t AND seq = :s', {
            t: topic.id,
            s: Math.trunc(Number(task.id) || 0),
          });
          if (!row) {
            problems.push({ legacyKey, id: task.id, why: '任务未迁移' });
            continue;
          }
          const srcText = String((task && task.text) ?? '');
          const expectText = srcText.length > MAX_BODY ? srcText.slice(0, MAX_BODY) : srcText;
          if (Number(row.seq) !== Math.trunc(Number(task.id) || 0)) {
            problems.push({ legacyKey, id: task.id, why: `seq 漂移 → ${row.seq}` });
          }
          if (sha256(row.body) !== sha256(expectText)) {
            problems.push({ legacyKey, id: task.id, why: 'body 哈希不一致' });
          }
        }
      }
      hashOk = problems.length === 0;
      hashDetail = `比对 ${compared}/${legacyTasks} 条；问题 ${problems.length} 条${
        problems.length ? '：' + JSON.stringify(problems.slice(0, 5)) : ''
      }`;
      add('每条 task 的 body 哈希 = 原 text', hashOk, hashDetail);
      // 对账口径是 **≥** 而不是 =：库是活数据，迁移后又会新增任务、老 JSON 快照
      // 不会跟 —— 要求相等会让任何真实使用过的库永远红一条（T07 裁决）。
      add(
        'legacy 任务数 ≤ 迁移后任务数（库是活数据，允许新增）',
        legacyTasks <= statusTotal,
        `${legacyTasks} vs ${statusTotal}`
      );
    } else {
      add('每条 task 的 body 哈希 = 原 text', true, hashDetail);
    }
  }

  const counts = tableCounts(db);
  return {
    ok: checks.every((c) => c.ok),
    checks,
    counts,
    distribution: dist,
    state,
  };
}
