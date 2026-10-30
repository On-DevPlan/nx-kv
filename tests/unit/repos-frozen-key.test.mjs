// 「身份 vs 冻结」的单元测试。
//
// 用户的口径（2026-10-31）：key 只能来自**远程地址**或**人显式自定义**；
// 两者都没有的仓库**冻结**——本机照常能用，但导出导入不包含它（没有 key，映射无意义），
// 也不该拿 local/<名称> 之类的兜底值冒充身份。
//
// 这组断言钉住三件事：
//   1. 身份的两个来源与「冻结」的判定边界；
//   2. 冻结的仓库不参与导出、也不能进项目组（那是跨机资产）；
//   3. 自定义 key 的读写往返（面板「编辑 key」走的就是这两条）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as service from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as transfer from '../../src/modules/repos/transfer.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-frozen-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_CONFIG = join(dir, 'config.json');
});

// 每个用例自己建目录（不要求是 git 仓库：登记只记路径）
const makeDir = (name) => {
  const p = join(dir, name);
  mkdirSync(p, { recursive: true });
  return p;
};

test('没有远程地址、也没自定义 key → 冻结（frozen），key 只是本机锚点', async () => {
  const p = makeDir('plain');
  const r = await service.addRepo({ path: p, name: 'plain' });

  assert.equal(r.frozen, true);
  assert.equal(service.hasIdentity(r), false);
  assert.equal(service.isFrozen(r), true);
  // 内部锚点还在（本机关系要有落点），但它不是身份
  assert.equal(service.deriveKey(r), 'local/plain');

  const [row] = await service.listRepos();
  assert.equal(row.frozen, true);
});

test('有远程地址 → 有身份（frozen=false），key 由地址派生', async () => {
  const p = makeDir('with-remote');
  const r = await service.addRepo({ path: p, name: 'with-remote', remote: 'https://github.com/a/b.git' });

  assert.equal(r.frozen, false);
  assert.equal(service.hasIdentity(r), true);
  assert.equal(r.key, 'github.com/a/b');
  const [row] = await service.listRepos();
  assert.equal(row.frozen, false);
});

test('没有远程地址但自定义了 key → 有身份（这就是「无 git 地址也能有身份」的唯一正路）', async () => {
  const p = makeDir('custom-only');
  const r = await service.addRepo({ path: p, name: 'custom-only', key: '团队/nx-rh' });

  assert.equal(r.frozen, false);
  assert.equal(r.keyCustom, true);
  assert.equal(r.key, '团队/nx-rh');
  const [row] = await service.listRepos();
  assert.equal(row.frozen, false);
  assert.equal(row.keyCustom, true);
});

test('编辑清空自定义 key（key: ""）且无远程地址 → 回到冻结', async () => {
  const p = makeDir('clear-key');
  const r = await service.addRepo({ path: p, name: 'clear-key', key: 'abc/def' });
  assert.equal(r.frozen, false);

  const updated = await service.updateRepo(r.id, { key: '' });
  assert.equal(updated.keyCustom, false);
  assert.equal(updated.frozen, true);
  assert.equal(updated.key, 'local/clear-key');
});

test('编辑把空 key 换成自定义 key → 解冻', async () => {
  const p = makeDir('thaw');
  const r = await service.addRepo({ path: p, name: 'thaw' });
  assert.equal(r.frozen, true);

  const updated = await service.updateRepo(r.id, { key: 'github.com/x/y' });
  assert.equal(updated.frozen, false);
  assert.equal(updated.keyCustom, true);
  assert.equal(updated.key, 'github.com/x/y');
});

test('冻结仓库不参与 key 唯一性检查：同名目录（两份副本）能各自登记', async () => {
  const a = join(makeDir('copy-a'), 'nx-kv');
  const b = join(makeDir('copy-b'), 'nx-kv');
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });

  await service.addRepo({ path: a, name: 'nx-kv' });
  await service.addRepo({ path: b, name: 'nx-kv' }); // 不该抛 conflict
  const rows = await service.listRepos();
  assert.equal(rows.filter((r) => r.name === 'nx-kv').length, 2);
  assert.ok(rows.every((r) => r.frozen));
});

test('有身份的仓库仍然要求 key 唯一', async () => {
  const a = makeDir('u-a');
  const b = makeDir('u-b');
  await service.addRepo({ path: a, name: 'u-a', key: 'same/key' });
  await assert.rejects(
    () => service.addRepo({ path: b, name: 'u-b', key: 'same/key' }),
    /该 key 已登记/
  );
});

test('冻结仓库仍能进项目组（本机编排不该被卡住），但导出时被剔除并告警', async () => {
  const p = makeDir('frozen-member');
  const r = await service.addRepo({ path: p, name: 'frozen-member' });
  const b = await boards.createBoard({ name: '前端' });

  // 进组：允许（本机用）
  const out = await boards.assignRepo({ id: r.id, board: b.id });
  assert.equal(out.added, true);

  // 导出：仓库本体与成员引用都被剔除，两处都要有告警
  const layout = await transfer.repoExport({ boardKeys: ['board/前端'] });
  assert.equal(layout.boards[0].repos.length, 0);
  assert.equal(layout.repos.length, 0);
  assert.ok(layout.warnings.some((w) => /frozen-member/.test(w) && /没有 key/.test(w)));
  assert.ok(layout.warnings.some((w) => /成员「frozen-member」.*剔除|剔除/.test(w)));

  // 补上身份之后：仓库与成员都在
  await service.updateRepo(r.id, { key: 'github.com/a/frozen-member' });
  const after = await transfer.repoExport({ boardKeys: ['board/前端'] });
  assert.deepEqual(after.repos.map((x) => x.key), ['github.com/a/frozen-member']);
  assert.deepEqual(after.boards[0].repos.map((x) => x.key), ['github.com/a/frozen-member']);
});

test('改 key = 换身份，但关系跟着搬（项目组成员 + 组内描述）', async () => {
  const p = makeDir('rename-key');
  const r = await service.addRepo({ path: p, name: 'rename-key', remote: 'https://github.com/a/old.git' });
  const b = await boards.createBoard({ name: '前端' });
  await boards.assignRepo({ id: r.id, board: b.id });
  await boards.setBoardRepoNote({ id: r.id, board: b.id, note: '契约方' });
  assert.deepEqual((await boards.getBoard(b.id)).repos.map((x) => x.key), ['github.com/a/old']);

  await service.updateRepo(r.id, { key: 'github.com/a/new' });

  const after = await boards.getBoard(b.id);
  assert.deepEqual(after.repos.map((x) => x.key), ['github.com/a/new']);
  assert.deepEqual(after.repos.map((x) => x.note), ['契约方']);
});

test('导出跳过冻结仓库，并如实说明原因；有身份的照常导出', async () => {
  const frozen = makeDir('exp-frozen');
  const ok = makeDir('exp-ok');
  await service.addRepo({ path: frozen, name: 'exp-frozen' });
  await service.addRepo({ path: ok, name: 'exp-ok', remote: 'https://github.com/a/ok.git' });

  const layout = await transfer.repoExport({ includeUnassigned: true });
  assert.deepEqual(layout.repos.map((r) => r.name), ['exp-ok']);
  assert.ok(layout.warnings.some((w) => /exp-frozen/.test(w) && /没有 key/.test(w)));
});

test('冻结仓库不进导出的 key 集合，别人的布局不会把它当成目标', async () => {
  const p = makeDir('not-target');
  await service.addRepo({ path: p, name: 'not-target' });

  const layout = await transfer.repoExport({ includeUnassigned: true });
  assert.equal(layout.repos.length, 0);
  assert.ok(!JSON.stringify(layout).includes('local/not-target'));
});

test.after?.(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});
