// 前缀分组规则的单元测试（modules/repos/boards.js）：
// 规则命中 → 自动算作看板成员；看板不存在就自动建；删规则清掉规则建的空看板。
// 存储走 NX_KV_REPOS_STORE 指到的临时文件（不碰用户目录）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-prefix-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
});

test.after?.(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

async function seed() {
  await repos.addRepo({ path: join(dir, 'nx-kv'), name: 'nx-kv' });
  await repos.addRepo({ path: join(dir, 'nx-rh'), name: 'nx-rh' });
  await repos.addRepo({ path: join(dir, 'fr'), name: 'fr' });
}

test('前缀规则：命中仓库自动成为看板成员（看板不存在则自动建）', async () => {
  await seed();
  const r = await boards.addPrefixRule({ prefix: 'nx' });
  assert.equal(r.boardCreated, true);
  assert.equal(r.boardName, 'nx');
  assert.equal(r.matched, 2, 'nx-kv / nx-rh 应命中');

  const list = await boards.listBoards();
  const nx = list.boards.find((b) => b.name === 'nx');
  assert.ok(nx, '应自动建出「nx」看板');
  assert.equal(nx.repos.length, 2);
  assert.ok(nx.repos.every((x) => x.auto), '规则命中的成员应标 auto');
  assert.deepEqual(nx.repos.map((x) => x.name).sort(), ['nx-kv', 'nx-rh']);

  // 未分组：fr 还在，nx-* 已归组
  assert.deepEqual(list.unassigned.map((x) => x.name), ['fr']);

  // 仓库清单里的 boards 字段也带上（仓库页筛选靠它）
  const rs = await repos.listRepos();
  const kv = rs.find((r) => r.name === 'nx-kv');
  assert.equal(kv.boards.length, 1);
  assert.equal(kv.boards[0].name, 'nx');
  assert.equal(kv.boards[0].auto, true);
});

test('前缀规则：可指向已有看板（不自动新建）', async () => {
  await seed();
  const b = await boards.createBoard({ name: '我的组' });
  const r = await boards.addPrefixRule({ prefix: 'nx', board: '我的组' });
  assert.equal(r.boardCreated, false);
  assert.equal(r.boardName, '我的组');
  assert.equal(r.boardId, b.id);

  const list = await boards.listBoards();
  const g = list.boards.find((x) => x.id === b.id);
  assert.equal(g.repos.length, 2);
});

test('前缀规则：删除规则 → 规则建的空看板一并清掉', async () => {
  await seed();
  await boards.addPrefixRule({ prefix: 'nx' });
  const before = await boards.listBoards();
  assert.ok(before.boards.find((b) => b.name === 'nx'));

  const rm = await boards.removePrefixRule({ prefix: 'nx' });
  assert.equal(rm.removed, 1);
  assert.equal(rm.boardRemoved, 'nx', '规则建的空看板应一并清掉');

  const after = await boards.listBoards();
  assert.ok(!after.boards.find((b) => b.name === 'nx'), '看板应已删除');
  assert.equal(after.unassigned.length, 3, '仓库应回到未分组');
});

test('前缀规则：看板里有手动成员时，删规则不动看板', async () => {
  await seed();
  await boards.addPrefixRule({ prefix: 'nx' });
  const nx = (await boards.listBoards()).boards.find((b) => b.name === 'nx');
  // 手动把 fr 挂进 nx 看板（显式成员）
  await boards.assignRepo({ key: 'local/fr', board: nx.id });

  const rm = await boards.removePrefixRule({ prefix: 'nx' });
  assert.equal(rm.boardRemoved, '', '有手动成员的看板不该被清掉');

  const after = await boards.listBoards();
  const kept = after.boards.find((b) => b.name === 'nx');
  assert.ok(kept, '看板应保留');
  assert.equal(kept.repos.length, 1, '只剩手动成员');
  assert.equal(kept.repos[0].auto, false, '手动成员不是规则来的');
  assert.equal(kept.repos[0].name, 'fr');
});

test('前缀规则：同前缀再添加 = 覆盖；删不存在的规则报错', async () => {
  await seed();
  await boards.addPrefixRule({ prefix: 'nx' });
  await boards.addPrefixRule({ prefix: 'NX', board: '别处' });
  const rules = await boards.listPrefixRules();
  assert.equal(rules.groups.length, 1, '同前缀应覆盖而不是叠加');
  assert.equal(rules.groups[0].boardName, '别处');

  await assert.rejects(() => boards.removePrefixRule({ prefix: '没有这个' }), /没有前缀/);
  await assert.rejects(() => boards.addPrefixRule({ prefix: '  ' }), /前缀/);
});
