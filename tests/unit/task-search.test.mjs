// #181 任务搜索：标题 + 正文模糊匹配（纯函数，见 src/web/frontend/modules/board/task-search.ts）
import test from 'node:test';
import assert from 'node:assert/strict';
import { hitTaskQuery, filterTasks, titleOf, bodyOf, contextOf } from '../../src/web/frontend/modules/board/task-search.js';

const task = (id, text) => ({ id, text });

const FM = [
  '---',
  'board: b_xxx',
  'project: github.com/on-devplan/nx-kv',
  '---',
].join('\n');

const T = {
  sidebar: task(181, `${FM}\n# 【侧边栏目录不要分页】\n\n侧栏里翻页有两套分页，去掉；顺带加搜索。`),
  status: task(179, `${FM}\n# 【任务状态tag】\n\n不要叫已交付，叫已完成。`),
  blank: task(7, `${FM}\n# 无正文任务`),
};

test('空查询串全命中；空白串等同空', () => {
  assert.equal(hitTaskQuery(T.sidebar, ''), true);
  assert.equal(hitTaskQuery(T.sidebar, '   '), true);
  assert.deepEqual(filterTasks(Object.values(T), ''), Object.values(T));
});

test('标题命中（大小写不敏感）', () => {
  assert.equal(hitTaskQuery(T.sidebar, '侧边栏'), true);
  assert.equal(hitTaskQuery(T.status, '任务状态TAG'), true);
  assert.equal(hitTaskQuery(T.status, '侧边栏'), false);
});

test('正文也算命中 target（正文里的词能搜到）', () => {
  assert.equal(hitTaskQuery(T.sidebar, '两套分页'), true);
  assert.equal(hitTaskQuery(T.status, '已交付'), true);
  assert.equal(hitTaskQuery(T.status, '已完成'), true);
});

test('frontmatter 不参与匹配（否则 board/project 会把整页命中）', () => {
  assert.equal(hitTaskQuery(T.blank, 'board'), false);
  assert.equal(hitTaskQuery(T.blank, 'on-devplan'), false);
  assert.equal(hitTaskQuery(T.sidebar, 'github.com'), false);
});

test('空格分词是 AND：每个词都要在标题或正文里出现', () => {
  assert.equal(hitTaskQuery(T.sidebar, '侧边栏 分页'), true);
  assert.equal(hitTaskQuery(T.sidebar, '侧边栏 已完成'), false);
});

test('编号：等值与前缀命中（#181 / 18 / #18），非编号词按子串', () => {
  assert.equal(hitTaskQuery(T.sidebar, '#181'), true);
  assert.equal(hitTaskQuery(T.sidebar, '18'), true);
  assert.equal(hitTaskQuery(T.sidebar, '#17'), false);
  assert.equal(hitTaskQuery(T.status, '179'), true);
});

test('显式通配 a*b：按段顺序命中', () => {
  assert.equal(hitTaskQuery(T.sidebar, '侧*页'), true);
  assert.equal(hitTaskQuery(T.sidebar, '页*边栏'), false);
});

test('标题取第一行非空行并去 #；正文剥掉 frontmatter', () => {
  assert.equal(titleOf(T.sidebar.text), '【侧边栏目录不要分页】');
  assert.equal(bodyOf(T.sidebar.text).includes('board:'), false);
  assert.equal(bodyOf(T.sidebar.text).includes('侧栏里翻页'), true);
});

test('filterTasks 保序 + 空列表安全', () => {
  const list = [T.status, T.sidebar, T.blank];
  assert.deepEqual(filterTasks(list, '已完成').map((t) => t.id), [179]);
  assert.deepEqual(filterTasks(list, '').map((t) => t.id), [179, 181, 7]);
  assert.deepEqual(filterTasks(null, 'x'), []);
  assert.equal(hitTaskQuery(null, 'x'), false);
});

// ── contextOf（#248）：搜索命中上下文窗口 ──

const WIDE = task(248, [
  FM,
  '# 【搜索结果带上下文】',
  ...Array.from({ length: 30 }, (_, i) => `填充第 ${i + 1} 行`),
  '目标词在这里出现',
  ...Array.from({ length: 30 }, (_, i) => `尾部第 ${i + 1} 行`),
].join('\n'));

test('contextOf：命中行上下各 10 行，共 21 行窗口', () => {
  const ctx = contextOf(WIDE, '目标词');
  assert.ok(ctx);
  // 命中行前有 30 行填充，窗口取前 10 + 命中行 + 后 10 = 21 行
  assert.equal(ctx.lines.length, 21);
  assert.equal(ctx.hitIndex, 10);
  assert.equal(ctx.hitLineNo, 32); // 1 标题 + 30 填充 + 1 = 命中在第 32 行
  assert.match(ctx.lines[10], /目标词/);
  assert.match(ctx.lines[0], /填充第 21 行/);
  assert.match(ctx.lines[20], /尾部第 10 行/);
});

test('contextOf：贴边截断——命中行靠文件头/尾时窗口不满 21 行', () => {
  const head = contextOf(T.sidebar, '两套分页');
  assert.ok(head);
  assert.ok(head.lines.length < 21);
  assert.equal(head.hitLineNo, 3); // frontmatter 已剥，标题 1 + 空行 2 + 命中 3
  assert.equal(head.lines[head.hitIndex].includes('两套分页'), true);
});

test('contextOf：编号点名不产生上下文；无命中返回 null', () => {
  assert.equal(contextOf(T.sidebar, '#181'), null);
  assert.equal(contextOf(T.sidebar, '不存在的词'), null);
  assert.equal(contextOf(null, '任意'), null);
  assert.equal(contextOf(T.sidebar, ''), null);
});

test('contextOf：多词 AND 取最早命中行；通配词行内判定', () => {
  const ctx = contextOf(T.sidebar, '翻页 搜索');
  assert.ok(ctx);
  // 「翻页」「搜索」都在正文第 3 行——窗口以它为中心
  assert.equal(ctx.hitLineNo, 3);
  const wild = contextOf(T.sidebar, '两*分页');
  assert.ok(wild);
  assert.equal(wild.hitLineNo, 3);
});
