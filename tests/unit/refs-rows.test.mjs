// ref 列表展示规则（#120 抽出模块后的纯函数契约）。
//
// 这些规则以前长在面板组件里，靠「界面上看着对」保证；一旦另一个入口（文档页介绍集、
// 仓库管理、提示词文档清单）自己抄一份，口径必然分叉。所以抽到 modules/refs/rows.ts
// 并在这里钉死：主名取谁、desc 何时显示、归属怎么计数与过滤。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  labelOf,
  descOf,
  scopeCounts,
  filterByScope,
  normalizeScope,
} from '../../src/web/frontend/refs/rows.js';

const row = (o = {}) => ({
  refId: 'r1', desc: '', title: '', summary: '', hasBody: true,
  type: 'repo', repoKey: 'github.com/me/x', groupKey: null,
  position: 0, main: false, note: '', tag: '', ...o,
});

test('labelOf：正文标题 → 首行摘要 → desc → 未命名', () => {
  assert.equal(labelOf(row({ title: '标题', summary: '摘要', desc: '描述' })), '标题');
  assert.equal(labelOf(row({ summary: '摘要', desc: '描述' })), '摘要');
  assert.equal(labelOf(row({ desc: '描述' })), '描述');
  assert.equal(labelOf(row()), '未命名文档');
});

test('descOf：与主名相同不重复显示；空 desc 返回空串', () => {
  assert.equal(descOf(row({ title: '标题', desc: '一句话' })), '一句话');
  assert.equal(descOf(row({ desc: '只有描述' })), '', 'desc 顶上主名时不再占第二行');
  assert.equal(descOf(row({ title: '标题', desc: '   ' })), '');
});

test('scopeCounts：四档计数，未知 type 只进 all', () => {
  const rows = [
    row({ type: 'repo' }),
    row({ type: 'repo' }),
    row({ type: 'group' }),
    row({ type: 'group_repo' }),
    row({ type: 'weird' }),
  ];
  assert.deepEqual(scopeCounts(rows), { all: 5, repo: 2, group: 1, group_repo: 1 });
  assert.deepEqual(scopeCounts(null), { all: 0, repo: 0, group: 0, group_repo: 0 });
});

test('filterByScope：all 不过滤，其余按 type 精确过滤', () => {
  const rows = [row({ type: 'repo' }), row({ type: 'group' }), row({ type: 'group_repo' })];
  assert.equal(filterByScope(rows, 'all').length, 3);
  assert.deepEqual(filterByScope(rows, 'group').map((r) => r.type), ['group']);
  assert.deepEqual(filterByScope(rows, 'group_repo').map((r) => r.type), ['group_repo']);
  assert.deepEqual(filterByScope(undefined, 'repo'), []);
});

test('normalizeScope：配置里的脏值一律当 all（不能让非法值把列表筛空）', () => {
  assert.equal(normalizeScope('repo'), 'repo');
  assert.equal(normalizeScope('group_repo'), 'group_repo');
  assert.equal(normalizeScope(''), 'all');
  assert.equal(normalizeScope(undefined), 'all');
  assert.equal(normalizeScope('REPO'), 'all');
});
