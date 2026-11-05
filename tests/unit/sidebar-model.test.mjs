// 侧栏行模型（components/sidebar/model.js）：「显示编排」对**仓库行和看板行**都生效。
//
// 坑（任务 #61 验收反馈实测）：原来隐藏清单只过滤了仓库行，勾掉项目组完全没反应；
// 而设置面板直接写 localStorage，侧栏拿的 React state 不会更新——两个根因一起让
// 「配了显示/不显示但仍然全部显示」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from '../../src/web/frontend/components/sidebar/model.js';

const REPOS = [
  { id: 'r1', key: 'github.com/me/ra', name: 'ra', path: 'D:/w/ra' },
  { id: 'r2', key: 'github.com/me/rb', name: 'rb', path: 'D:/w/rb' },
  { id: 'r3', key: 'github.com/me/rc', name: 'rc', path: 'D:/w/rc' },
];
const BOARDS = [{ id: 'b1', key: 'board/grp', name: 'grp', repos: [{ key: 'github.com/me/ra' }] }];

test('不配隐藏：组行 + 每个仓库行都在（仓库平铺，不缩进在组下）', () => {
  const { rows } = buildTree(REPOS, BOARDS, [], { hidden: [] });
  assert.deepEqual(rows.map((r) => r.name), ['grp', 'ra', 'rb', 'rc']);
  const repoRows = rows.filter((r) => r.type === 'repo');
  assert.equal(repoRows.length, 3, '每个仓库都出行（不因为被组链接就消失）');
  assert.equal(repoRows[0].groupId, '', '仓库行平铺：不进任何组的桶');
});

test('隐藏仓库：那一行不出', () => {
  const { rows } = buildTree(REPOS, BOARDS, [], { hidden: ['github.com/me/rb'] });
  assert.deepEqual(rows.map((r) => r.name), ['grp', 'ra', 'rc']);
});

test('隐藏项目组：组行也不出（之前只过滤仓库行 → 勾了没反应）', () => {
  const { rows } = buildTree(REPOS, BOARDS, [], { hidden: ['board/grp'] });
  assert.deepEqual(rows.map((r) => r.name), ['ra', 'rb', 'rc']);
  assert.equal(rows.some((r) => r.type === 'board'), false, '组行被隐藏');
});
