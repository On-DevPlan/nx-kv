// 侧边栏模型的单元测试：**「资产」与「收纳组」是两件事**。
//
// 这组断言钉住用户明确纠正过一次的语义（2026-10-30）：
//   - 项目（仓库）与项目组（看板）是**并列的资产**，项目组不是仓库的父目录——
//     一条仓库不会因为属于某个项目组就从顶层消失、跑到组下面去；
//   - 左侧的「收纳组」是纯显示层的格子（prefs.groups），只影响怎么摆，
//     与项目组的成员表（数据）无关。
// 这两条一旦被改回「看板当容器」，这里的断言会立刻红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, itemIdOf } from '../../src/web/frontend/components/sidebar/model.js';
import { addGroup, moveToGroup, groupOf, removeGroup, renameGroup } from '../../src/web/frontend/prefs.js';
import { applyDrop } from '../../src/web/frontend/components/sidebar/drag.js';

const repo = (name, key, extra = {}) => ({
  id: 'r_' + name, name, key, path: 'D:/x/' + name, desc: '', boards: [], ...extra,
});
const board = (name, id, repoKeys) => ({
  id, name, desc: '', key: 'board/' + name, repos: repoKeys.map((k) => ({ key: k, name: k })),
});
const basePrefs = { order: [], hidden: [], groups: [], groupOpen: {} };

test('项目组是资产：它不是仓库的父目录，成员仓库仍在顶层出现', () => {
  const repos = [repo('nx-kv', 'github.com/a/nx-kv'), repo('nx-sk', 'github.com/a/nx-sk')];
  const boards = [board('nx 家族', 'b1', ['github.com/a/nx-kv'])];
  const { rows } = buildTree(repos, boards, [], basePrefs, '');

  const types = rows.map((r) => r.type + ':' + r.name);
  // 项目组与两个项目都在顶层（没有 nested）
  assert.deepEqual(types.sort(), ['board:nx 家族', 'repo:nx-kv', 'repo:nx-sk']);
  assert.equal(rows.filter((r) => r.nested).length, 0);
  // 项目组只带成员数（成员是数据，不是侧边栏的层级）
  const b = rows.find((r) => r.type === 'board');
  assert.equal(b.count, 1);
  assert.equal(b.missing, 0);
});

test('收纳组：成员挂在盒子下面，且不会在顶层重复出现', () => {
  const repos = [repo('nx-kv', 'github.com/a/nx-kv'), repo('nx-sk', 'github.com/a/nx-sk')];
  const groups = [{ id: 'g1', name: '前端', members: ['repo:github.com/a/nx-kv'] }];
  const { rows } = buildTree(repos, [], [], { ...basePrefs, groups, groupOpen: { g1: true } }, '');

  assert.equal(rows[0].type, 'group');
  assert.equal(rows[0].name, '前端');
  assert.equal(rows[0].count, 1);
  assert.equal(rows[1].type, 'repo');
  assert.equal(rows[1].name, 'nx-kv');
  assert.equal(rows[1].nested, true);
  assert.equal(rows[1].groupId, 'g1');
  // 顶层只剩另一条项目
  const top = rows.filter((r) => !r.nested).map((r) => r.name);
  assert.deepEqual(top, ['前端', 'nx-sk']);
});

test('收纳组能同时装项目与项目组（两者都是资产）', () => {
  const repos = [repo('nx-kv', 'k1')];
  const boards = [board('nx 家族', 'b1', ['k1'])];
  const groups = [{ id: 'g1', name: '混装', members: ['board:b1', 'repo:k1'] }];
  const { rows } = buildTree(repos, boards, [], { ...basePrefs, groups, groupOpen: { g1: true } }, '');
  assert.deepEqual(rows.filter((r) => r.nested).map((r) => r.type).sort(), ['board', 'repo']);
});

test('收纳组折叠时不渲染成员；搜索时强制展开命中项', () => {
  const repos = [repo('nx-kv', 'k1')];
  const groups = [{ id: 'g1', name: '前端', members: ['repo:k1'] }];
  const folded = buildTree(repos, [], [], { ...basePrefs, groups, groupOpen: { g1: false } }, '');
  assert.equal(folded.rows.length, 1); // 只有盒子行

  const searched = buildTree(repos, [], [], { ...basePrefs, groups, groupOpen: { g1: false } }, 'nx-kv');
  assert.equal(searched.rows.length, 2); // 盒子 + 命中的成员
  assert.equal(searched.matchCount, 1);
});

test('搜索：空盒子不占位；只有名字命中的盒子保留', () => {
  const repos = [repo('nx-kv', 'k1')];
  const groups = [
    { id: 'g1', name: '空盒子', members: [] },
    { id: 'g2', name: '前端', members: [] },
  ];
  const { rows, matchCount } = buildTree(repos, [], [], { ...basePrefs, groups }, 'nx');
  assert.equal(matchCount, 1);
  // 「空盒子」不含 nx → 不显示；「前端」也不含 nx → 不显示；只剩仓库
  assert.deepEqual(rows.map((r) => r.name), ['nx-kv']);
});

test('隐藏：新结构用 itemId，老数据用裸仓库 key 也认', () => {
  const repos = [repo('a', 'k1'), repo('b', 'k2')];
  const byItem = buildTree(repos, [], [], { ...basePrefs, hidden: ['repo:k1'] }, '');
  assert.deepEqual(byItem.rows.map((r) => r.name), ['b']);
  const legacy = buildTree(repos, [], [], { ...basePrefs, hidden: ['k1'] }, '');
  assert.deepEqual(legacy.rows.map((r) => r.name), ['b']);
});

test('排序：order 里的位置生效，未编过的按 盒子 → 项目组 → 项目 → 名称', () => {
  const repos = [repo('z-repo', 'kz'), repo('a-repo', 'ka')];
  const boards = [board('m-group', 'b1', [])];
  const groups = [{ id: 'g1', name: 'g-box', members: [] }];
  const plain = buildTree(repos, boards, [], { ...basePrefs, groups }, '');
  assert.deepEqual(plain.rows.map((r) => r.name), ['g-box', 'm-group', 'a-repo', 'z-repo']);

  const ordered = buildTree(repos, boards, [], {
    ...basePrefs, groups, order: ['repo:kz', 'group:g1', 'board:b1', 'repo:ka'],
  }, '');
  assert.deepEqual(ordered.rows.map((r) => r.name), ['z-repo', 'g-box', 'm-group', 'a-repo']);
});

test('全局池恒顶，不受 order 影响', () => {
  const repos = [repo('a', 'k1')];
  const topics = [{ isGlobal: true, key: '__GLOBAL__', name: '全局任务', pending: 2, tasks: [] }];
  const { rows } = buildTree(repos, [], topics, { ...basePrefs, order: ['repo:k1'] }, '');
  assert.equal(rows[0].type, 'global');
  assert.equal(rows[1].name, 'a');
});

test('itemIdOf：项目 / 项目组两套标识，别混', () => {
  assert.equal(itemIdOf({ type: 'repo', key: 'github.com/a/b' }), 'repo:github.com/a/b');
  assert.equal(itemIdOf({ type: 'board', id: 'b_1' }), 'board:b_1');
  assert.equal(itemIdOf({ type: 'group', id: 'g_1' }), '');
});

// ─── prefs 里的收纳组操作 ───────────────────────────────────────────────

test('moveToGroup：一条资产只在一个盒子里（放进去会从别的盒子摘掉）', () => {
  let groups = [{ id: 'g1', name: 'A', members: [] }, { id: 'g2', name: 'B', members: [] }];
  groups = moveToGroup(groups, 'repo:k1', 'g1');
  assert.deepEqual(groupOf(groups, 'repo:k1'), 'g1');
  groups = moveToGroup(groups, 'repo:k1', 'g2');
  assert.deepEqual(groups.find((g) => g.id === 'g1').members, []);
  assert.deepEqual(groupOf(groups, 'repo:k1'), 'g2');
  groups = moveToGroup(groups, 'repo:k1', '');
  assert.deepEqual(groupOf(groups, 'repo:k1'), '');
});

test('addGroup / renameGroup / removeGroup：解散盒子不动资产', () => {
  let groups = [];
  const created = addGroup(groups, '前端');
  groups = created.groups;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, '前端');
  assert.ok(created.id);

  groups = moveToGroup(groups, 'board:b1', created.id);
  groups = renameGroup(groups, created.id, '前端 / 仓库');
  assert.equal(groups[0].name, '前端 / 仓库');

  groups = removeGroup(groups, created.id);
  assert.deepEqual(groups, []); // 盒子没了，资产本身在 store 里，与 groups 无关
});

// ─── 拖拽落点 ───────────────────────────────────────────────────────────

test('drop into 收纳组：写 groups + 顺序排在盒子后面', () => {
  const prefs = { order: [], groups: [{ id: 'g1', name: '前端', members: [] }] };
  const drag = { type: 'repo', key: 'k1', name: 'nx-kv' };
  const target = { type: 'group', id: 'g1', name: '前端' };
  const patch = applyDrop(prefs, drag, target, 'into', ['group:g1', 'repo:k2']);

  assert.deepEqual(patch.groups[0].members, ['repo:k1']);
  assert.deepEqual(patch.order, ['group:g1', 'repo:k1', 'repo:k2']);
  // 放进去顺手展开盒子，否则拖完看着像东西消失了
  assert.equal(patch.groupOpen.g1, true);
});

test('从盒子里拖出去：离开盒子，并按落点排序', () => {
  const prefs = { order: [], groups: [{ id: 'g1', name: '前端', members: ['repo:k1'] }] };
  const drag = { type: 'repo', key: 'k1', name: 'nx-kv', groupId: 'g1' };
  const target = { type: 'repo', key: 'k2', name: 'nx-sk' };
  const patch = applyDrop(prefs, drag, target, 'after', ['group:g1', 'repo:k1', 'repo:k2']);

  assert.deepEqual(patch.groups[0].members, []);
  assert.deepEqual(patch.order, ['group:g1', 'repo:k2', 'repo:k1']);
});

test('稀疏 order 也能落点（渲染序作基准）——旧实现在这里「拖了没反应」', () => {
  const prefs = { order: [], groups: [] };
  const drag = { type: 'board', id: 'b1', name: '组一' };
  const target = { type: 'repo', key: 'k9', name: '目标' };
  const patch = applyDrop(prefs, drag, target, 'before', ['repo:k9']);
  assert.deepEqual(patch.order, ['board:b1', 'repo:k9']);
});

test('拖到树末尾 = 追加到顺序末尾', () => {
  const prefs = { order: [], groups: [] };
  const drag = { type: 'repo', key: 'k1', name: 'a' };
  const patch = applyDrop(prefs, drag, { type: 'tail', name: '末尾' }, 'after', ['repo:k1', 'repo:k2']);
  assert.deepEqual(patch.order, ['repo:k2', 'repo:k1']);
});
