// #143：仓库管理页「组 = 分支」的口径——分支清单怎么排、每一支里装什么。
//
// 这层是页面里唯一值得单测的部分：它把「扁平仓库清单 + 组」翻译成三份名单，
// 一旦口径跑偏（比如 default 里混进参考仓库、组分支按组名而不是成员算），
// 用户看到的是「这个分支里少了仓库」——这种错很难在浏览器里一眼看出来。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  branchOptions,
  branchRefRows,
  branchRepoRows,
} from '../../src/web/frontend/page/repos/use-repos-derive.js';
import { BRANCH_DEFAULT, BRANCH_MAIN } from '../../src/web/frontend/page/repos/branch-picker.js';

/** 造一个开发仓库行（只放这条用例读得到的字段）。 */
function dev(key, name, extra = {}) {
  return { id: 'r_' + key, key, name, type: 'dev', ...extra };
}
/** 造一个参考仓库行。 */
function ref(key, name, remote = '') {
  return { id: 'r_' + key, key, name, type: 'ref', remote };
}

const A = dev('github.com/me/a', 'a', { path: 'D:/w/a' });
const B = dev('github.com/me/b', 'b', { path: 'D:/w/b' });
const C = dev('github.com/me/c', 'c', {
  path: 'D:/w/c',
  descDocs: { main: { title: '画布交互笔记', summary: '拖拽与缩放' } },
});
const ALL_DEV = [A, B, C];
const UNGROUPED = [C]; // 只有 c 没进任何组

const G1 = {
  id: 'b_1',
  key: 'board/g1',
  name: 'g1',
  repos: [
    { key: 'github.com/me/a', present: true },
    { key: 'github.com/me/b', present: true },
    { key: 'github.com/me/ghost', present: false }, // 待初始化占位
  ],
  refs: [{ id: 'github.com/lib/x' }, { id: 'github.com/lib/y' }],
  docCount: 7,
};

const G2 = { id: 'b_2', key: 'board/g2', name: 'g2', repos: [{ key: 'github.com/me/a', present: true }], refs: [] };
const BOARDS = [G1, G2];

const X = ref('github.com/lib/x', 'x', 'https://github.com/lib/x');
const Y = ref('github.com/lib/y', 'y', 'https://github.com/lib/y');
const Z = ref('github.com/lib/z', 'z');
const ALL_REF = [X, Y, Z];

test('分支清单：main 在最前、各组居中、default 恒在最后', () => {
  const out = branchOptions(BOARDS, { dev: 3, ref: 3, ungrouped: 1, docs: 93 });
  assert.deepEqual(out.map((b) => b.name), ['main', 'g1', 'g2', 'default']);
  assert.equal(out[0].id, BRANCH_MAIN);
  assert.equal(out[out.length - 1].id, BRANCH_DEFAULT);
  assert.equal(out[0].repoCount, 3, 'main 报全部开发仓库');
  assert.equal(out[0].docCount, 93);
  assert.equal(out[3].repoCount, 1, 'default 报未归组数');
  assert.equal(out[3].refCount, 0, 'default 不带参考仓库');
});

test('分支计数只算 present 的成员（占位不进数）', () => {
  const out = branchOptions(BOARDS, { dev: 3, ref: 3, ungrouped: 1, docs: null });
  const g1 = out.find((b) => b.name === 'g1');
  assert.ok(g1);
  assert.equal(g1.repoCount, 2, 'ghost 是 present=false 的占位，不该算');
  assert.equal(g1.refCount, 2);
  assert.equal(g1.docCount, 7);
  assert.equal(out[0].docCount, 0, 'docs 未知时按 0（不显示假数）');
});

test('main = 全部开发仓库', () => {
  const rows = branchRepoRows(ALL_DEV, UNGROUPED, null, BRANCH_MAIN, '');
  assert.deepEqual(rows.map((r) => r.name), ['a', 'b', 'c']);
});

test('组分支 = 该组成员（按 key 认，不按名字/路径）', () => {
  const rows = branchRepoRows(ALL_DEV, UNGROUPED, G1, 'b_1', '');
  assert.deepEqual(rows.map((r) => r.name), ['a', 'b']);
  // 占位没登记 → 不出现在表里（由「待初始化」区块处理）
  assert.equal(rows.some((r) => String(r.key).includes('ghost')), false);
});

test('default = 未归组的开发仓库', () => {
  const rows = branchRepoRows(ALL_DEV, UNGROUPED, null, BRANCH_DEFAULT, '');
  assert.deepEqual(rows.map((r) => r.name), ['c']);
});

test('关键词同时命中「仓库字段」与「它自己的文档标题」', () => {
  // 关键词用 'me/c' 这种带分隔的片段：单单一个 'b' 会命中 key 里的 "git-hub"
  const byName = branchRepoRows(ALL_DEV, UNGROUPED, null, BRANCH_MAIN, 'me/c');
  assert.deepEqual(byName.map((r) => r.name), ['c']);
  const byDoc = branchRepoRows(ALL_DEV, UNGROUPED, null, BRANCH_MAIN, '画布');
  assert.deepEqual(byDoc.map((r) => r.name), ['c'], '文档标题命中也算命中');
  const byPath = branchRepoRows(ALL_DEV, UNGROUPED, null, BRANCH_MAIN, 'd:/w/a');
  assert.deepEqual(byPath.map((r) => r.name), ['a'], '路径命中（大小写不敏感）');
});

test('参考仓库：main = 全部、组 = 这一支绑的、default = 空', () => {
  assert.deepEqual(branchRefRows(ALL_REF, null, BRANCH_MAIN, '').map((r) => r.name), ['x', 'y', 'z']);
  assert.deepEqual(branchRefRows(ALL_REF, G1, 'b_1', '').map((r) => r.name), ['x', 'y']);
  assert.deepEqual(branchRefRows(ALL_REF, G2, 'b_2', '').map((r) => r.name), []);
  assert.deepEqual(branchRefRows(ALL_REF, null, BRANCH_DEFAULT, '').map((r) => r.name), []);
});

test('参考仓库的关键词覆盖名称与远程地址', () => {
  assert.deepEqual(branchRefRows(ALL_REF, null, BRANCH_MAIN, 'lib/y').map((r) => r.name), ['y']);
  assert.deepEqual(branchRefRows(ALL_REF, null, BRANCH_MAIN, 'github.com/lib/x').map((r) => r.name), ['x']);
  assert.deepEqual(branchRefRows(ALL_REF, G1, 'b_1', 'z'), []);
});
