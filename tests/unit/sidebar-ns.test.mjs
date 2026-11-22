// 侧边栏 namespace 分区（#167）的纯函数验证：buildTree 的分组渲染。
// 纯 UI 组织——归组 / 排序 / 置顶 / 折叠全在 prefs.namespaces，数据模型零改动。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, UNGROUPED_KEY, rKey } from '../../src/web/frontend/components/sidebar/model.js';

const repos = [
  { id: 'r1', key: 'github.com/a/one', name: 'one', path: 'D:/w/one', type: 'repo' },
  { id: 'r2', key: 'github.com/a/two', name: 'two', path: 'D:/w/two', type: 'repo' },
  { id: 'r3', key: 'github.com/a/three', name: 'three', path: 'D:/w/three', type: 'repo' },
];
const boards = [{ id: 'b1', key: 'board/组一', name: '组一', repos: [{ key: 'github.com/a/one' }] }];
const topics = [];

test('无 namespaces → 现状平铺（无 ns 头行）', () => {
  const t = buildTree(repos, boards, topics, {}, '');
  assert.ok(!t.rows.some((r) => r.type === 'ns'), '不出现分区头');
  // 全局缺失时首行是看板（组一行）
  assert.equal(t.rows[0]?.type, 'board');
});

test('分区输出：pinned 分区在前（保持数组序），分区内按 items 序，未分区条目进「未分组」', () => {
  const prefs = {
    namespaces: [
      { id: 'ns_2', name: '日常', items: ['github.com/a/three', 'board:b1'] },
      { id: 'ns_1', name: '核心', items: ['github.com/a/one'], pinned: true },
    ],
  };
  const t = buildTree(repos, boards, topics, prefs, '');
  const types = t.rows.map((r) => r.type);
  assert.ok(types.includes('ns'), '出现分区头');
  // 置顶分区「核心」在最前（全局缺失），随后「日常」，最后未分组
  const firstNs = t.rows.findIndex((r) => r.type === 'ns');
  assert.equal(t.rows[firstNs].name, '核心');
  assert.equal(t.rows[firstNs + 1]?.type, 'repo');
  assert.equal(t.rows[firstNs + 1]?.key, 'github.com/a/one');
  const names = t.rows.filter((r) => r.type === 'ns').map((r) => r.name);
  assert.deepEqual(names, ['核心', '日常', '未分组']);
  // 未分组区含 two / three？——three 在日常分区、two 未分组：未分区头后是 two
  const lastNs = t.rows.map((r) => r.name).lastIndexOf('未分组');
  assert.equal(t.rows[lastNs + 1]?.key, 'github.com/a/two');
});

test('折叠分区：头行仍在、成员行不输出', () => {
  const prefs = {
    namespaces: [
      { id: 'ns_1', name: '日常', items: ['github.com/a/one'], collapsed: true },
      { id: 'ns_2', name: '其它', items: ['github.com/a/two'] },
    ],
  };
  const t = buildTree(repos, boards, topics, prefs, '');
  const heads = t.rows.filter((r) => r.type === 'ns');
  // three 与 board b1 未归分区 → 末尾还有一个「未分组」头
  assert.deepEqual(heads.slice(0, 2).map((h) => h.name), ['日常', '其它']);
  assert.equal(heads[2].name, '未分组');
  // one 被折叠藏起，two 照常
  const keys = t.rows.map((r) => rKey(r));
  assert.ok(!keys.includes('github.com/a/one'), '折叠成员不出现');
  assert.ok(keys.includes('github.com/a/two'));
});

test('搜索时平铺（不出现 ns 头行，命中即见）', () => {
  const prefs = { namespaces: [{ id: 'ns_1', name: '日常', items: ['github.com/a/one'] }] };
  const t = buildTree(repos, boards, topics, prefs, 'two');
  assert.ok(!t.rows.some((r) => r.type === 'ns'), '搜索时不折叠');
  assert.ok(t.rows.some((r) => r.key === 'github.com/a/two'), '未分组成员照常命中');
});

test('未分组头行的 key 是 UNGROUPED_KEY，条目数与 pending 汇总在头行', () => {
  const prefs = { namespaces: [{ id: 'ns_1', name: '全部收走', items: ['github.com/a/one', 'github.com/a/two'] }] };
  const t = buildTree(repos, boards, topics, prefs, '');
  const head = t.rows.find((r) => r.key === UNGROUPED_KEY);
  assert.ok(head, '有未分组头（three 与 board b1 不在分区）');
  assert.equal(head.count, 2);
});

// ── #174：视图聚焦（focusNs）与未分组折叠 ─────────────────────────────────
test('#174 focusNs=ACTIVE：只显示有任务（待领取/等待中）的仓库与看板', async () => {
  const { ACTIVE_KEY } = await import('../../src/web/frontend/components/sidebar/model.js');
  const topics = [
    { key: 'tk1', repo: { id: 'r1' }, pending: 2, waiting: false, tasks: [{ id: 1, status: 'pending' }] },
    { key: 'tk3', repo: { id: 'r3' }, pending: 0, waiting: false, tasks: [] },
  ];
  const t = buildTree(repos, boards, topics, { focusNs: ACTIVE_KEY }, '');
  const names = t.rows.filter((r) => r.type === 'repo' || r.type === 'board').map((r) => r.name);
  assert.ok(names.includes('one'), '有待领取的仓库在');
  assert.ok(!names.includes('three'), '没任务的仓库不出现');
});

test('#174 focusNs=分区 id：只显示该分区（展开态）', () => {
  const prefs = {
    namespaces: [
      { id: 'ns_1', name: '核心', items: ['github.com/a/one'], collapsed: true },
      { id: 'ns_2', name: '其它', items: ['github.com/a/two'] },
    ],
    focusNs: 'ns_1',
  };
  const t = buildTree(repos, boards, topics, prefs, '');
  const heads = t.rows.filter((r) => r.type === 'ns');
  assert.equal(heads.length, 1, '只有一个分区头');
  assert.equal(heads[0].name, '核心');
  assert.equal(heads[0].collapsed, false, '聚焦态强制展开');
  assert.ok(t.rows.some((r) => r.key === 'github.com/a/one'), '成员显示');
  assert.ok(!t.rows.some((r) => r.name === '每日' || r.key === 'github.com/a/two'), '其它分区不显示');
});

test('#174 未分组默认折叠（分区 = 显示范围），nsUngroupedOpen 才展开', () => {
  const prefs = { namespaces: [{ id: 'ns_1', name: '核心', items: ['github.com/a/one'] }] };
  const t = buildTree(repos, boards, topics, prefs, '');
  const head = t.rows.find((r) => r.key === UNGROUPED_KEY);
  assert.equal(head.collapsed, true, '默认折叠');
  const t2 = buildTree(repos, boards, topics, { ...prefs, nsUngroupedOpen: true }, '');
  const head2 = t2.rows.find((r) => r.key === UNGROUPED_KEY);
  assert.equal(head2.collapsed, false, '手动展开');
});
