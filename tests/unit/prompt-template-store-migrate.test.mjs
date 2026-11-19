// #238：legacy JSON（~/.nx-kv/promptplug-templates.json）→ settings 的一次性迁移。
//
// 单独一个文件：迁移只在「settings 还没有 prompt.tplStore」时发生，和主测试
// （先跑一堆 upsert 把键写出来）不能共进程。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'nx-kv-prompttpl-mig-'));
process.env.NX_KV_HOME = join(root, 'home');

const home = process.env.NX_KV_HOME;
mkdirSync(home, { recursive: true });
const legacyFile = join(home, 'promptplug-templates.json');
writeFileSync(
  legacyFile,
  JSON.stringify({
    timecheck: {
      activeId: 'u_old',
      items: [
        { id: 'u_old', name: '老模板', text: '老的严格指令 {{task.id}}', createdAt: 1 },
        { id: 'builtin', name: '脏条目', text: '不该收', createdAt: 2 },
      ],
    },
    doneguard: { activeId: 'u_gone', items: [] },
  }),
  'utf8',
);

const { segmentTemplatesOf, activeTemplateTextOf, allSegmentTemplates, segmentKey, WHOLE_STORE_KEY } = await import(
  '../../src/modules/promptplug/template-store.js'
);
const { openStore, closeDb } = await import('../../src/core/db/index.js');

test('首次读取：legacy JSON 自动摊成按段键，legacy 文件改名 .migrated（不删）', () => {
  const seg = segmentTemplatesOf('timecheck');
  assert.equal(seg.activeId, 'u_old');
  assert.equal(seg.items.length, 1, 'builtin 条目是脏数据，不收');
  assert.equal(seg.items[0].text, '老的严格指令 {{task.id}}');
  assert.equal(activeTemplateTextOf('timecheck'), '老的严格指令 {{task.id}}');

  const row = openStore().get('SELECT value FROM settings WHERE key = :k', { k: segmentKey('timecheck') });
  assert.ok(row, '迁移后应有 prompt.tpl.timecheck');
  assert.equal(JSON.parse(row.value).items[0].name, '老模板');
  assert.equal(openStore().get('SELECT value FROM settings WHERE key = :k', { k: WHOLE_STORE_KEY }), null);

  assert.equal(existsSync(legacyFile), false, '原文件应已改名');
  assert.ok(existsSync(`${legacyFile}.migrated`), '改名而不是删除');
  assert.match(readFileSync(`${legacyFile}.migrated`, 'utf8'), /老的严格指令/, '留档可回看');
});

test('迁移只跑一次：再写再读仍以库为准，不被 legacy 覆盖', () => {
  const all = allSegmentTemplates();
  assert.equal(all.timecheck.activeId, 'u_old');
  // 回写一份 legacy（模拟用户从旧版本目录拷回文件）：键已存在，不该再导入
  writeFileSync(legacyFile, JSON.stringify({ timecheck: { activeId: 'u_new', items: [] } }), 'utf8');
  assert.equal(segmentTemplatesOf('timecheck').activeId, 'u_old', '库值优先，不重跑迁移');
  rmSync(legacyFile, { force: true });
});

test('清理临时目录（先关连接）', () => {
  closeDb();
  rmSync(root, { recursive: true, force: true });
  assert.ok(true);
});
