#!/usr/bin/env node
// 排障用的库检视器（`node scripts/db-inspect.mjs`）。
//
// 与 `nx-kv db status` 的分工：那个给"一眼看状态"，这个给"翻数据"——
// 可以看某张表的若干行、可以跑一条只读 SQL。两者都**不触发导入**：
// 排障工具顺手改库是最糟的设计。
//
// 用法：
//   node scripts/db-inspect.mjs                     统计 + 校验结论
//   node scripts/db-inspect.mjs --tables            表清单与行数
//   node scripts/db-inspect.mjs --topics            队列概览
//   node scripts/db-inspect.mjs --table tasks --limit 3
//   node scripts/db-inspect.mjs --sql "SELECT status, count(*) c FROM tasks GROUP BY status"
//   node scripts/db-inspect.mjs --json              机器可读（脚本里用）
//
// 库路径与 legacy 目录同样认 NX_KV_DB / NX_KV_HOME（测试与多实例用）。
//
// 源码是 TS：所有 `xxx.js` 路径都要靠 tsx loader 解析到同名 `.ts`（与 bin/kv.mjs
// 同一条执行路径）。注册 loader 不导入业务代码，所以先注册再查 Node 版本仍有效。
import { register } from 'tsx/esm/api';

register();

const { checkNodeVersion } = await import('../src/core/db/version.js');

const versionCheck = checkNodeVersion();
if (!versionCheck.ok) {
  console.error(versionCheck.message);
  process.exit(1);
}

const { openStore, closeDb, inspectStore } = await import('../src/core/db/index.js');
const { tableCounts, statusDistribution, verifyStore, COUNTED_TABLES } = await import(
  '../src/core/db/verify.js'
);
const { APP_DIR } = await import('../src/core/paths.js');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback = '') => {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const jsonOut = has('--json');

const db = openStore({ importLegacyData: false });

try {
  const state = inspectStore(db);
  const counts = tableCounts(db);
  const distribution = statusDistribution(db);
  const out = { state, counts, distribution };

  if (has('--sql')) {
    const sql = String(valueOf('--sql')).trim();
    // 只读闸门：排障工具不该能改数据，也不该能把 schema 改坏
    if (!/^select\b/i.test(sql) && !/^pragma\b/i.test(sql) && !/^with\b/i.test(sql)) {
      console.error('只允许 SELECT / WITH / PRAGMA（这是排障工具，不是 SQL 控制台）');
      process.exit(1);
    }
    const rows = db.all(sql);
    if (jsonOut) console.log(JSON.stringify({ sql, rows }, null, 2));
    else {
      console.log(`SQL: ${sql}`);
      console.log(rows.length ? JSON.stringify(rows, null, 2) : '（0 行）');
    }
    closeDb();
    process.exit(0);
  }

  if (has('--table')) {
    const table = String(valueOf('--table'));
    if (!COUNTED_TABLES.includes(table)) {
      console.error(`未知表: ${table}（可用: ${COUNTED_TABLES.join(', ')}）`);
      process.exit(1);
    }
    const limit = Math.max(1, Math.min(200, Number(valueOf('--limit', '10')) || 10));
    const rows = db.all(`SELECT * FROM ${table} LIMIT ${limit}`);
    if (jsonOut) console.log(JSON.stringify({ table, rows }, null, 2));
    else {
      console.log(`${table}（前 ${limit} 行，共 ${counts[table]} 行）`);
      console.log(JSON.stringify(rows, null, 2));
    }
    closeDb();
    process.exit(0);
  }

  if (has('--tables')) {
    if (jsonOut) console.log(JSON.stringify(counts, null, 2));
    else {
      const width = Math.max(...Object.keys(counts).map((k) => k.length));
      for (const [k, v] of Object.entries(counts)) console.log(`${k.padEnd(width + 2)}${v}`);
    }
    closeDb();
    process.exit(0);
  }

  if (has('--topics')) {
    const rows = db.all(
      `SELECT t.id, t.key, t.cwd, t.name, t.repo_key, t.next_seq,
              (SELECT count(*) FROM tasks k WHERE k.topic_id = t.id) AS tasks,
              json_extract(t.ext, '$.ext_legacy_key') AS legacy_key
         FROM topics t
        WHERE t.deleted_at IS NULL
        ORDER BY tasks DESC, t.id`
    );
    if (jsonOut) console.log(JSON.stringify(rows, null, 2));
    else {
      console.log('id  key               tasks  next_seq  repo_key       cwd');
      for (const r of rows) {
        console.log(
          `${String(r.id).padEnd(4)}${String(r.key).padEnd(18)}${String(r.tasks).padEnd(7)}` +
            `${String(r.next_seq).padEnd(10)}${String(r.repo_key).padEnd(15)}${r.cwd}`
        );
      }
    }
    closeDb();
    process.exit(0);
  }

  // 默认：统计 + 校验
  const verified = verifyStore(db, { appDir: APP_DIR });
  out.verify = { ok: verified.ok, checks: verified.checks };
  if (jsonOut) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`库: ${state.path}`);
    console.log(
      `store_kind=${state.storeKind || '（缺失）'}  user_version=${state.userVersion}  tables=${state.tables}`
    );
    console.log('');
    const width = Math.max(...Object.keys(counts).map((k) => k.length));
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(width + 2)}${v}`);
    console.log('');
    console.log(
      `任务: pending=${distribution.pending} claimed=${distribution.claimed} ` +
        `done=${distribution.done} cancelled=${distribution.cancelled}`
    );
    console.log('');
    for (const c of verified.checks) {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  -- ' + c.detail : ''}`);
    }
  }
  closeDb();
  process.exit(verified.ok ? 0 : 1);
} catch (err) {
  closeDb();
  console.error('检视失败:', err && err.message ? err.message : err);
  process.exit(1);
}
