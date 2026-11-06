import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPluginIds } from '../../src/modules/tasktool/plugins/container.js';
import { discoverPlugins } from '../../src/modules/tasktool/plugins/discover.js';
import { submit, get } from '../../src/modules/tasktool/facade/index.js';
import { closeDb } from '../../src/modules/localtask/repo/index.js';

test('discoverPlugins：目录扫描注册四插件', async () => {
  await discoverPlugins();
  for (const id of ['blockgoal', 'waitgoal', 'timegoal', 'taskgoal']) {
    assert.ok(listPluginIds().includes(id), id);
  }
});

test('facade submit：返回 workflowId；可带 text 入队', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nxkv-facade-'));
  const prev = process.env.NX_KV_LOCALTASK_STORE;
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
  try {
    const r = await submit({ cwd: dir, text: 'hello from facade' });
    assert.equal(r.status, 'ok');
    assert.ok(r.workflowId);
    assert.equal(r.task?.text, 'hello from facade');
  } finally {
    if (prev === undefined) delete process.env.NX_KV_LOCALTASK_STORE;
    else process.env.NX_KV_LOCALTASK_STORE = prev;
    // T03：先关库连接再删临时目录（Windows 连接开着必 EBUSY）；env 已还原，
    // 下一次 open 会按新路径重开。
    closeDb();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('facade get：AsyncIterable 可拉取入队任务', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nxkv-facade-get-'));
  const prev = process.env.NX_KV_LOCALTASK_STORE;
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
  try {
    const sub = await submit({ cwd: dir, text: 'pull-me' });
    const items = [];
    for await (const x of get(sub.workflowId, undefined, { summary: 't' })) {
      items.push(x);
      break;
    }
    assert.equal(items.length, 1);
    assert.equal(items[0].text, 'pull-me');
  } finally {
    if (prev === undefined) delete process.env.NX_KV_LOCALTASK_STORE;
    else process.env.NX_KV_LOCALTASK_STORE = prev;
    // T03：先关库连接再删临时目录（Windows 连接开着必 EBUSY）；env 已还原，
    // 下一次 open 会按新路径重开。
    closeDb();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});
