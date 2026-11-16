// 内置模板「出厂正文自愈」（#218）。
//
// 背景：旧模板编辑器把正文渲染后再给用户编辑，保存时把 `{{content}}` 写成了
// 提示文字（`（把你要问这个仓库的问题写在这里）`），库里因此留下一批没有插槽的
// 内置模板。seed 的 INSERT OR IGNORE 不会覆盖已有行，所以必须有一条**极窄**的
// 自愈：body 与「出厂文本渲染后的样子」逐字相同才恢复，差一个字都不动。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-seed-heal-'));
process.env.NX_KV_HOME = tmp;
process.env.NX_KV_DB = join(tmp, 'nxkv.db');
process.env.NX_KV_DOCS_DIR = join(tmp, 'docs');
process.env.NX_KV_CONFIG = join(tmp, 'config.json');

const { openStore, closeDb } = await import('../../src/core/db/index.js');
const { NEWTASK_REF_BODY, healRenderedBuiltinBodies, seedBuiltinTemplates } = await import(
  '../../src/core/db/seed-templates.js'
);

const BUILTIN_ID = 'newtask.ref';
const HINT = '（把你要问这个仓库的问题写在这里）';
/** 旧编辑器会写回库的样子：插槽变成默认提示文字、vars 被清空 */
const RENDERED = NEWTASK_REF_BODY.replace('{{content}}', HINT);

after(() => {
  try { closeDb(); } catch { /* 已关 */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

const bodyOf = (db) =>
  String((db.get('SELECT body, vars FROM templates WHERE id = :id', { id: BUILTIN_ID }) || {}).body || '');

test('出厂正文统一用 {{content}}', () => {
  assert.match(NEWTASK_REF_BODY, /\{\{\s*content\s*\}\}/);
  assert.ok(!NEWTASK_REF_BODY.includes('{{问题}}'), '旧槽位名不该再出现在出厂文本里');
});

test('被渲染过的内置正文 → 下次开库恢复成带插槽的出厂文本', () => {
  const db = openStore();
  assert.match(bodyOf(db), /\{\{\s*content\s*\}\}/, '新库直接是插槽版');

  // 模拟旧编辑器留下的产物
  db.run('UPDATE templates SET body = :b, vars = :v WHERE id = :id', { id: BUILTIN_ID, b: RENDERED, v: '{}' });
  assert.ok(!bodyOf(db).includes('{{content}}'), '前提：此时库里确实没有插槽了');

  const healed = healRenderedBuiltinBodies(db, Date.now());
  assert.deepEqual(healed, [BUILTIN_ID], '应认出并恢复内置模板');

  const row = db.get('SELECT body, vars FROM templates WHERE id = :id', { id: BUILTIN_ID });
  assert.match(String(row.body), /\{\{\s*content\s*\}\}/, '插槽回来了');
  assert.equal(JSON.parse(String(row.vars)).content, HINT, '槽位默认值也回来了');

  // 幂等：再跑一次不再命中
  assert.deepEqual(healRenderedBuiltinBodies(db, Date.now()), []);
});

test('用户改过的内置正文一律不动（T06：内置不被代码覆盖用户编辑）', () => {
  const db = openStore();
  db.run('UPDATE templates SET body = :b WHERE id = :id', { id: BUILTIN_ID, b: '# 我自己的骨架\n\n随便写' });
  const healed = healRenderedBuiltinBodies(db, Date.now());
  assert.deepEqual(healed, [], '不是出厂渲染形态就不该命中');
  assert.equal(bodyOf(db), '# 我自己的骨架\n\n随便写');

  // seed 整个跑一遍也不覆盖（INSERT OR IGNORE + 自愈判据不命中）
  seedBuiltinTemplates(db, Date.now());
  assert.equal(bodyOf(db), '# 我自己的骨架\n\n随便写');
});
