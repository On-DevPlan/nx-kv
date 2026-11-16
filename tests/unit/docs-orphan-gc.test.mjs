// 孤儿 ref 到期清理（v11）：
//   · 孤儿 = 没有任何 ref_bindings 归属；解绑即写 orphan_since，重建索引不刷新；
//   · 到期只软删「空正文」孤儿（deleted_at），ref_bodies 保留；
//   · 有正文的到期孤儿只进清单（skippedWithBody），不自动删；
//   · ref_gc_log 留痕可回查；TTL 读设置（默认 3 天）；
//   · v10→v11 存量孤儿按升级时刻起算。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestStore } from '../support/test-store.mjs';

// **必须在 import 任何 src 模块之前**把 home 指到临时目录：
// core/paths.ts 的 APP_DIR 是 import 期算的模块常量，一旦它记成真实 ~/.nx-kv，
// 后续任何「无 path 的 openStore()」（addRepo → repos/repo/open 的懒打开）都会
// 带真实 appDir 去 bootstrap，把本机文档扫成 refs 灌进临时库——表现为
// 「空库里凭空多 11 条孤儿」（2026-11-16 实锤，本机 docs 树 11 篇）。
const BOOT = mkdtempSync(join(tmpdir(), 'nxkv-orphan-boot-'));
mkdirSync(join(BOOT, 'home'), { recursive: true });
process.env.NX_KV_HOME = join(BOOT, 'home');
process.env.NX_KV_DB = join(BOOT, 'nxkv.db');
process.env.NX_KV_DOCS_DIR = join(BOOT, 'home', 'docs');

const { addRepo, mutateStore } = await import('../../src/modules/repos/service.js');
const { createRef, unbindRef } = await import('../../src/modules/docs/service.js');
const { writeOwnDoc } = await import('../../src/modules/docs/store.js');
const { syncRefIndex } = await import('../../src/modules/docs/ref-sync.js');
const { listOrphans, sweepOrphans, DAY_MS } = await import('../../src/modules/docs/orphan.js');
const { setSettings } = await import('../../src/modules/setting/service.js');
const { getDb } = await import('../../src/core/db/index.js');
const { migrate, setMeta } = await import('../../src/core/db/migrator.js');

const REPO_KEY = 'github.com/me/x';

const row = (sql, params) => getDb().get(sql, params);

/** 临时库 + 把 config 的「无 path 打开」也钉在同一份临时库上，避免落到真实 ~/.nx-kv。 */
async function newStore(opts) {
  const s = await createTestStore(opts);
  // 无 path 的 openStore()（config 读设置会走）靠 NX_KV_DB 指到临时库；
  // 备份额 / 附件根也钉在临时 home，避免任何写路径落到真实 ~/.nx-kv。
  process.env.NX_KV_DB = s.dbPath;
  process.env.NX_KV_HOME = s.appDir;
  process.env.NX_KV_BACKUPS = join(s.appDir, 'backups');
  process.env.NX_KV_ATTACHMENTS = join(s.appDir, 'attachments');
  return s;
}

function dropStore(s) {
  delete process.env.NX_KV_DB;
  delete process.env.NX_KV_HOME;
  delete process.env.NX_KV_BACKUPS;
  delete process.env.NX_KV_ATTACHMENTS;
  s.reset();
}

async function seedRepo() {
  await addRepo({ path: 'D:/tmp/x', name: 'x', key: REPO_KEY });
}

/** 建一篇 ref 并解绑成孤儿；body 非空时先写入正文。 */
async function makeOrphan(s, desc, body = '') {
  const r = await createRef({ desc, owner: 'repo', repo: REPO_KEY });
  if (body) await writeOwnDoc(r.refId, body);
  await unbindRef({ ref: r.refId, type: 'repo', repo: REPO_KEY });
  const hit = row('SELECT state, orphan_since FROM refs WHERE id = :id', { id: r.refId });
  return { refId: r.refId, since: Number(hit.orphan_since), state: hit.state };
}

test('解绑即起算；重建索引不刷新；复绑清零', async () => {
  const s = await newStore();
  try {
    await seedRepo();
    const r = await createRef({ desc: '计时', owner: 'repo', repo: REPO_KEY });
    assert.equal(Number(row('SELECT orphan_since FROM refs WHERE id = :id', { id: r.refId }).orphan_since), 0, '有归属时不计时');

    await unbindRef({ ref: r.refId, type: 'repo', repo: REPO_KEY });
    const first = row('SELECT state, orphan_since FROM refs WHERE id = :id', { id: r.refId });
    assert.equal(first.state, 'orphan');
    assert.ok(Number(first.orphan_since) > 0, '解绑后立刻落失绑时间');

    // 重建索引：已在计时中的孤儿不能被刷新
    await syncRefIndex();
    assert.equal(
      Number(row('SELECT orphan_since FROM refs WHERE id = :id', { id: r.refId }).orphan_since),
      Number(first.orphan_since),
      '重建索引不得重置倒计时'
    );

    // 重新挂回仓库 → 计时清零
    await mutateStore((st) => {
      st.repos.find((x) => x.key === REPO_KEY).doc = { ref: r.refId };
    });
    await syncRefIndex();
    assert.equal(Number(row('SELECT orphan_since FROM refs WHERE id = :id', { id: r.refId }).orphan_since), 0);
  } finally {
    dropStore(s);
  }
});

test('到期边界：3 天内不删；到期只预演；--apply 只软删空壳，有正文只列清单', async () => {
  const s = await newStore();
  try {
    await seedRepo();
    const empty = await makeOrphan(s, '空壳孤儿');
    const withBody = await makeOrphan(s, '有正文孤儿', '# 正文\n\n这段内容不能静默删。');
    const ttl = 3;

    const before = await listOrphans({ ttlDays: ttl, now: empty.since + DAY_MS });
    assert.equal(before.total, 2);
    assert.equal(before.due, 0, '未满 3 天不得到期');
    assert.equal(before.dueSoon, 0, '剩余 2 天不属于「24h 内到期」');

    const now = empty.since + ttl * DAY_MS + 1000;
    const dueList = await listOrphans({ ttlDays: ttl, now });
    assert.equal(dueList.due, 2);
    assert.equal(dueList.dueEmpty, 1);
    assert.equal(dueList.dueWithBody, 1);

    const dry = await sweepOrphans({ apply: false, ttlDays: ttl, now });
    assert.equal(dry.dryRun, true);
    assert.deepEqual(dry.eligible, [empty.refId]);
    assert.equal(dry.deleted.length, 0);
    assert.equal(dry.skippedWithBody.length, 1);
    assert.equal(row('SELECT deleted_at FROM refs WHERE id = :id', { id: empty.refId }).deleted_at, null, '预演不得落盘');

    const done = await sweepOrphans({ apply: true, ttlDays: ttl, now });
    assert.equal(done.deleted.length, 1);
    assert.equal(done.deleted[0].refId, empty.refId);
    assert.equal(done.deleted[0].reason, 'orphan-ttl-expired');

    const erased = row('SELECT deleted_at FROM refs WHERE id = :id', { id: empty.refId });
    assert.equal(Number(erased.deleted_at), now, '软删时间 = 清理时刻');
    assert.equal(
      Number(row('SELECT count(*) AS c FROM ref_bodies WHERE ref_id = :id', { id: empty.refId }).c),
      1,
      '软删保留正文行'
    );
    const log = row('SELECT * FROM ref_gc_log WHERE ref_id = :id', { id: empty.refId });
    assert.equal(log.reason, 'orphan-ttl-expired');
    assert.equal(Number(log.deleted_at), now);
    assert.equal(Number(log.ttl_days), ttl);
    assert.equal(log.source, 'cli');

    // 有正文的孤儿仍然在清单里，且不会被自动删
    const bodyStill = row('SELECT deleted_at FROM refs WHERE id = :id', { id: withBody.refId });
    assert.equal(bodyStill.deleted_at, null);
    const after = await listOrphans({ ttlDays: ttl, now });
    assert.equal(after.total, 1);
    assert.equal(after.due, 1);
    assert.equal(after.dueWithBody, 1);
    assert.equal(after.recentDeletions.length, 1, '删除后能查到留痕');

    const again = await sweepOrphans({ apply: true, ttlDays: ttl, now: now + DAY_MS });
    assert.equal(again.deleted.length, 0, '有正文的孤儿永不自动删');
    assert.equal(again.skippedWithBody.length, 1);
  } finally {
    dropStore(s);
  }
});

test('TTL 读设置：orphanTtlDays=1 时 1 天即到期', async () => {
  const s = await newStore();
  try {
    await seedRepo();
    await setSettings({ orphanTtlDays: 1 });
    const o = await makeOrphan(s, '一天到期');

    const notYet = await listOrphans({ now: o.since + DAY_MS - 1000 });
    assert.equal(notYet.ttlDays, 1);
    assert.equal(notYet.due, 0);

    const due = await listOrphans({ now: o.since + DAY_MS + 1000 });
    assert.equal(due.dueEmpty, 1);
  } finally {
    dropStore(s);
  }
});

test('v10→v11：存量孤儿按升级时刻起算，有归属的清零', async () => {
  const s = await newStore({ open: false, bootstrap: false });
  try {
    const raw = s.core.openRaw(s.dbPath);
    try {
      migrate(raw, {
        from: 0,
        to: 10,
        context: {
          attachmentsRoot: join(s.appDir, 'attachments'),
          docsDir: join(s.appDir, 'docs'),
          atMs: Date.now(),
        },
      });
      setMeta(raw, 'store_kind', 'sqlite');
      raw.run(
        `INSERT INTO repos (key, type, name, created_at, updated_at)
         VALUES ('github.com/me/x', 'repo', 'x', 1, 1)`
      );
      raw.run(
        `INSERT INTO refs (id, type, locator, origin, state, version, deleted_at, created_at, updated_at)
         VALUES ('ref_orphan_v10', 'md', '', 'own', 'orphan', 0, NULL, 1, 1)`
      );
      raw.run(
        `INSERT INTO refs (id, type, locator, origin, state, version, deleted_at, created_at, updated_at)
         VALUES ('ref_bound_v10', 'md', '', 'own', '', 0, NULL, 1, 1)`
      );
      raw.run(
        `INSERT INTO ref_bindings (type, repo_key, group_key, ref_id, position, note, created_at)
         VALUES ('repo', 'github.com/me/x', NULL, 'ref_bound_v10', 0, '', 1)`
      );
    } finally {
      raw.close();
    }

    const at = Date.now();
    const db = s.core.openStore({
      path: s.dbPath,
      appDir: s.appDir,
      importLegacyData: false,
      atMs: at,
    });
    assert.equal(Number(db.get('PRAGMA user_version').user_version), 12);
    assert.ok(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='ref_gc_log'"));

    const orphan = db.get("SELECT state, orphan_since FROM refs WHERE id = 'ref_orphan_v10'");
    assert.equal(orphan.state, 'orphan');
    assert.equal(Number(orphan.orphan_since), at, '存量孤儿从升级时刻起算（3 天缓冲）');

    const bound = db.get("SELECT state, orphan_since FROM refs WHERE id = 'ref_bound_v10'");
    assert.equal(bound.state, '');
    assert.equal(Number(bound.orphan_since), 0);
    assert.equal(Number(db.get('SELECT count(*) AS c FROM ref_gc_log').c), 0, '迁移不清理任何东西');
  } finally {
    dropStore(s);
  }
});
