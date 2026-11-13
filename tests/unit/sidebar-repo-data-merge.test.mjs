import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardsOf, devReposOnly, nextRepoData, reposOf } from '../../src/web/frontend/repo-data.js';
import { buildTree } from '../../src/web/frontend/components/sidebar/model.js';

// #194「创建完项目组后 侧边栏树会消失变空白」：侧栏树由仓库 + 看板两份清单共同构成，
// 而它是**一次原子更新**（原实现 Promise.all + 一次 setState）——
// 任一份失败（某仓库读盘出错让 /api/repos 500、慢盘扫 31 个仓库 git 超时）两半一起丢，
// repoData 退回 {repos:[],boards:[]}，树整块空白；此后新建项目组成功也刷不出来。
// 这几条钉死新契约：两份清单各自成败、各自生效，形状认不出就保留旧值（绝不清空）。

const REPOS = [
  { id: 'r1', key: 'github.com/me/a', name: 'a' },
  { id: 'r2', key: 'github.com/me/ref', name: 'ref', type: 'ref' },
  { id: 'r3', key: 'github.com/me/b', name: 'b' },
];
const BOARDS = [
  { id: 'b1', key: 'group/nx', name: 'nx', repos: [] },
];

// ── 载荷归一 ───────────────────────────────────────────────

test('reposOf：裸数组（/api/repos 的真实载荷）', () => {
  assert.deepEqual(reposOf(REPOS), REPOS);
});

test('reposOf：认不出的形状返回 null（= 调用方保留旧值）', () => {
  assert.equal(reposOf(null), null);
  assert.equal(reposOf({ ok: true, data: [] }), null);
  assert.equal(reposOf('oops'), null);
});

test('boardsOf：{boards, unassigned} 包络与裸数组都认', () => {
  assert.deepEqual(boardsOf({ boards: BOARDS, unassigned: [] }), BOARDS);
  assert.deepEqual(boardsOf(BOARDS), BOARDS);
});

test('boardsOf：包络里没有 boards / 不是数组 → null', () => {
  assert.equal(boardsOf({ unassigned: [] }), null);
  assert.equal(boardsOf({ boards: { a: 1 } }), null);
  assert.equal(boardsOf(undefined), null);
});

test('devReposOnly：参考仓库不进侧栏', () => {
  assert.deepEqual(devReposOnly(REPOS).map((r) => r.key), ['github.com/me/a', 'github.com/me/b']);
});

// ── 合并语义：一半失败不清空 ─────────────────────────────────

test('nextRepoData：两侧都成功 → 都换新值（参考仓库被滤掉）', () => {
  const prev = { repos: [], boards: [] };
  const next = nextRepoData(prev, { repos: REPOS, boards: { boards: BOARDS } });
  assert.deepEqual(next.repos.map((r) => r.key), ['github.com/me/a', 'github.com/me/b']);
  assert.deepEqual(next.boards, BOARDS);
});

test('nextRepoData：repos 失败（undefined）→ 仓库保留旧值，看板照常更新', () => {
  const prev = { repos: [{ id: 'r0', key: 'k0', name: 'old' }], boards: [] };
  const next = nextRepoData(prev, { boards: { boards: BOARDS } });
  assert.deepEqual(next.repos, prev.repos);
  assert.deepEqual(next.boards, BOARDS);
});

test('nextRepoData：boards 失败 → 看板保留旧值，仓库照常更新', () => {
  const prev = { repos: [], boards: BOARDS };
  const next = nextRepoData(prev, { repos: REPOS });
  assert.deepEqual(next.boards, BOARDS);
  assert.equal(next.repos.length, 2);
});

test('nextRepoData：两侧都失败 → 完全保持旧值（绝不退回空清单）', () => {
  const prev = { repos: REPOS, boards: BOARDS };
  assert.deepEqual(nextRepoData(prev, {}), { repos: prev.repos, boards: prev.boards });
  // 认不出的形状同样按失败处理
  assert.deepEqual(nextRepoData(prev, { repos: 'boom', boards: null }), { repos: prev.repos, boards: prev.boards });
});

test('nextRepoData：新建看板后（只有 boards 变）新组立刻进侧栏树', () => {
  const prev = { repos: REPOS, boards: BOARDS };
  const created = { id: 'b9', key: 'group/new', name: 'new', repos: [] };
  const next = nextRepoData(prev, { boards: { boards: [...BOARDS, created] } });
  const tree = buildTree(next.repos, next.boards, [], {}, '');
  assert.ok(tree.rows.some((r) => r.type === 'board' && r.name === 'new'));
});

// ── buildTree 不再因为载荷形状抛错（抛错 = 侧栏整块白屏）──

test('buildTree：null / undefined 入参不抛错', () => {
  for (const [repos, boards, topics] of [
    [null, null, null],
    [undefined, undefined, undefined],
    [{}, {}, {}],
    ['oops', 42, false],
  ]) {
    const out = buildTree(repos, boards, topics, {}, '');
    assert.deepEqual(out.rows, []);
    assert.equal(out.matchCount, 0);
  }
});

test('buildTree：误传 /api/boards 的整包（{boards, unassigned}）不抛错、只是少组行', () => {
  const out = buildTree(REPOS, { boards: BOARDS, unassigned: [] }, [], {}, '');
  assert.ok(out.rows.some((r) => r.type === 'repo'), '仓库行仍在');
  assert.ok(!out.rows.some((r) => r.type === 'board'), '包络不是数组 → 组行缺席');
});

// ── 组件侧：刷新走 allSettled（结构钉）──────────────────────

test('App 的 refreshRepos 用 allSettled：任一半失败也要把另一半落地', () => {
  const src = readFileSync(new URL('../../src/web/frontend/App.tsx', import.meta.url), 'utf8');
  assert.match(src, /Promise\.allSettled\(\[/, '必须 allSettled（原先的 Promise.all 会整体丢弃）');
  assert.match(src, /nextRepoData\(prev,/, '合并必须走 nextRepoData（失败的一半保留旧值）');
});

test('侧栏树算崩时沿用上一版行模型（不整块空白）', () => {
  const src = readFileSync(new URL('../../src/web/frontend/components/sidebar/index.tsx', import.meta.url), 'utf8');
  assert.match(src, /lastTree/, '要有 lastTree 兜底');
  assert.match(src, /catch[\s\S]{0,200}return lastTree\.current/, 'catch 里必须返回上一版');
});
