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

// ─── 两种走向（任务 #85）：徽标按走向分流 ─────────────────────────────
//
// 组任务（正文 frontmatter.board，服务端已在行上标 boardMark）物理上在项目
// 队列里，但走向归组：
//   仓库行徽标 = 纯项目任务的待领取之和（组任务不进项目侧计数）
//   组行徽标   = 成员队列里**指向本组**的组任务待领取（与组页「本组任务」同口径）

const TOPICS = [
  {
    key: 'tk1',
    repo: { id: 'r1' },
    pending: 3, // 服务端队列真相（含组任务）——面板侧按走向重数，不能直接用
    tasks: [
      { id: 1, status: 'pending', deletedAt: '' }, // 项目任务
      { id: 2, status: 'pending', deletedAt: '', boardMark: 'b1' }, // 本组的组任务
      { id: 3, status: 'pending', deletedAt: '', boardMark: 'bX' }, // 别的组的组任务
      { id: 4, status: 'claimed', deletedAt: '' }, // 已领取
    ],
  },
];

test('仓库行徽标：项目走向——组任务不计入（#85）', () => {
  const { rows } = buildTree(REPOS, BOARDS, TOPICS, { hidden: [] });
  const repoRow = rows.find((r) => r.type === 'repo' && r.name === 'ra');
  assert.equal(repoRow.pending, 1, 'b1/bX 两个组任务都不算，只数纯项目任务');
});

test('组行徽标：只数指向本组的组任务，纯项目任务不算（#85）', () => {
  const { rows } = buildTree(REPOS, BOARDS, TOPICS, { hidden: [] });
  assert.equal(rows.find((r) => r.type === 'board').pending, 1, '只数 boardMark=b1 的待领取');
});

test('组行徽标：按组名也能认（手写 frontmatter 用组名）', () => {
  const topics = [
    { key: 'tk1', repo: { id: 'r1' }, pending: 9, tasks: [{ id: 5, status: 'pending', boardMark: 'grp' }] },
  ];
  const { rows } = buildTree(REPOS, BOARDS, topics, { hidden: [] });
  assert.equal(rows.find((r) => r.type === 'board').pending, 1);
});

test('组行徽标：consumed / 软删除的组任务不算', () => {
  const topics = [
    {
      key: 'tk1',
      repo: { id: 'r1' },
      pending: 2,
      tasks: [
        { id: 6, status: 'claimed', boardMark: 'b1' },
        { id: 7, status: 'pending', deletedAt: '2026-11-06 10:00:00', boardMark: 'b1' },
        { id: 8, status: 'pending', boardMark: 'b1' },
      ],
    },
  ];
  const { rows } = buildTree(REPOS, BOARDS, topics, { hidden: [] });
  assert.equal(rows.find((r) => r.type === 'board').pending, 1);
  assert.equal(rows.find((r) => r.type === 'repo' && r.name === 'ra').pending, 0, '队列里全是组任务 → 项目侧徽标归零');
});
