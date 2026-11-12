// 侧栏行模型（components/sidebar/model.js）：「显示编排」对**仓库行和看板行**都生效。
//
// 坑（任务 #61 验收反馈实测）：原来隐藏清单只过滤了仓库行，勾掉项目组完全没反应；
// 而设置面板直接写 localStorage，侧栏拿的 React state 不会更新——两个根因一起让
// 「配了显示/不显示但仍然全部显示」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, fmtWaitLeft, fmtDeadlineClock } from '../../src/web/frontend/components/sidebar/model.js';

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

// ─── 等待标记的倒计时（#182）─────────────────────────────────────────
//
// 「wait 持续 get 期间侧栏要显示时间」：行的 waitingDeadlineMs 取该行所有队列里
// **最早**结束的那个等待窗口（它最先需要处理），文本由组件每秒用 fmtWaitLeft 现算。
const NOW = 1_700_000_000_000;

test('仓库行等待截止：取 waitingUntilMs（毫秒精度）', () => {
  const topics = [{ key: 'tk1', repo: { id: 'r1' }, waiting: true, waitingUntilMs: NOW + 272_000 }];
  const row = buildTree(REPOS, BOARDS, topics, { hidden: [] }).rows.find((r) => r.name === 'ra');
  assert.equal(row.waiting, true);
  assert.equal(row.waitingDeadlineMs, NOW + 272_000);
  assert.equal(fmtWaitLeft(row.waitingDeadlineMs, NOW), '剩 4:32');
});

test('多个队列都在等：取最早结束的那个窗口', () => {
  const topics = [
    { key: 'tk1', repo: { id: 'r1' }, waiting: true, waitingUntilMs: NOW + 600_000 },
    { key: 'tk2', repo: { id: 'r1' }, waiting: true, waitingUntilMs: NOW + 60_000 },
    { key: 'tk3', repo: { id: 'r1' }, waiting: false, waitingUntilMs: NOW + 1_000 },
  ];
  const row = buildTree(REPOS, BOARDS, topics, { hidden: [] }).rows.find((r) => r.name === 'ra');
  assert.equal(row.waitingDeadlineMs, NOW + 60_000, '没在等的那条不算');
});

test('老数据没有 waitingUntilMs：回退解析 waitingUntil 字符串', () => {
  const topics = [{ key: 'tk1', repo: { id: 'r1' }, waiting: true, waitingUntil: '2026-11-12 10:31:02' }];
  const row = buildTree(REPOS, BOARDS, topics, { hidden: [] }).rows.find((r) => r.name === 'ra');
  const want = new Date(2026, 10, 12, 10, 31, 2).getTime();
  assert.equal(row.waitingDeadlineMs, want);
  assert.equal(fmtDeadlineClock(row.waitingDeadlineMs), '10:31:02');
});

test('组行 / 全局行的等待截止：看成员与自身主题', () => {
  const topics = [
    { key: 'tk1', repo: { id: 'r1' }, waiting: true, waitingUntilMs: NOW + 120_000 },
    { key: '__GLOBAL__', name: '全局任务', isGlobal: true, waiting: true, waitingUntilMs: NOW + 30_000 },
  ];
  const { rows } = buildTree(REPOS, BOARDS, topics, { hidden: [] });
  assert.equal(rows.find((r) => r.type === 'board').waitingDeadlineMs, NOW + 120_000, '组行借成员的窗口');
  assert.equal(rows.find((r) => r.type === 'global').waitingDeadlineMs, NOW + 30_000);
});

test('没有人在等：截止时刻为 0，文本为空（不占位）', () => {
  const row = buildTree(REPOS, BOARDS, [{ key: 'tk1', repo: { id: 'r1' } }], { hidden: [] }).rows.find((r) => r.name === 'ra');
  assert.equal(row.waiting, false);
  assert.equal(row.waitingDeadlineMs, 0);
  assert.equal(fmtWaitLeft(0, NOW), '');
});

test('fmtWaitLeft：跨小时带时分秒，过点显示已超时（向上取整，最后一秒不提前归零）', () => {
  assert.equal(fmtWaitLeft(NOW + 3_723_000, NOW), '剩 1:02:03');
  assert.equal(fmtWaitLeft(NOW + 500, NOW), '剩 0:01', '不足 1 秒按 1 秒算');
  assert.equal(fmtWaitLeft(NOW - 1, NOW), '已超时');
});
