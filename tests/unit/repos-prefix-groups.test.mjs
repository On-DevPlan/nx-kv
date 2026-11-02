// 按前缀归组（一次性命令）的单元测试（modules/repos/boards.js）：
// board prefix <prefix> 跑一次 → 命中仓库固化成看板的显式成员（repoKeys），
// 看板不存在就自动建；重复跑幂等（已在内的不重复、不调位次）。
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

test('按前缀归组：命中仓库固化成显式成员（看板不存在则自动建）', async () => {
  await seed();
  const r = await boards.applyPrefixGroup({ prefix: 'nx' });
  assert.equal(r.boardCreated, true);
  assert.equal(r.boardName, 'nx');
  assert.equal(r.added, 2, 'nx-kv / nx-rh 应命中');
  assert.equal(r.total, 2);

  const list = await boards.listBoards();
  const nx = list.boards.find((b) => b.name === 'nx');
  assert.ok(nx, '应自动建出「nx」看板');
  assert.equal(nx.repos.length, 2);
  assert.ok(nx.repos.every((x) => !('auto' in x)), '成员投影不再带 auto 字段（成员只有显式一种）');
  assert.deepEqual(nx.repos.map((x) => x.name).sort(), ['nx-kv', 'nx-rh']);

  // 成员是真的显式成员（repoKeys 固化），不是动态规则算出来的
  const store = JSON.parse(await import('node:fs').then((m) => m.readFileSync(repos.storePath(), 'utf8')));
  const nxRaw = store.boards.find((b) => b.name === 'nx');
  assert.equal(nxRaw.repoKeys.length, 2, 'repoKeys 应固化两个成员');
  assert.ok(!('prefixGroups' in store), '旧规则字段不再读写');

  // 未分组：fr 还在，nx-* 已归组
  assert.deepEqual(list.unassigned.map((x) => x.name), ['fr']);

  // 仓库清单里的 boards 字段也带上（仓库页筛选靠它）
  const rs = await repos.listRepos();
  const kv = rs.find((r) => r.name === 'nx-kv');
  assert.equal(kv.boards.length, 1);
  assert.equal(kv.boards[0].name, 'nx');
});

test('按前缀归组：可指向已有看板（不自动新建）', async () => {
  await seed();
  const b = await boards.createBoard({ name: '我的组' });
  const r = await boards.applyPrefixGroup({ prefix: 'nx', board: '我的组' });
  assert.equal(r.boardCreated, false);
  assert.equal(r.boardName, '我的组');
  assert.equal(r.boardId, b.id);

  const list = await boards.listBoards();
  const g = list.boards.find((x) => x.id === b.id);
  assert.equal(g.repos.length, 2);
});

test('按前缀归组：重复跑幂等；手动成员保位次、命中追加在后', async () => {
  await seed();
  const first = await boards.applyPrefixGroup({ prefix: 'nx' });
  assert.equal(first.added, 2);

  // 再跑一次：没有新命中，也不产生重复
  const again = await boards.applyPrefixGroup({ prefix: 'nx' });
  assert.equal(again.added, 0);
  assert.equal(again.total, 2);

  // 手动把 fr 挂进 nx（追加在末尾），再跑命令也不动已有位次
  const nx = (await boards.listBoards()).boards.find((b) => b.name === 'nx');
  await boards.assignRepo({ key: 'local/fr', board: nx.id });
  const third = await boards.applyPrefixGroup({ prefix: 'nx' });
  assert.equal(third.added, 0);
  assert.equal(third.total, 3);
  const kept = (await boards.listBoards()).boards.find((b) => b.name === 'nx');
  assert.equal(kept.repos.length, 3);
  assert.deepEqual(kept.repos.map((x) => x.name), ['nx-kv', 'nx-rh', 'fr']);
});

test('按前缀归组：大小写不敏感；缺前缀报错', async () => {
  await seed();
  const r = await boards.applyPrefixGroup({ prefix: 'NX' });
  assert.equal(r.added, 2, '大小写不敏感匹配');

  await assert.rejects(() => boards.applyPrefixGroup({}), /前缀/);
  await assert.rejects(() => boards.applyPrefixGroup({ prefix: '  ' }), /前缀/);
});
