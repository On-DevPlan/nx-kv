// 看板 service（modules/repos/boards.js）的单元测试：
// 建板 / 改删 / 移卡（含 before 插位与未分组回退）/ 删除联动 / 导入导出闭环。
// 存储走 NX_KV_REPOS_STORE 指到的临时文件（storePathFromEnv 读时求值，测试内自设）。
//
// **来历**：原本是 nx-rh 的 tests/unit/boards.test.mjs，2026-10-23 随仓库模块
// 一起迁到 nx-kv（远程清单 topic=goal 的 #72）——代码搬了，测试也得跟着搬。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-boards-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
});

test.after?.(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

async function seed() {
  const a = await repos.addRepo({ path: join(dir, 'alpha'), name: 'alpha', desc: '第一个' });
  const b = await repos.addRepo({ path: join(dir, 'beta'), name: 'beta', desc: '第二个' });
  const c = await repos.addRepo({ path: join(dir, 'gamma'), name: 'gamma', desc: '第三个' });
  return { a: a.id, b: b.id, c: c.id };
}

test('建板与清单：成员按 repoIds 有序，不在板的仓库 = 未分组', async () => {
  const { a, b } = await seed();
  const board = await boards.createBoard({ name: '前端', desc: '界面项目' });
  await boards.assignRepo({ id: a, board: board.id });
  await boards.assignRepo({ id: b, board: board.id });
  const d = await boards.listBoards();
  assert.equal(d.boards.length, 1);
  assert.deepEqual(d.boards[0].repos.map((r) => r.name), ['alpha', 'beta']);
  assert.deepEqual(d.unassigned.map((r) => r.name), ['gamma']);
  // 卡片投影带 path / desc（CLI「快速判断 repo 和 desc」的数据面）
  assert.equal(d.boards[0].repos[0].desc, '第一个');
  assert.ok(d.boards[0].repos[0].path);
  assert.ok(a && b);
});

test('聚合：加入看板不动其他板——一个仓库可同时在多个主题', async () => {
  const { a, b } = await seed();
  const b1 = await boards.createBoard({ name: '常用' });
  const b2 = await boards.createBoard({ name: '远程打字' });
  await boards.assignRepo({ id: a, board: b1.id }); // alpha 在「常用」
  await boards.assignRepo({ id: b, board: b1.id });
  // alpha 再聚合进「远程打字」：常用里必须原样保留（repos 固定，看板只是聚合视图）
  await boards.assignRepo({ id: a, board: b2.id });
  const d = await boards.listBoards();
  assert.deepEqual(d.boards.find((x) => x.id === b1.id).repos.map((r) => r.name), ['alpha', 'beta']);
  assert.deepEqual(d.boards.find((x) => x.id === b2.id).repos.map((r) => r.name), ['alpha']);
});

test('插位：同板重复 assign 按 before 调位次且不产生重复', async () => {
  const { a, b, c } = await seed();
  const board = await boards.createBoard({ name: '板' });
  await boards.assignRepo({ id: a, board: board.id });
  await boards.assignRepo({ id: b, board: board.id });
  await boards.assignRepo({ id: c, board: board.id });
  // a 已在板内：插到 c 前面 → b, a, c，且不重复
  const r = await boards.assignRepo({ id: a, board: board.id, before: c });
  assert.equal(r.added, false);
  const d = await boards.getBoard(board.id);
  assert.deepEqual(d.repos.map((x) => x.name), ['beta', 'alpha', 'gamma']);
});

test('移除：带 board 只摘那一板（其他板保留）；不带 board 从所有板摘出', async () => {
  const { a, b } = await seed();
  const b1 = await boards.createBoard({ name: '常用' });
  const b2 = await boards.createBoard({ name: '远程打字' });
  await boards.assignRepo({ id: a, board: b1.id });
  await boards.assignRepo({ id: a, board: b2.id });
  await boards.assignRepo({ id: b, board: b1.id });
  // 从「常用」移出：「远程打字」保留
  const r1 = await boards.assignRepo({ id: a, board: b1.id, remove: true });
  assert.equal(r1.removed, true);
  let d = await boards.listBoards();
  assert.deepEqual(d.boards.find((x) => x.id === b1.id).repos.map((r) => r.name), ['beta']);
  assert.deepEqual(d.boards.find((x) => x.id === b2.id).repos.map((r) => r.name), ['alpha']);
  // 不带 board：所有板摘出 → 回未分组
  const r2 = await boards.assignRepo({ id: a, remove: true });
  assert.equal(r2.count, 1);
  d = await boards.listBoards();
  assert.deepEqual(d.boards.find((x) => x.id === b2.id).repos, []);
  assert.ok(d.unassigned.some((r) => r.name === 'alpha'));
});

test('改删：重命名 / 改描述 / 删板释放成员（登记不动）', async () => {
  const { a } = await seed();
  const board = await boards.createBoard({ name: '旧名' });
  await boards.assignRepo({ id: a, board: board.id });
  await boards.updateBoard(board.id, { name: '新名', desc: '新描述' });
  assert.equal((await boards.getBoard(board.id)).name, '新名');
  // 同名校验
  await boards.createBoard({ name: '另一板' });
  await assert.rejects(() => boards.updateBoard(board.id, { name: '另一板' }), /同名/);
  const r = await boards.removeBoard(board.id);
  assert.equal(r.released, 1);
  const d = await boards.listBoards();
  assert.equal(d.boards.length, 1);
  // 旧板里的 alpha 回未分组，与从未入板的 beta/gamma 并列
  assert.deepEqual(d.unassigned.map((x) => x.name), ['alpha', 'beta', 'gamma']);
});

test('删除仓库登记：看板（可能多个）里的引用同步摘除', async () => {
  const { a, b } = await seed();
  const board = await boards.createBoard({ name: '板' });
  await boards.assignRepo({ id: a, board: board.id });
  await boards.assignRepo({ id: b, board: board.id });
  await repos.removeRepo(a);
  const d = await boards.listBoards();
  assert.deepEqual(d.boards[0].repos.map((r) => r.name), ['beta']);
});

test('导入：path 大小写不敏感 + 按名匹配；同名板合并；未匹配如实报告', async () => {
  await seed(); // alpha @ <dir>/alpha（导入按路径大小写不敏感匹配它）
  const json = JSON.stringify({
    boards: [
      { name: '导入板', repos: [{ path: join(dir).replace(/\\/g, '/') + '/ALPHA' }, { name: '不存在的东西' }] },
      { name: '导入板', repos: [{ name: 'beta' }] }, // 同名 → 合并
    ],
  });
  const r = await boards.importBoards({ json });
  assert.equal(r.created, 1);
  assert.equal(r.merged, 1);
  assert.equal(r.matched, 2);
  assert.equal(r.unmatched.length, 1);
  const d = await boards.listBoards();
  assert.equal(d.boards.length, 1);
  assert.deepEqual(d.boards[0].repos.map((x) => x.name), ['alpha', 'beta']);
});

test('导入：坏 JSON / 空 boards 报入参错误', async () => {
  await assert.rejects(() => boards.importBoards({ json: '{oops' }), /解析失败/);
  await assert.rejects(() => boards.importBoards({ json: '{"boards":[]}' }), /boards/);
});

test('导出可回灌：导出 → 清空看板 → 导入还原成员', async () => {
  const { a, b, c } = await seed();
  const board = await boards.createBoard({ name: '回灌板', desc: 'round-trip' });
  await boards.assignRepo({ id: a, board: board.id });
  await boards.assignRepo({ id: b, board: board.id });
  const exported = await boards.exportBoards();
  await boards.removeBoard(board.id);
  assert.equal((await boards.listBoards()).unassigned.length, 3);
  const back = await boards.importBoards({ json: JSON.stringify(exported) });
  assert.equal(back.created, 1);
  assert.equal(back.matched, 2);
  const d = await boards.listBoards();
  assert.deepEqual(d.boards[0].repos.map((x) => x.name), ['alpha', 'beta']);
  assert.deepEqual(d.unassigned.map((x) => x.name), ['gamma']);
  assert.ok(c); // gamma 保持未分组
});

test('仓库上下文：按路径查到仓库与它所在的看板（本地任务的上下文来源）', async () => {
  const { a, b } = await seed();
  const board = await boards.createBoard({ name: '常用', desc: '常用参考' });
  await boards.assignRepo({ id: a, board: board.id });
  await boards.assignRepo({ id: b, board: board.id });

  const map = await repos.contextMap();
  const ctx = map.get(repos.normalizePathKey(join(dir, 'alpha')));
  assert.ok(ctx, '按路径能查到仓库');
  assert.equal(ctx.name, 'alpha');
  assert.equal(ctx.boards.length, 1);
  assert.equal(ctx.boards[0].name, '常用');

  // 直接按路径取（localtask 用的是这个入口）
  const one = await repos.contextForPath(join(dir, 'alpha'));
  assert.equal(one.name, 'alpha');
  assert.equal(one.boards[0].name, '常用');
  // 没登记过的目录 → null（不是报错）
  assert.equal(await repos.contextForPath(join(dir, 'never-registered')), null);
});
