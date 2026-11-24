// #254 · VS Code 式面包屑数据模型：三段解析、同级清单、复制载荷。
// 纯函数直测（不碰 DOM / 网络），夹具即最小 rows/boards/ns。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyPayloadOf, nsDirsOf, nsFirstTargetOf, vscTrailOf } from '../../src/web/frontend/components/layout/vsc-crumbs-model.js';

// ── 夹具：ns「nx」含看板 nx（成员 nx-kv / nx-sk）+ 直挂仓库 solo；队列 nx-kv 有任务 ──
const TOPIC_NXKV = {
  key: 't_kv',
  name: 'nx-kv',
  cwd: 'D:\\dev\\nx-kv',
  repo: { key: 'github.com/on/nx-kv', boards: [{ id: 'b_nx', name: 'nx' }] },
  tasks: [
    { id: 28, status: 'done', doneAt: '2026-11-24 10:00:00', deletedAt: '', migratedTo: null },
    { id: 30, status: 'pending', deletedAt: '', migratedTo: null },
    { id: 31, status: 'claimed', deletedAt: '', migratedTo: null },
    { id: 32, status: 'plan', deletedAt: '', migratedTo: null },
    { id: 33, status: 'pending', deletedAt: '2026-11-01 00:00:00', migratedTo: null }, // 软删：不入下拉
    { id: 34, status: 'done', doneAt: '2026-11-25 09:00:00', deletedAt: '', migratedTo: null },
  ],
};
const TOPIC_NXSK = {
  key: 't_sk',
  name: 'nx-sk',
  cwd: 'D:\\dev\\nx-sk',
  repo: { key: 'github.com/on/nx-sk', boards: [{ id: 'b_nx', name: 'nx' }] },
  tasks: [],
};
const TOPIC_SOLO = {
  key: 't_solo',
  name: 'solo',
  cwd: 'D:\\dev\\solo',
  repo: { key: 'github.com/on/solo', boards: [] },
  tasks: [],
};
const TOPIC_FREE = {
  key: 't_free',
  name: 'free',
  cwd: 'D:\\dev\\free',
  repo: { key: 'github.com/on/free', boards: [] },
  tasks: [{ id: 40, status: 'pending', deletedAt: '', migratedTo: null }],
};
const ROWS = [TOPIC_NXKV, TOPIC_NXSK, TOPIC_SOLO, TOPIC_FREE];
const BOARDS = [{ id: 'b_nx', key: 'group/nx', name: 'nx', repos: [{ key: 'github.com/on/nx-kv' }, { key: 'github.com/on/nx-sk' }] }];
const NS_LIST = [{ id: 'ns_nx', name: 'nx', items: ['board:b_nx', 'github.com/on/solo'] }];
const PREFS = { namespaces: NS_LIST };
const REPO_DATA = { boards: BOARDS };

test('vscTrailOf dir：三段 = ns / 组 / #任务，最后一段加重由组件管（模型只给 label）', () => {
  const t = vscTrailOf({ view: 'dir', key: 't_kv', task: '30' }, ROWS, REPO_DATA, PREFS);
  assert.ok(t);
  assert.deepEqual(
    t.segments.map((s) => s.label),
    ['nx', 'nx', '#30']
  );
  assert.equal(t.cwd, 'D:\\dev\\nx-kv');
  assert.equal(t.taskId, '30');
  assert.equal(t.isGroup, false);
});

test('vscTrailOf：draft 显示 draft 且没有任务号', () => {
  const t = vscTrailOf({ view: 'dir', key: 't_kv', task: 'draft-1' }, ROWS, REPO_DATA, PREFS);
  assert.ok(t);
  assert.equal(t.segments[2].label, 'draft');
  assert.equal(t.taskId, '');
});

test('ns 段同级 = 其余命名空间（不含当前），带 nsId', () => {
  const prefs = { namespaces: [...NS_LIST, { id: 'ns_b', name: 'b', items: [] }] };
  const t = vscTrailOf({ view: 'dir', key: 't_kv', task: '30' }, ROWS, REPO_DATA, prefs);
  assert.ok(t);
  const nsSeg = t.segments[0];
  assert.deepEqual(nsSeg.siblings, [{ label: 'b', hash: '', nsId: 'ns_b' }]);
});

test('组段同级 = 同命名空间的其余目录（board 成员展开 + 直挂仓库，去重，排除当前）', () => {
  const t = vscTrailOf({ view: 'dir', key: 't_kv', task: '30' }, ROWS, REPO_DATA, PREFS);
  const owner = t.segments[1];
  assert.deepEqual(
    owner.siblings.map((s) => s.hash),
    ['#/dir/t_sk', '#/dir/t_solo']
  );
});

test('未分组队列：段 1 显示「未分组」，同级 = ns 之外的其余队列（不含自己）', () => {
  const t = vscTrailOf({ view: 'dir', key: 't_free', task: '40' }, ROWS, REPO_DATA, PREFS);
  assert.ok(t);
  assert.equal(t.segments[0].label, '未分组');
  assert.equal(t.segments[1].label, 'free');
  // 唯一未分组队列就是自己 → 同级为空（按钮禁用，由组件处理）
  assert.deepEqual(t.segments[1].siblings, []);
});

test('任务段同级 = 同队列其余任务：软删过滤、状态序（pending→plan→claimed→done 新在前）', () => {
  const t = vscTrailOf({ view: 'dir', key: 't_kv', task: '30' }, ROWS, REPO_DATA, PREFS);
  const taskSeg = t.segments[2];
  assert.deepEqual(
    taskSeg.siblings.map((s) => s.label),
    ['#32（草稿）', '#31（已领取）', '#34（已完成）', '#28（已完成）']
  );
  assert.ok(taskSeg.siblings.every((s) => s.hash.startsWith('#/dir/t_kv?task=')));
});

test('组锚定路由：board 用 findGroupTask 解析的看板，任务同级落 #/group/<id>?task=', () => {
  // 组任务的寻址与组页同源：board.repos 成员 key 对上队列 + boardMark 指向本组
  const rows = [{
    ...TOPIC_NXKV,
    tasks: TOPIC_NXKV.tasks.map((t) => (t.id === 30 ? { ...t, boardMark: 'b_nx' } : t)),
  }];
  const t = vscTrailOf({ view: 'group', key: 'b_nx', task: '30' }, rows, REPO_DATA, PREFS);
  assert.ok(t);
  assert.equal(t.isGroup, true);
  assert.equal(t.boardId, 'b_nx');
  const taskSeg = t.segments[2];
  assert.ok(taskSeg.siblings.every((s) => s.hash.startsWith('#/group/b_nx?task=')));
  assert.equal(t.segments[1].label, 'nx');
});

test('nsDirsOf：board 成员展开 + 直挂仓库，按 items 序去重', () => {
  const dirs = nsDirsOf(NS_LIST[0], ROWS, BOARDS);
  assert.deepEqual(
    dirs.map((d) => d.key),
    ['t_kv', 't_sk', 't_solo']
  );
});

test('nsFirstTargetOf：首个成员是看板成员 → 组页；直挂仓库（无看板）→ 目录页；空 → 空', () => {
  assert.equal(nsFirstTargetOf(NS_LIST[0], ROWS, BOARDS), '#/group/b_nx');
  // solo 直挂在 ns 里但没有任何看板归属 → 落它自己的目录页
  assert.equal(
    nsFirstTargetOf({ items: ['github.com/on/solo'] }, ROWS, BOARDS),
    '#/dir/t_solo'
  );
  assert.equal(nsFirstTargetOf({ items: [] }, ROWS, BOARDS), '');
});

test('没有队列可锚定（key 不存在）→ null，页面退回旧提示', () => {
  assert.equal(vscTrailOf({ view: 'dir', key: 'nope', task: '1' }, ROWS, REPO_DATA, PREFS), null);
  assert.equal(vscTrailOf({ view: 'repos' }, ROWS, REPO_DATA, PREFS), null);
});

test('copyPayloadOf：raw =「cwd #id」；prompt = CLI 指令加引导；draft 两种都退回原始路径', () => {
  const t = vscTrailOf({ view: 'dir', key: 't_kv', task: '30' }, ROWS, REPO_DATA, PREFS);
  assert.equal(copyPayloadOf(t, 'raw'), 'D:\\dev\\nx-kv #30');
  const prompt = copyPayloadOf(t, 'prompt');
  assert.match(prompt, /localtask show --id 30 --cwd "D:\\dev\\nx-kv" --json/);
  assert.match(prompt, /localtask get --cwd "D:\\dev\\nx-kv" --json/);
  const d = vscTrailOf({ view: 'dir', key: 't_kv', task: 'draft-1' }, ROWS, REPO_DATA, PREFS);
  assert.equal(copyPayloadOf(d, 'prompt'), 'D:\\dev\\nx-kv (draft)');
});
