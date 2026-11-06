import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crumbsOf, parentRouteOf, crumbCtxOf } from '../../src/web/frontend/components/layout/crumbs.js';

// #84：侧栏里仓库是平铺的独立模块（组只是指针），面包屑却还按旧容器语义
// 拼组名（[ nx/nx-kv/#81 ]）——这里钉死新语义：仓库路由不带组名。

test('crumbsOf dir：仓库/draft——ctx 里给了组名也不出现（#84）', () => {
  assert.deepEqual(
    crumbsOf({ view: 'dir', key: 'abc', task: 'draft-3' }, { boardName: 'nx', dirName: 'nx-kv' }),
    ['nx-kv', 'draft']
  );
});

test('crumbsOf dir：仓库/#任务', () => {
  assert.deepEqual(
    crumbsOf({ view: 'dir', key: 'abc', task: '28' }, { boardName: 'nx', dirName: 'nx-kv', pageTitle: '#28' }),
    ['nx-kv', '#28']
  );
});

test('crumbsOf dir：仅目录（无任务）', () => {
  assert.deepEqual(
    crumbsOf({ view: 'dir', key: 'abc' }, { boardName: 'nx', dirName: 'nx-kv' }),
    ['nx-kv']
  );
});

test('crumbsOf group：组页保留组名（组实体自己的页面）', () => {
  assert.deepEqual(crumbsOf({ view: 'group', key: 'b_1' }, { boardName: 'nx' }), ['nx']);
  assert.deepEqual(crumbsOf({ view: 'group', key: 'b_x' }, {}), ['项目组']);
  assert.deepEqual(crumbsOf({ view: 'overview' }, {}), ['全部目录总览']);
});

test('parentRouteOf：目录页兜底回总览，不回组页（#84）', () => {
  assert.equal(parentRouteOf({ view: 'dir', key: 'abc' }), '#/overview');
  assert.equal(parentRouteOf({ view: 'dir', key: 'abc', task: '28' }), '#/dir/abc');
  assert.equal(parentRouteOf({ view: 'group', key: 'b_1' }), '#/overview');
  assert.equal(parentRouteOf({ view: 'overview' }), '');
});

test('crumbCtxOf：仓库路由不再从 repo.boards 挂组名（#84 根因）', () => {
  const rows = [
    {
      key: 'abc',
      name: 'nx-kv',
      repo: { id: 'r1', boards: [{ id: 'b_1', name: 'nx' }] },
      tasks: [{ id: 28 }],
    },
  ];
  const repoData = { boards: [{ id: 'b_1', name: 'nx' }], repos: [{ id: 'r1' }] };
  // dir 路由：即使仓库登记着 boards[]、topic.repo 也在，也不出组名
  const dirCtx = crumbCtxOf({ view: 'dir', key: 'abc', task: '28' }, rows, repoData);
  assert.equal(dirCtx.boardName, '');
  assert.equal(dirCtx.dirName, 'nx-kv');
  assert.equal(dirCtx.pageTitle, '#28');
  // group 路由（key = 看板 id）：组名照常
  const groupCtx = crumbCtxOf({ view: 'group', key: 'b_1' }, rows, repoData);
  assert.equal(groupCtx.boardName, 'nx');
  assert.equal(groupCtx.dirName, '');
});
