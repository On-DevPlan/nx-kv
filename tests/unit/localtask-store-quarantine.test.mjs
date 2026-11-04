// loadStore 损坏隔离：坏文件改名保留（.corrupt-*），绝不被下次 save 覆盖掉
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sb = mkdtempSync(join(tmpdir(), 'nx-kv-store-quarantine-'));
mkdirSync(sb, { recursive: true });
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');

const svc = await import('../../src/modules/localtask/service.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const corruptsOf = () =>
  readdirSync(sb)
    .filter((f) => f.startsWith('localtasks.json.corrupt-'))
    .sort();

test('损坏文件 → 改名隔离 + 空 store + save 后备份仍在', async () => {
  const p = process.env.NX_KV_LOCALTASK_STORE;
  writeFileSync(p, '{ this is not json !!!', 'utf8');
  const s = await svc.loadStore();
  assert.deepEqual(s.topics, {}, '损坏 → 空 store');
  assert.ok(!existsSync(p), '原路径不应再有坏文件');
  const corrupts = corruptsOf();
  assert.equal(corrupts.length, 1, '坏文件应被改名保留一份');
  assert.match(readFileSync(join(sb, corrupts[0]), 'utf8'), /not json/, '备份内容 = 原坏文件');
  await svc.saveStore(s);
  assert.equal(corruptsOf().length, 1, '正常写路径后备份仍在（未被覆盖）');
  assert.ok(existsSync(p), 'save 后新 store 已就位');
});

test('文件不存在（首次启动）→ 空 store 且不产生备份', async () => {
  const sb2 = mkdtempSync(join(tmpdir(), 'nx-kv-store-fresh-'));
  const prev = process.env.NX_KV_LOCALTASK_STORE;
  process.env.NX_KV_LOCALTASK_STORE = join(sb2, 'localtasks.json');
  try {
    const s = await svc.loadStore();
    assert.deepEqual(s.topics, {});
    assert.equal(readdirSync(sb2).filter((f) => f.includes('.corrupt-')).length, 0, '缺失不算损坏');
  } finally {
    process.env.NX_KV_LOCALTASK_STORE = prev;
    rmSync(sb2, { recursive: true, force: true });
  }
});

test('连续损坏 → 最多保留 3 份，留的是最新', async () => {
  const p = process.env.NX_KV_LOCALTASK_STORE;
  for (let i = 1; i <= 4; i++) {
    writeFileSync(p, `broken round ${i}`, 'utf8');
    const s = await svc.loadStore();
    assert.deepEqual(s.topics, {});
    if (i < 4) await sleep(5); // 文件名时间戳含毫秒，错开避免同名覆盖
  }
  const corrupts = corruptsOf();
  assert.ok(corrupts.length <= 3, `最多留 3 份，实际 ${corrupts.length}`);
  assert.match(readFileSync(join(sb, corrupts.at(-1)), 'utf8'), /round 4/, '留的是最新一份');
  assert.ok(!existsSync(p), '最后一份坏文件也已让位（原路径清空）');
});

test.after(() => {
  try {
    rmSync(sb, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
