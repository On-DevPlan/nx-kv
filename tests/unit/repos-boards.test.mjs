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
  // 看板成员按 **key** 存（key = 仓库身份，跨机稳定），id 只是本机行主键。
  // 断言与插位一律用 key。
  return { a: a.id, b: b.id, c: c.id, ak: a.key, bk: b.key, ck: c.key };
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
  const { a, b, c, ck } = await seed();
  const board = await boards.createBoard({ name: '板' });
  await boards.assignRepo({ id: a, board: board.id });
  await boards.assignRepo({ id: b, board: board.id });
  await boards.assignRepo({ id: c, board: board.id });
  // a 已在板内：插到 c 前面 → b, a, c，且不重复（before 按 **key** 定位）
  const r = await boards.assignRepo({ id: a, board: board.id, before: ck });
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

test('导入：按 key 匹配；同名板合并；本地未拥有的 key 保留占位', async () => {
  const { ak, bk } = await seed(); // alpha / beta（key = 仓库身份）
  const json = JSON.stringify({
    boards: [
      { name: '导入板', repos: [{ key: ak }, { key: 'github.com/nobody/nope' }] },
      { name: '导入板', repos: [{ key: bk }] }, // 同名 → 合并
    ],
  });
  const r = await boards.importBoards({ json });
  assert.equal(r.created, 1);
  assert.equal(r.merged, 1);
  // matched = 3：alpha + beta + 那条「本地未拥有」的占位 key
  // （完整复制导出方的组布局 —— 本地没有的也占位置，等 clone 补齐后转正）
  assert.equal(r.matched, 3);
  assert.equal(r.unmatched.length, 0);
  const d = await boards.listBoards();
  assert.equal(d.boards.length, 1);
  assert.deepEqual(d.boards[0].repos.map((x) => x.name), ['alpha', 'github.com/nobody/nope', 'beta']);
  // 占位成员：本地没有登记，present=false 标出来
  const ghost = d.boards[0].repos.find((x) => x.key === 'github.com/nobody/nope');
  assert.equal(ghost.present, false);
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

test('组内描述：挂在成员关系上，非成员报错，摘出成员时描述一起消失', async () => {
  const { a, b, ak } = await seed();
  const board = await boards.createBoard({ name: '常用' });
  const other = await boards.createBoard({ name: '远程打字' });
  await boards.assignRepo({ id: a, board: board.id });
  await boards.assignRepo({ id: a, board: other.id });

  // 写入：同一仓库在不同看板里的组内描述互不相干
  await boards.setBoardRepoNote({ id: a, board: board.id, note: '主力开发仓库' });
  await boards.setBoardRepoNote({ id: a, board: other.id, note: '只是参考实现' });
  let d = await boards.listBoards();
  const reposOf = (name) => d.boards.find((x) => x.name === name).repos;
  assert.equal(reposOf('常用').find((r) => r.name === 'alpha').note, '主力开发仓库');
  assert.equal(reposOf('远程打字').find((r) => r.name === 'alpha').note, '只是参考实现');

  // 仓库支持按绝对路径定位（与 repo get 同款）；返回的是 key（仓库身份）
  const byPath = await boards.setBoardRepoNote({ id: join(dir, 'alpha'), board: board.id, note: '按路径写入' });
  assert.equal(byPath.key, ak);

  // 非成员显式报错（不静默挂到没人读的地方）
  await assert.rejects(
    () => boards.setBoardRepoNote({ id: b, board: board.id, note: 'x' }),
    /不在看板/
  );

  // 清除：note 留空 = 删键
  await boards.setBoardRepoNote({ id: a, board: other.id, note: '' });
  d = await boards.listBoards();
  assert.equal(d.boards.find((x) => x.name === '远程打字').repos.find((r) => r.name === 'alpha').note, '');

  // 摘出成员：组内描述一起消失，不留孤儿
  await boards.setBoardRepoNote({ id: a, board: board.id, note: '临时' });
  await boards.assignRepo({ id: a, board: board.id, remove: true });
  d = await boards.listBoards();
  assert.ok(!d.boards.find((x) => x.name === '常用').repos.some((r) => r.name === 'alpha'));
  const raw = JSON.parse(await (await import('node:fs/promises')).readFile(process.env.NX_KV_REPOS_STORE, 'utf8'));
  const stored = raw.boards.find((x) => x.name === '常用');
  assert.ok(!stored.repoNotes || !stored.repoNotes[a], 'repoNotes 里不留已摘成员的键');
});

test('导入导出：组内描述随 repos[].note 往返', async () => {
  const { a } = await seed();
  const board = await boards.createBoard({ name: '回灌板' });
  await boards.assignRepo({ id: a, board: board.id });
  await boards.setBoardRepoNote({ id: a, board: board.id, note: '角色说明' });
  const exported = await boards.exportBoards();
  assert.equal(exported.boards[0].repos[0].note, '角色说明');

  // 清空后用导出 JSON 回灌，note 一并还原
  await boards.removeBoard(board.id);
  const back = await boards.importBoards({ json: JSON.stringify(exported) });
  assert.equal(back.created, 1);
  const d = await boards.listBoards();
  assert.equal(d.boards[0].repos.find((r) => r.name === 'alpha').note, '角色说明');
});

test('中心清单：listRepos 返回扁平列表（按名排序），每条带所属看板', async () => {
  const { a, b, c } = await seed(); // alpha / beta / gamma
  const b1 = await boards.createBoard({ name: '常用' });
  const b2 = await boards.createBoard({ name: '远程打字' });
  await boards.assignRepo({ id: a, board: b1.id });
  await boards.assignRepo({ id: b, board: b1.id });
  // alpha 再聚合进「远程打字」：一个仓库可以同时在多个看板里（**复制**不是移动）
  await boards.assignRepo({ id: a, board: b2.id });

  const list = await repos.listRepos();
  // 扁平：一份中心清单，按名字排序，每条只出现一次
  assert.deepEqual(list.map((r) => r.name), ['alpha', 'beta', 'gamma']);

  const alpha = list.find((r) => r.name === 'alpha');
  assert.deepEqual(alpha.boards.map((x) => x.name).sort(), ['常用', '远程打字'],
    '一个仓库可以同时属于多个看板（加入 = 复制一份归属）');

  const gamma = list.find((r) => r.name === 'gamma');
  assert.deepEqual(gamma.boards, [], '没归组也照样在中心清单里');
  assert.ok(gamma.path, '中心清单里每条都带路径');
  assert.ok(c, 'gamma 存在');
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
