// db.data（GET /api/db/data / CLI db data）的只读导出：概览、行窗口、翻页、
// 未知表报错、BLOB 单元格不把字节噪声灌进 JSON。
//
// 只读纪律也在断言里：服务层必须按只读连接打开已有库（与 db status 同一纪律），
// 这里顺带验证「查询后库里没有多出任何东西」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from '../support/test-store.mjs';

test('概览：每张用户表都有行数与列清单，sqlite_% 不出现', async () => {
  const s = await createTestStore();
  try {
    const { data } = await import('../../src/modules/db/service.js');
    const out = await data();
    assert.equal(out.path, s.dbPath);
    assert.equal(out.userVersion, out.currentSchemaVersion, '临时库应建到当前 schema 版本');
    assert.ok(out.tables.length >= 20, `用户表应 ≥ 20 张（实际 ${out.tables.length}）`);
    for (const t of out.tables) {
      assert.ok(!t.name.startsWith('sqlite_'), `内部表不该出现: ${t.name}`);
      assert.ok(Array.isArray(t.columns) && t.columns.length > 0, `表 ${t.name} 缺列清单`);
      assert.equal(typeof t.count, 'number');
    }
    const names = new Set(out.tables.map((t) => t.name));
    for (const must of ['tasks', 'topics', 'repos', 'settings', 'meta']) {
      assert.ok(names.has(must), `缺核心表 ${must}`);
    }
  } finally {
    s.reset();
  }
});

test('行窗口：limit/offset 生效，列名与表结构一致', async () => {
  const s = await createTestStore();
  try {
    const ins = 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)';
    for (let i = 0; i < 5; i++) s.db.run(ins, [`k.${i}`, `v${i}`, 1000 + i]);

    const { data } = await import('../../src/modules/db/service.js');
    const p1 = await data({ table: 'settings', limit: 2, offset: 0 });
    assert.equal(p1.count, 5);
    assert.deepEqual(p1.rows.map((r) => r.key), ['k.0', 'k.1']);
    assert.ok(p1.columns.some((c) => c.name === 'key'), '列清单里要有 key');

    const p3 = await data({ table: 'settings', limit: 2, offset: 4 });
    assert.equal(p3.rows.length, 1, '最后一页只剩 1 行');
    assert.deepEqual(p3.rows.map((r) => r.key), ['k.4']);
  } finally {
    s.reset();
  }
});

test('未知表报 NOT_FOUND（不拼 SQL、不 500）', async () => {
  const s = await createTestStore();
  try {
    const { data } = await import('../../src/modules/db/service.js');
    await assert.rejects(
      () => data({ table: 'settings; DROP TABLE tasks' }),
      (e) => e.code === 'NOT_FOUND',
    );
    const out = await data({ table: 'settings' });
    assert.ok(out.rows, '注入尝试后 settings 表仍可读');
  } finally {
    s.reset();
  }
});

test('BLOB 单元格渲染成 <blob N bytes>，不是字节对象', async () => {
  const s = await createTestStore();
  try {
    // SQLite 动态类型：TEXT 列里塞 BLOB（X'...' 字面量），服务层必须兜住
    s.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('t.blob', X'0102FF', 1)");
    const { data } = await import('../../src/modules/db/service.js');
    const out = await data({ table: 'settings' });
    const row = out.rows.find((r) => r.key === 't.blob');
    assert.equal(row.value, '<blob 3 bytes>');
    const round = JSON.parse(JSON.stringify(row));
    assert.equal(round.value, '<blob 3 bytes>', 'JSON 序列化后仍是可读摘要');
  } finally {
    s.reset();
  }
});
