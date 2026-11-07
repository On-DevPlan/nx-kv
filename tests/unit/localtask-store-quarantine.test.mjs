// 「坏数据不炸服务」的 DB 时代对应测试（原 JSON 损坏隔离在 core 的 JSON store 层，随 T03 下线）：
//   1. legacy JSON 损坏 → 导入器报警告、跳过，服务照常打开（空库可重建）；
//   2. 库文件被写成垃圾（别人误占路径）→ NotNxKvStoreError 拒绝，原文件不动；
//   3. 打开失败可重试：换一个干净路径即恢复（库文件可重建 = 无数据损失）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sb = mkdtempSync(join(tmpdir(), 'nx-kv-store-quarantine-'));
mkdirSync(sb, { recursive: true });
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');

const svc = await import('../../src/modules/localtask/service.js');

test('legacy JSON 损坏 → 导入器警告跳过，服务照常打开（空库可重建）', async () => {
  // 预置一份坏 JSON（模拟导入源损坏）
  writeFileSync(join(sb, 'localtasks.json'), '{ this is not json !!!', 'utf8');
  const s = await svc.loadStore();
  assert.deepEqual(s.topics, {}, '损坏 → 导入跳过，空库打开');
  // 服务可正常写读（空库可重建 = 无数据损失）
  const a = await svc.addTask({ cwd: join(sb, 'proj'), text: '照常可用' });
  assert.equal(a.task.text, '照常可用');
});

test('库文件被别的 SQLite 内容占用 → NotNxKvStoreError 拒绝，原文件不动', async () => {
  const sb2 = mkdtempSync(join(tmpdir(), 'nx-kv-store-foreign-'));
  process.env.NX_KV_LOCALTASK_STORE = join(sb2, 'localtasks.json');
  try {
    const { openRaw } = await import('../../src/core/db/index.js');
    const foreign = openRaw(join(sb2, 'nxkv.db'));
    foreign.exec('CREATE TABLE not_ours (a INTEGER)');
    foreign.close();

    await assert.rejects(() => svc.addTask({ cwd: join(sb2, 'p'), text: 'x' }), /缺 meta.store_kind/);
    // 原文件没被改：还是只有那张外来表
    const check = openRaw(join(sb2, 'nxkv.db'), { readOnly: true });
    const names = check
      .all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .map((r) => r.name);
    check.close();
    assert.deepEqual(names, ['not_ours'], '别人的库一个字节都不该被改');
  } finally {
    process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
    svc.resetLocaltaskStore();
    rmSync(sb2, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('打开失败可重试：换干净路径即恢复（库文件可重建 = 无数据损失）', async () => {
  const sb3 = mkdtempSync(join(tmpdir(), 'nx-kv-store-retry-'));
  process.env.NX_KV_LOCALTASK_STORE = join(sb3, 'localtasks.json');
  try {
    const a = await svc.addTask({ cwd: join(sb3, 'p'), text: '新库照常' });
    assert.equal(a.task.text, '新库照常');
  } finally {
    svc.closeDb();
    process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
    svc.resetLocaltaskStore();
    rmSync(sb3, { recursive: true, force: true, maxRetries: 3 });
  }
});
