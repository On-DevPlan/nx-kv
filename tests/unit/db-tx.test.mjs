// 事务语义：同步体强制、嵌套 SAVEPOINT、回滚、dry-run、深度归零。
//
// 这个文件的第一条断言是全项目最重要的一条：`tx(async () => …)` 必须**立刻抛**，
// 因为「第一个 await 之后 COMMIT 已执行」会让后续写入落到事务外且不报错 ——
// 那是静默丢写，靠人工 review 是抓不住的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from '../support/test-store.mjs';

const rowsOf = (db, sql = 'SELECT count(*) AS c FROM settings') => Number(db.get(sql).c);

test('tx 返回值原样透出，并在 COMMIT 后可见', async () => {
  const s = await createTestStore();
  try {
    const { tx } = s.core;
    const out = tx(() => {
      s.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('k1', '\"v\"', 1)");
      return 'ok';
    });
    assert.equal(out, 'ok');
    assert.equal(rowsOf(s.db), 1);
  } finally {
    s.reset();
  }
});

test('tx 检测到 async 事务体立刻抛 TypeError，且不留下任何写入', async () => {
  const s = await createTestStore();
  try {
    const { tx } = s.core;
    assert.throws(
      () =>
        tx(async () => {
          s.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('async', '1', 1)");
        }),
      (err) => {
        assert.equal(err.name, 'TypeError');
        assert.match(err.message, /事务体必须是同步函数/);
        return true;
      }
    );
    assert.equal(rowsOf(s.db), 0, 'async 事务体不该留下任何行（已 ROLLBACK）');
    assert.equal(s.core.txDepth(s.db), 0);
  } finally {
    s.reset();
  }
});

test('事务体内抛错 → 整体回滚', async () => {
  const s = await createTestStore();
  try {
    const { tx } = s.core;
    s.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('before', '1', 1)");
    assert.throws(() =>
      tx(() => {
        s.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('inside', '1', 1)");
        throw new Error('boom');
      })
    );
    assert.equal(rowsOf(s.db), 1, '只有事务外那条留下');
    assert.equal(s.db.get("SELECT count(*) AS c FROM settings WHERE key = 'inside'").c, 0);
  } finally {
    s.reset();
  }
});

test('嵌套 tx → SAVEPOINT：内层回滚不影响外层', async () => {
  const s = await createTestStore();
  try {
    const { tx } = s.core;
    let innerThrew = false;
    tx(() => {
      s.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('outer', '1', 1)");
      try {
        tx(() => {
          s.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('inner', '1', 1)");
          throw new Error('inner boom');
        });
      } catch {
        innerThrew = true;
      }
    });
    assert.equal(innerThrew, true);
    assert.equal(rowsOf(s.db), 1);
    assert.equal(s.db.get("SELECT count(*) AS c FROM settings WHERE key = 'outer'").c, 1);
    assert.equal(s.db.get("SELECT count(*) AS c FROM settings WHERE key = 'inner'").c, 0);
  } finally {
    s.reset();
  }
});

test('嵌套事务体返回 Promise 也抛 TypeError（不能只在顶层拦）', async () => {
  const s = await createTestStore();
  try {
    const { tx } = s.core;
    assert.throws(
      () =>
        tx(() => {
          tx(async () => {
            /* 什么都不做 */
          });
        }),
      /事务体必须是同步函数/
    );
  } finally {
    s.reset();
  }
});

test('rollback 选项：事务体完整跑完但收尾回滚（--dry-run 的落地方式）', async () => {
  const s = await createTestStore();
  try {
    const { tx } = s.core;
    const out = tx(
      () => {
        s.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('dry', '1', 1)");
        return 'planned';
      },
      { rollback: true }
    );
    assert.equal(out, 'planned', '事务体的返回值照样要能拿到（是演练结果，不是失败）');
    assert.equal(rowsOf(s.db), 0, 'ROLLBACK 后库里没有数据');
  } finally {
    s.reset();
  }
});

test('事务深度在成功与失败后都归零（否则下一次 tx 会误判为嵌套）', async () => {
  const s = await createTestStore();
  try {
    const { tx } = s.core;
    assert.equal(tx(() => 1), 1);
    assert.equal(s.core.txDepth(s.db), 0);
    assert.throws(() => tx(() => { throw new Error('x'); }));
    assert.equal(s.core.txDepth(s.db), 0);
    // 深度归零的证据：这一次仍然走顶层 BEGIN（不是 SAVEPOINT）
    assert.equal(tx(() => 2), 2);
  } finally {
    s.reset();
  }
});

test('驱动入站归一：undefined/boolean/Date 都能绑定（22.x 原生会抛 cannot be bound）', async () => {
  const s = await createTestStore();
  try {
    s.db.exec('CREATE TEMP TABLE t (a, b, c)');
    // 原生 node:sqlite 22.x：绑 undefined 抛 ERR_INVALID_ARG_TYPE，绑 true 同样。
    // driver 统一归一成 null / 0|1 / epoch ms。
    s.db.run('INSERT INTO t VALUES (:a, :b, :c)', { a: undefined, b: true, c: new Date(1700000000000) });
    const row = s.db.get('SELECT a, b, c FROM t');
    assert.deepEqual(row, { a: null, b: 1, c: 1700000000000 });
  } finally {
    s.reset();
  }
});

test('驱动出站归一：行对象是普通对象（deepEqual / JSON.stringify 正常）', async () => {
  const s = await createTestStore();
  try {
    const row = s.db.get('SELECT 1 AS a, 2 AS b');
    assert.equal(Object.getPrototypeOf(row), Object.prototype);
    assert.deepEqual(row, { a: 1, b: 2 });
    assert.equal(typeof JSON.parse(JSON.stringify(row)).a, 'number');
    assert.equal(s.db.get('SELECT * FROM settings WHERE 1 = 0'), null, '没有行返回 null，不是 undefined');
  } finally {
    s.reset();
  }
});
