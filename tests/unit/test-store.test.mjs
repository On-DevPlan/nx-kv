// tests/support/test-store.mjs 自身的单测：硬保险（非 tmpdir 拒绝）与清场纪律。
//
// 这条测试是夹具的「夹具」——assertUnderTmp 的价值是防止「夹具改错一处 →
// 测试污染用户真实数据」，所以它自己必须有回归测试钉住（T07 裁决）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertUnderTmp, createTestStore, readFixtureJson } from '../support/test-store.mjs';

test('assertUnderTmp：tmpdir 下放行（返回绝对路径）', () => {
  const p = join(tmpdir(), 'nx-kv-anything', 'nxkv.db');
  // 返回值是 resolve(p)：平台原生分隔符（Windows 反斜杠 / POSIX 正斜杠）——
  // 不能硬编码把 / 换成 \，Linux CI 上路径不变、断言必炸（2026-11-08 修）
  assert.equal(assertUnderTmp(p), resolve(p));
});

test('assertUnderTmp：用户真实目录直接抛错（绝不放行）', () => {
  const realHome = join(homedir(), '.nx-kv', 'nxkv.db');
  assert.throws(() => assertUnderTmp(realHome), /拒绝在非临时目录建库/);
  // 相对路径（解析后不在 tmpdir 下）同样拒绝
  assert.throws(() => assertUnderTmp('relative/nxkv.db'), /拒绝在非临时目录建库/);
  // Windows 盘符根目录拒绝
  assert.throws(() => assertUnderTmp('D:/somewhere/nxkv.db'), /拒绝在非临时目录建库/);
});

test('createTestStore：开库 / reset（关连接 + 删目录）/ 复用一致', async () => {
  const s = await createTestStore();
  try {
    assert.ok(existsSync(s.dbPath), '库文件已建');
    assert.ok(s.db, '连接已打开');
    // seedLegacy + seedDocs + seedFixtureDir 三个入口都在
    s.seedLegacy({ config: { token: 'x' } });
    assert.ok(existsSync(join(s.appDir, 'config.json')));
    s.seedDocs({ 'notes/a.md': '# A\n' });
    assert.ok(existsSync(join(s.appDir, 'docs', 'notes', 'a.md')));
    // 环境变量整包指向临时目录（子进程用）
    const env = s.env();
    assert.equal(env.NX_KV_DB, s.dbPath);
    assert.equal(env.NX_KV_HOME, s.appDir);
  } finally {
    s.reset();
  }
  assert.equal(existsSync(s.dir), false, 'reset 后临时目录被清掉');
});

test('readFixtureJson：能读 fixtures 下的 JSON（夹具挪位后路径仍成立）', () => {
  // 夹具从 tests/helpers/ 挪到 tests/support/ 后，内部 '../fixtures/' 相对路径
  // 必须仍然解析得到 —— 这条读不到就是挪坏了。
  const data = readFixtureJson('legacy-real-shape.json');
  assert.ok(data && typeof data === 'object' && data.topics && typeof data.topics === 'object', '真实形状夹具可读');
});

