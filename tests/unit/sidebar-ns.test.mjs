// 侧栏 namespace（#167/#169/#174/#177/#178/#179）的纯函数验证。
// #179 语义定稿：namespace = **命名空间切换器**——默认聚焦第一个命名空间，
// 侧栏只列该空间的成员（无分区头行）；「全部分区」仅作概览（拖动/管理场所）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTree, rKey, UNGROUPED_KEY, ACTIVE_KEY, ALL_KEY,
} from '../../src/web/frontend/components/sidebar/model.js';

const repos = [
  { id: 'r1', key: 'github.com/a/one', name: 'one', path: 'D:/w/one', type: 'repo' },
  { id: 'r2', key: 'github.com/a/two', name: 'two', path: 'D:/w/two', type: 'repo' },
  { id: 'r3', key: 'github.com/a/three', name: 'three', path: 'D:/w/three', type: 'repo' },
];
const boards = [{ id: 'b1', key: 'board/组一', name: '组一', repos: [{ key: 'github.com/a/one' }] }];
const topics = [];

const NS_DATA = { id: 'ns_data', name: '数据', items: ['github.com/a/one'] };
const NS_MISC = { id: 'ns_misc', name: '杂项', items: ['github.com/a/two', 'board:b1'] };

const names = (t) => t.rows.map((r) => r.name);

test('无 namespaces → 现状平铺（无分区头）', () => {
  const t = buildTree(repos, boards, topics, {}, '');
  assert.ok(!t.rows.some((r) => r.type === 'ns'));
  assert.equal(t.rows[0]?.type, 'board');
});

test('#179 默认聚焦第一个命名空间：只列它的成员、不出现分区头', () => {
  const t = buildTree(repos, boards, topics, { namespaces: [NS_DATA, NS_MISC] }, '');
  assert.ok(!t.rows.some((r) => r.type === 'ns'), '切换视图不输出分区头');
  assert.deepEqual(t.rows.filter((r) => r.type === 'repo').map((r) => r.key), ['github.com/a/one']);
  assert.ok(!names(t).includes('two'), '别的命名空间的成员不出现');
});

test('#179 切换命名空间：focusNs 指到第二个 → 只显示第二个', () => {
  const t = buildTree(repos, boards, topics, { namespaces: [NS_DATA, NS_MISC], focusNs: 'ns_misc' }, '');
  const keys = t.rows.map((r) => rKey(r));
  assert.ok(keys.includes('board:b1'), '分组在');
  assert.ok(keys.includes('github.com/a/two'), '仓库在');
  assert.ok(!keys.includes('github.com/a/one'), '第一个命名空间的不出现');
  assert.ok(!t.rows.some((r) => r.type === 'ns'));
});

test('#179 「全部分区」概览：分区头 + 成员（pinned 先），未分组收进可折叠区', () => {
  const prefs = {
    namespaces: [NS_MISC, { ...NS_DATA, pinned: true }],
    focusNs: ALL_KEY,
  };
  const t = buildTree(repos, boards, topics, prefs, '');
  const heads = t.rows.filter((r) => r.type === 'ns');
  assert.deepEqual(heads.map((h) => h.name), ['数据', '杂项', '未分组'], 'pinned 在前，末尾未分组');
  assert.equal(heads[2].collapsed, true, '未分组默认折叠');
  const dataIdx = t.rows.findIndex((r) => r.type === 'ns' && r.name === '数据');
  assert.equal(t.rows[dataIdx + 1]?.key, 'github.com/a/one', '成员紧跟头行');
});

test('#179 未分组视图：只列未分区条目（无头行）', () => {
  const t = buildTree(repos, boards, topics, { namespaces: [NS_DATA, NS_MISC], focusNs: UNGROUPED_KEY }, '');
  assert.ok(!t.rows.some((r) => r.type === 'ns'));
  assert.deepEqual(t.rows.filter((r) => r.type === 'repo').map((r) => r.key), ['github.com/a/three']);
});

test('#174 运行中视图：只显示有任务（待领取/等待中）的仓库与看板', () => {
  const topicsBusy = [
    { key: 'tk1', repo: { id: 'r1' }, pending: 2, waiting: false, tasks: [{ id: 1, status: 'pending' }] },
    { key: 'tk3', repo: { id: 'r3' }, pending: 0, waiting: false, tasks: [] },
  ];
  const t = buildTree(repos, boards, topicsBusy, { focusNs: ACTIVE_KEY }, '');
  const list = names(t);
  assert.ok(list.includes('one'), '有待领取的仓库在');
  assert.ok(!list.includes('three'), '没任务的不出现');
});

test('#178 概览：脏 items（分区 id / 未分组标记 / 不存在的 key）渲染时被忽略', () => {
  const prefs = {
    namespaces: [
      { id: 'ns_1', name: '数据', items: ['ns_2', UNGROUPED_KEY, ACTIVE_KEY, 'github.com/a/nope', 'github.com/a/one'] },
      { id: 'ns_2', name: '其它', items: ['github.com/a/two'] },
    ],
    focusNs: ALL_KEY,
  };
  const t = buildTree(repos, boards, topics, prefs, '');
  const heads = t.rows.filter((r) => r.type === 'ns');
  assert.deepEqual(heads.map((h) => h.name), ['数据', '其它', '未分组']);
  assert.equal(heads[0].count, 1, '只认真实条目（one）');
  assert.ok(!t.rows.some((r) => r.type !== 'ns' && String(r.key || '').startsWith('ns_')), '分区 id 不被当条目（头行本身除外）');
});

test('搜索时平铺（不折叠、不出现分区头）', () => {
  const t = buildTree(repos, boards, topics, { namespaces: [NS_DATA], focusNs: ALL_KEY }, 'two');
  assert.ok(!t.rows.some((r) => r.type === 'ns'));
  assert.ok(t.rows.some((r) => r.key === 'github.com/a/two'));
});

test('#179 概览里折叠的分区：头行在、成员不输出', () => {
  const prefs = {
    namespaces: [{ ...NS_DATA, collapsed: true }, NS_MISC],
    focusNs: ALL_KEY,
  };
  const t = buildTree(repos, boards, topics, prefs, '');
  const heads = t.rows.filter((r) => r.type === 'ns');
  assert.deepEqual(heads.map((h) => h.name), ['数据', '杂项', '未分组']);
  const keys = t.rows.map((r) => rKey(r));
  assert.ok(!keys.includes('github.com/a/one'), '折叠成员不出现');
  assert.ok(keys.includes('github.com/a/two'));
});
