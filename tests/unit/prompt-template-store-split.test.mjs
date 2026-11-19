// #238 细粒度化：上一版把整份 Store 写在一个键 `prompt.tplStore` 里，现在按段拆成
// `prompt.tpl.<segment>`。迁移要满足：拆开、删旧键、各段数据不串。
//
// 单独一个文件：迁移按「库路径」记账，一个进程只跑一次，不能和别的迁移用例共库。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'nx-kv-prompttpl-split-'));
process.env.NX_KV_HOME = join(root, 'home');

const { openStore, closeDb } = await import('../../src/core/db/index.js');
const { writeSettingRaw } = await import('../../src/core/db/settings.js');

// 按上一版的形态种一份整份键（含一个脏条目，顺带验校验仍生效）
writeSettingRaw(openStore(), 'prompt.tplStore', {
  ack: { activeId: 'u_a', items: [{ id: 'u_a', name: 'ack 旧版', text: 'ack 正文', createdAt: 1 }] },
  timecheck: {
    activeId: 'u_t',
    items: [
      { id: 'u_t', name: 'timecheck 旧版', text: 'check 正文', createdAt: 2 },
      { id: 'builtin', name: '脏条目', text: '不该收', createdAt: 3 },
    ],
  },
});

const { segmentTemplatesOf, upsertTemplate, segmentKey, WHOLE_STORE_KEY } = await import(
  '../../src/modules/promptplug/template-store.js'
);

test('整份键 → 按段键：拆开、删旧键、脏条目仍被丢', () => {
  const ack = segmentTemplatesOf('ack');
  assert.equal(ack.activeId, 'u_a');
  assert.equal(ack.items[0].text, 'ack 正文');

  const check = segmentTemplatesOf('timecheck');
  assert.equal(check.items.length, 1, 'id=builtin 的脏条目仍不收');
  assert.equal(check.items[0].text, 'check 正文');

  const db = openStore();
  assert.ok(db.get('SELECT value FROM settings WHERE key = :k', { k: segmentKey('ack') }), 'ack 应已有独立键');
  assert.ok(db.get('SELECT value FROM settings WHERE key = :k', { k: segmentKey('timecheck') }), 'timecheck 应已有独立键');
  assert.equal(db.get('SELECT value FROM settings WHERE key = :k', { k: WHOLE_STORE_KEY }), null, '整份键应已删除');
});

test('拆完之后只动自己那一段：写 ack 不影响 timecheck', () => {
  upsertTemplate({ segment: 'ack', name: 'ack 新版', text: 'ack 新正文' });
  const db = openStore();
  assert.equal(
    JSON.parse(db.get('SELECT value FROM settings WHERE key = :k', { k: segmentKey('timecheck') }).value).items[0].text,
    'check 正文',
  );
});

test('清理临时目录（先关连接）', () => {
  closeDb();
  rmSync(root, { recursive: true, force: true });
  assert.ok(true);
});
