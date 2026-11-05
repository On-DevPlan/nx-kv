// core/json-store.js（任务 #66 存储层隔离）单元测试。
//
// 钉住统一原语的契约——迁 SQLite 时就是按这份契约换 driver：
//   1. 原子写：tmp+rename，目录自动建、不留 .tmp；
//   2. load：缺失→empty、legacy 兜底、形状不认识→empty（不隔离）、损坏→隔离并轮转；
//   3. save：进程内串行（并发写不互相踩 tmp）、落盘内容即传入对象；
//   4. mutate：读-改-写，fn 抛错不落盘。
//
// 存储一律指向临时目录，绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteText, atomicWriteTextSync, createJsonStore } from '../../src/core/json-store.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-jstore-'));

process.on('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结果 */
  }
});

test('atomicWriteText：目录自动建、内容正确、不残留 .tmp', async () => {
  const dir = join(tmp, 'a', 'b');
  const p = join(dir, 'x.json');
  await atomicWriteText(p, '{"ok":1}');
  assert.equal(readFileSync(p, 'utf8'), '{"ok":1}');
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('atomicWriteTextSync：同上（同步路径，供 exit 钩子用）', () => {
  const dir = join(tmp, 'c');
  const p = join(dir, 'y.json');
  atomicWriteTextSync(p, '{"ok":2}');
  assert.equal(readFileSync(p, 'utf8'), '{"ok":2}');
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('load：缺失→empty；legacy 兜底只在新文件不存在时生效', async () => {
  const dir = join(tmp, 'legacy');
  mkdirSync(dir, { recursive: true });
  const main = join(dir, 'main.json');
  const legacy = join(dir, 'old.json');
  const store = createJsonStore({
    path: () => main,
    empty: () => ({ version: 1, items: [] }),
    legacyPath: () => legacy,
  });
  assert.deepEqual(await store.load(), { version: 1, items: [] }, '两文件都缺失 → empty');
  writeFileSync(legacy, JSON.stringify({ version: 0, items: [1, 2] }), 'utf8');
  assert.deepEqual(await store.load(), { version: 0, items: [1, 2] }, '主文件缺失 → 读 legacy');
  // normalize 深拷贝保护：load 两次返回不同对象（外部改动不串）
  const s1 = await store.load();
  s1.items.push(3);
  assert.deepEqual((await store.load()).items, [1, 2], 'load 返回的是新对象');
  writeFileSync(main, JSON.stringify({ version: 1, items: ['main'] }), 'utf8');
  assert.deepEqual((await store.load()).items, ['main'], '主文件在场后 legacy 不再被读');
});

test('load：normalize 返回 null（形状不认识）→ empty，不产生隔离备份', async () => {
  const dir = join(tmp, 'shape');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 's.json');
  writeFileSync(p, '42', 'utf8'); // 合法 JSON，但 normalize 不认识
  const store = createJsonStore({
    path: () => p,
    empty: () => ({ empty: true }),
    normalize: (d) => (d && typeof d === 'object' ? d : null),
  });
  assert.deepEqual(await store.load(), { empty: true });
  assert.equal(existsSync(p), true, '原文件保留（形状不认识 ≠ 文件坏了）');
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.corrupt-')), []);
});

test('load：JSON 损坏 → 隔离为 .corrupt-* 并落 empty；超出 keep 数删最旧', async () => {
  const dir = join(tmp, 'corrupt');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'c.json');
  const store = createJsonStore({
    path: () => p,
    empty: () => ({ recovered: true }),
    quarantineKeep: 2,
  });
  // 预置 2 份旧备份，占满 keep 配额
  writeFileSync(p + '.corrupt-20260101-000000-000', '{}', 'utf8');
  writeFileSync(p + '.corrupt-20260102-000000-000', '{}', 'utf8');
  writeFileSync(p, '{ broken', 'utf8');
  assert.deepEqual(await store.load(), { recovered: true }, '损坏 → empty');
  assert.equal(existsSync(p), false, '坏文件被改名隔离');
  let corrupts = readdirSync(dir).filter((f) => f.includes('.corrupt-')).sort();
  assert.equal(corrupts.length, 2, '预置 2 份 + 新 1 份 = 3 份，超出 keep=2 的最旧 1 份当场删除');
  assert.equal(corrupts.includes('c.json.corrupt-20260101-000000-000'), false, '最旧的被删');
  // 再来一次损坏：3 份 → 仍轮转到 2 份
  writeFileSync(p, '{ broken again', 'utf8');
  await store.load();
  corrupts = readdirSync(dir).filter((f) => f.includes('.corrupt-')).sort();
  assert.equal(corrupts.length, 2, '轮转后维持 keep 数');
});

test('save：并发写串行落盘，最终文件是最后一个写入者的内容，无 .tmp 残留', async () => {
  const dir = join(tmp, 'serial');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'w.json');
  const store = createJsonStore({ path: () => p });
  await Promise.all([
    store.save({ n: 1 }),
    store.save({ n: 2 }),
    store.save({ n: 3 }),
    store.save({ n: 4 }),
  ]);
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).n, 4);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('mutate：读-改-写原子生效；fn 抛错不落盘', async () => {
  const dir = join(tmp, 'mutate');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'm.json');
  writeFileSync(p, JSON.stringify({ count: 1 }), 'utf8');
  const store = createJsonStore({ path: () => p });
  const out = await store.mutate((d) => {
    d.count += 1;
    return d.count;
  });
  assert.equal(out, 2);
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).count, 2);
  await assert.rejects(
    () => store.mutate(() => { throw new Error('boom'); }),
    /boom/,
  );
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).count, 2, 'fn 抛错 → 不落盘');
});

test('load：normalize 抛错 = 损坏 → 走隔离（与返回 null 的语义区分开）', async () => {
  const dir = join(tmp, 'thrownorm');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 't.json');
  writeFileSync(p, '{"bad":1}', 'utf8');
  const store = createJsonStore({
    path: () => p,
    empty: () => ({ fallback: true }),
    normalize: () => { throw new Error('不认识'); },
    quarantineKeep: 1,
  });
  assert.deepEqual(await store.load(), { fallback: true });
  assert.equal(existsSync(p), false, 'normalize 抛错 → 文件被隔离');
  assert.equal(readdirSync(dir).filter((f) => f.includes('.corrupt-')).length, 1);
});
