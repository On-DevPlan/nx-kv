import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crumbsOf, crumbTrailOf, parentRouteOf, crumbCtxOf } from '../../src/web/frontend/components/layout/crumbs.js';

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

// ─── #86：组任务详情路由 #/group/<boardId>?task=N ───

test('crumbsOf group+task：[ 组名 / #N ]（挂组页之下）', () => {
  assert.deepEqual(
    crumbsOf({ view: 'group', key: 'b_1', task: '86' }, { boardName: 'nx', pageTitle: '#86' }),
    ['nx', '#86']
  );
  // ctx 未就绪时页名兜底 #<task>
  assert.deepEqual(crumbsOf({ view: 'group', key: 'b_1', task: '86' }, { boardName: 'nx' }), ['nx', '#86']);
  // 草稿统一显示 draft
  assert.deepEqual(crumbsOf({ view: 'group', key: 'b_1', task: 'draft-3' }, { boardName: 'nx' }), ['nx', 'draft']);
});

test('parentRouteOf：组任务页回组页（不是总览）', () => {
  assert.equal(parentRouteOf({ view: 'group', key: 'b_1', task: '86' }), '#/group/b_1');
  assert.equal(parentRouteOf({ view: 'group', key: 'b_1' }), '#/overview');
});

test('crumbCtxOf group+task：成员队列里搜任务（组路由 key 不是队列 key）', () => {
  const rows = [
    { key: 'k_a', name: 'nx-kv', tasks: [{ id: 86, boardMark: 'b_1' }] },
    { key: 'k_b', name: 'other', tasks: [{ id: 86, boardMark: 'b_x' }] },
  ];
  const repoData = { boards: [{ id: 'b_1', name: 'nx', repos: [{ key: 'k_a' }, { key: 'k_b' }] }] };
  const ctx = crumbCtxOf({ view: 'group', key: 'b_1', task: '86' }, rows, repoData);
  assert.equal(ctx.boardName, 'nx');
  // 撞号：优先 boardMark 指向本组的候选
  assert.equal(ctx.dirName, 'nx-kv');
  assert.equal(ctx.pageTitle, '#86');
  // 组路由无任务段时行为不变
  const plain = crumbCtxOf({ view: 'group', key: 'b_1' }, rows, repoData);
  assert.equal(plain.dirName, '');
  assert.equal(plain.pageTitle, '');
});

// ─── #190：crumbTrailOf——每段路径带自己的路由（真正的面包屑，层级点得进去）───

test('crumbTrailOf：任务页 [ 目录(可点→目录页) / #N(当前) ]', () => {
  assert.deepEqual(
    crumbTrailOf({ view: 'dir', key: 'abc', task: '28' }, { dirName: 'nx-kv', pageTitle: '#28' }),
    [
      { label: 'nx-kv', hash: '#/dir/abc' },
      { label: '#28', hash: '' },
    ]
  );
  // 草稿也归属目录页
  assert.deepEqual(
    crumbTrailOf({ view: 'dir', key: 'abc', task: 'draft-3' }, { dirName: 'nx-kv' }),
    [
      { label: 'nx-kv', hash: '#/dir/abc' },
      { label: 'draft', hash: '' },
    ]
  );
});

test('crumbTrailOf：目录页自身是当前层（单段纯文本，无可点段）', () => {
  assert.deepEqual(
    crumbTrailOf({ view: 'dir', key: 'abc' }, { dirName: 'nx-kv' }),
    [{ label: 'nx-kv', hash: '' }]
  );
});

test('crumbTrailOf：组任务页 [ 组名(可点→组页) / #N(当前) ]；组页单段当前层', () => {
  assert.deepEqual(
    crumbTrailOf({ view: 'group', key: 'b_1', task: '86' }, { boardName: 'nx', pageTitle: '#86' }),
    [
      { label: 'nx', hash: '#/group/b_1' },
      { label: '#86', hash: '' },
    ]
  );
  assert.deepEqual(
    crumbTrailOf({ view: 'group', key: 'b_1' }, { boardName: 'nx' }),
    [{ label: 'nx', hash: '' }]
  );
});

test('crumbTrailOf：doc 归属段可点（仓库→仓库管理 / 组→组页），文档是当前层', () => {
  assert.deepEqual(
    crumbTrailOf({ view: 'doc', repoKey: 'k_r' }, { repoName: 'nx-kv' }),
    [
      { label: 'nx-kv', hash: '#/repos' },
      { label: '文档', hash: '' },
    ]
  );
  assert.deepEqual(
    crumbTrailOf({ view: 'doc', boardKey: 'b_1', boardName: 'nx' }, { boardName: 'nx' }),
    [
      { label: 'nx', hash: '#/group/b_1' },
      { label: '文档', hash: '' },
    ]
  );
  // 归属未知：只剩当前层
  assert.deepEqual(crumbTrailOf({ view: 'doc' }, {}), [{ label: '文档', hash: '' }]);
});

test('crumbTrailOf：模板新建/编辑有上一级（回任务模板列表）；顶层页无可点段', () => {
  assert.deepEqual(
    crumbTrailOf({ view: 'templates', mode: 'new' }, {}),
    [
      { label: '任务模板', hash: '#/templates' },
      { label: '新建模板', hash: '' },
    ]
  );
  assert.deepEqual(crumbTrailOf({ view: 'overview' }, {}), [{ label: '全部目录总览', hash: '' }]);
  assert.deepEqual(crumbTrailOf(null, {}), []);
});
