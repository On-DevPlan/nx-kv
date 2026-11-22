// #180：侧栏命名空间配置落 settings 表（app.sidebarNamespaces 单个 JSON 字段）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig } from '../../src/core/config.js';

let root = '';
test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nxkv-ns-setting-'));
  process.env.NX_KV_HOME = join(root, 'home');
  process.env.NX_KV_DB = join(root, 'db.sqlite');
});

test('命名空间配置写进 settings 表并能读回（含 focus）', async () => {
  await saveConfig({
    ...(await loadConfig()),
    sidebarNamespaces: {
      groups: [
        { id: 'ns_data', name: '数据', items: ['repo:one', 'one', 'board:b1'], pinned: true },
        { id: 'bad' }, // 缺 name → 归一丢弃
      ],
      focus: 'ns_data',
    },
  });
  const cfg = await loadConfig();
  assert.equal(cfg.sidebarNamespaces.focus, 'ns_data');
  assert.equal(cfg.sidebarNamespaces.groups.length, 1);
  const g = cfg.sidebarNamespaces.groups[0];
  assert.deepEqual(g.items, ['one', 'board:b1'], 'repo: 前缀归一、重复去重');
  assert.equal(g.pinned, true);
});

test('空 / 非法配置归一为 { groups: [], focus: "" }，不炸读取', async () => {
  await saveConfig({ ...(await loadConfig()), sidebarNamespaces: 'not-an-object' });
  const cfg = await loadConfig();
  assert.deepEqual(cfg.sidebarNamespaces, { groups: [], focus: '' });
});
