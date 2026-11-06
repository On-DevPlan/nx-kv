import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeOfPanel, panelSpecOfRoute } from '../../src/web/frontend/route-map.js';
import { findGroupTask } from '../../src/web/frontend/modules/board/board-view.js';

// #86：组任务详情有自己的路由 #/group/<boardId>?task=N。
// 钉死「路由 ↔ 面板」恒等式：panelSpecOfRoute 生成的 config 必须与
// routeOfPanel 写回的路由逐字互逆（openPanel 按 component+config 去重，
// 任何一边多一个字段都会裂出重复页签）。

const nodeOf = (component, config) => ({
  getComponent: () => component,
  getConfig: () => config,
});

test('routeOfPanel：组锚定页 → #/group/<boardId>?task=N（#86）', () => {
  assert.equal(
    routeOfPanel(nodeOf('page', { groupId: 'b_1', task: '2' })),
    '#/group/b_1?task=2'
  );
  // groupId 需要编码
  assert.equal(
    routeOfPanel(nodeOf('page', { groupId: 'b x', task: '2' })),
    '#/group/b%20x?task=2'
  );
});

test('routeOfPanel：目录锚定页与旁路页不受组锚分支影响', () => {
  assert.equal(routeOfPanel(nodeOf('page', { dirKey: 'abc', task: '2' })), '#/dir/abc?task=2');
  assert.equal(routeOfPanel(nodeOf('page', { dirKey: 'abc', task: '2', beside: true })), null);
});

test('panelSpecOfRoute：group 路由带 ?task= → 组锚定 page（config 恰为 {groupId, task}）', () => {
  const spec = panelSpecOfRoute({ view: 'group', key: 'b_1', task: '2' }, { pageTitle: '#2' });
  assert.equal(spec.component, 'page');
  assert.deepEqual(spec.config, { groupId: 'b_1', task: '2' });
  assert.equal(spec.name, '#2');
});

test('panelSpecOfRoute：group 路由不带任务 → 组页（原样）', () => {
  const spec = panelSpecOfRoute({ view: 'group', key: 'b_1', task: '' }, { boardName: 'nx' });
  assert.equal(spec.component, 'group');
  assert.deepEqual(spec.config, { boardId: 'b_1' });
});

test('路由 ↔ 面板往返恒等：routeOfPanel(panelSpecOfRoute(g)) 复现同一条路由', () => {
  for (const task of ['2', '86', 'draft-N12']) {
    const spec = panelSpecOfRoute({ view: 'group', key: 'b_1', task }, {});
    const hash = routeOfPanel(nodeOf(spec.component, spec.config));
    // 手工按 routeFromHash 同一套规则拆回来（URLSearchParams + decodeURIComponent）
    const raw = hash.replace(/^#\//, '');
    const [path, query] = raw.split('?');
    const back = {
      view: 'group',
      key: decodeURIComponent(path.slice('group/'.length)),
      task: new URLSearchParams(query || '').get('task') || '',
    };
    assert.deepEqual(back, { view: 'group', key: 'b_1', task });
    // 再按回程路由生成 spec——config 必须与首程逐字一致（去重不裂）
    const spec2 = panelSpecOfRoute(back, {});
    assert.equal(JSON.stringify(spec2.config), JSON.stringify(spec.config));
  }
});

test('findGroupTask：成员队列寻址——boardMark 优先，撞号退首个命中', () => {
  const boards = [{ id: 'b_1', name: 'nx', repos: [{ key: 'k_a' }, { key: 'k_b' }] }];
  const rows = [
    { key: 'k_a', name: 'proj-a', tasks: [{ id: 2, boardMark: 'b_1' }] },
    // 同号任务在另一个成员队列，但 boardMark 指向别组——不应抢走
    { key: 'k_b', name: 'proj-b', tasks: [{ id: 2, boardMark: 'b_other' }] },
  ];
  const g = findGroupTask(rows, boards, 'b_1', '2');
  assert.equal(g.topic.key, 'k_a');
  assert.equal(g.taskRow.boardMark, 'b_1');
  // 首选候选缺失 boardMark（手工改归属）时，成员队列里第一个命中兜底
  const g2 = findGroupTask(
    [{ key: 'k_a', name: 'proj-a', tasks: [{ id: 3, boardMark: '' }] }],
    boards,
    'b_1',
    '3'
  );
  assert.equal(g2.topic.key, 'k_a');
});

test('findGroupTask：组身份认 id/key/name；找不到返回空位', () => {
  const boards = [
    { id: 'b_1', key: 'nx', name: 'nx组', repos: [{ key: 'k_a' }] },
  ];
  const rows = [{ key: 'k_a', name: 'proj-a', tasks: [{ id: 9, boardMark: 'nx' }] }];
  for (const key of ['b_1', 'nx', 'nx组']) {
    const g = findGroupTask(rows, boards, key, '9');
    assert.equal(g.topic && g.topic.key, 'k_a', `groupKey=${key}`);
  }
  assert.equal(findGroupTask(rows, boards, 'b_none', '9').taskRow, null);
  assert.equal(findGroupTask(rows, boards, 'b_1', '').taskRow, null);
  assert.equal(findGroupTask(rows, boards, 'b_1', null).topic, null);
});

test('findGroupTask：board 没有 repos 登记时退化为全队列扫描（仍按 boardMark 优先）', () => {
  const boards = [{ id: 'b_1', name: 'nx' }];
  const rows = [
    { key: 'k_x', name: 'outsider', tasks: [{ id: 5, boardMark: '' }] },
    { key: 'k_a', name: 'proj-a', tasks: [{ id: 5, boardMark: 'b_1' }] },
  ];
  const g = findGroupTask(rows, boards, 'b_1', '5');
  assert.equal(g.topic.key, 'k_a');
});

test('findGroupTask：生产形态——成员 key（仓库 key）≠ 队列 key（owner 哈希），桥在 r.repo.key（#86 实测坑）', () => {
  // /api/boards 的成员是仓库 key；/api/localtasks 的行 key 是 owner 哈希。
  // 直接拿成员 key 比 r.key 会把整队滤掉 → 「找不到任务 #N」（#86 探针实锤）。
  const boards = [
    {
      id: 'b_probe86',
      key: 'board/probe86',
      name: 'probe86',
      repos: [{ key: 'probe86/nx-kv', name: 'nx-kv', id: 'r_probe86' }],
    },
  ];
  const rows = [
    {
      key: 'f180aa0b12e1e0ae', // owner 哈希，不是仓库 key
      repo: { id: 'r_probe86', key: 'probe86/nx-kv', name: 'nx-kv' },
      name: 'nx-kv',
      tasks: [{ id: 1, boardMark: 'b_probe86' }],
    },
    {
      key: 'deadbeef',
      repo: { id: 'r_other', key: 'other/repo' },
      name: 'other',
      tasks: [{ id: 1, boardMark: '' }], // 同号任务在非成员队列——不得抢走
    },
  ];
  const g = findGroupTask(rows, boards, 'b_probe86', '1');
  assert.equal(g.board && g.board.id, 'b_probe86');
  assert.equal(g.topic.key, 'f180aa0b12e1e0ae');
  assert.equal(g.taskRow.boardMark, 'b_probe86');
});
