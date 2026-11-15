// localtask.boardtasks —— 端侧组页的「本组任务」聚合读。
//
// 钉住的口径（与面板 board-view.ts 的 taskInBoard / projectPending 同款）：
//   1. 组任务物理上落在成员项目的队列里，归属只看正文 frontmatter 的 board；
//   2. 组页要的项目 tag = 任务所在队列的仓库名（未登记的目录队列不属于任何组）；
//   3. 非成员仓库的队列里就算写着本组 board，也不算本组任务（成员关系按仓库 key）；
//   4. 软删除的不算（面板所有列表都不显示，端侧跟着一致）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'nx-kv-boardtasks-'));
process.env.NX_KV_HOME = join(dir, 'home');
process.env.NX_KV_DB = join(dir, 'nxkv.db');
process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');

const { ACTIONS } = await import('../../src/runtime/registry.js');
const find = (id) => ACTIONS.find((a) => a.id === id);
const { closeDb } = await import('../../src/core/db/index.js');

const projA = join(dir, 'a');
const projB = join(dir, 'b');
mkdirSync(projA, { recursive: true });
mkdirSync(projB, { recursive: true });

await find('repo.add').run({ path: projA, name: 'a', key: 'local/a' }, { transport: 'cli' });
await find('repo.add').run({ path: projB, name: 'b', key: 'local/b' }, { transport: 'cli' });
const board = await find('board.add').run({ name: 'grp' }, { transport: 'cli' });
await find('board.assign').run({ id: 'local/a', board: 'grp' }, { transport: 'cli' });

const add = find('localtask.add');
// 本组成员 a 的队列里：一条组任务、一条纯项目任务
const grouped = await add.run({ cwd: projA, text: '# 组任务一', board: 'grp', project: 'a' }, { transport: 'cli' });
const plain = await add.run({ cwd: projA, text: '# 项目任务' }, { transport: 'cli' });
// 非成员 b 的队列里：手写 frontmatter 声称属于 grp（模拟手工改归属）
await add.run({ cwd: projB, text: `---\nboard: ${board.key}\n---\n# B 的野任务` }, { transport: 'cli' });

after(async () => {
  try { closeDb(); } catch { /* 已关 */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

test('boardtasks：只聚成员队列里的组任务，纯项目任务不进组', async () => {
  const out = await find('localtask.boardtasks').run({}, { transport: 'cli' });
  const grp = out.boards.find((b) => b.key === board.key);
  assert.ok(grp, 'grp 组必须出现在结果里');
  assert.deepEqual(grp.tasks.map((t) => t.id), [grouped.id], '只有那条组任务；纯项目任务不算');
  assert.equal(grp.pending, 1);
  assert.equal(grp.total, 1);
});

test('boardtasks：每行带归属项目（组页的项目 tag）与物理落点 topicKey', async () => {
  const out = await find('localtask.boardtasks').run({ board: 'grp' }, { transport: 'cli' });
  const row = out.boards[0].tasks[0];
  assert.equal(row.project, 'a', '项目 tag 取任务所在队列的仓库名');
  assert.equal(row.topicKey, grouped.key, 'topicKey 是物理落点（领取按它定位）');
});

test('boardtasks：非成员仓库的队列不算本组（成员关系按仓库 key）', async () => {
  const out = await find('localtask.boardtasks').run({ board: 'grp' }, { transport: 'cli' });
  assert.equal(out.boards[0].tasks.some((t) => t.title === 'B 的野任务'), false);
});

test('boardtasks：软删除的组任务不出现（与面板列表同口径）', async () => {
  const extra = await add.run({ cwd: projA, text: '# 要删掉的组任务', board: 'grp', project: 'a' }, { transport: 'cli' });
  let out = await find('localtask.boardtasks').run({ board: 'grp' }, { transport: 'cli' });
  assert.ok(out.boards[0].tasks.some((t) => t.id === extra.id));

  await find('localtask.remove').run({ id: extra.id, cwd: projA }, { transport: 'cli' });
  out = await find('localtask.boardtasks').run({ board: 'grp' }, { transport: 'cli' });
  assert.equal(out.boards[0].tasks.some((t) => t.id === extra.id), false);
});

test('boardtasks：组不存在 → 明确报错（不静默回空）', async () => {
  await assert.rejects(
    () => find('localtask.boardtasks').run({ board: 'nope' }, { transport: 'cli' }),
    /项目组不存在/
  );
});

test('boardtasks：出参契约能解析真实返回（端侧生成模型据此成形）', async () => {
  const out = await find('localtask.boardtasks').run({}, { transport: 'cli' });
  assert.ok(find('localtask.boardtasks').output.safeParse(out).success);
  assert.ok(Array.isArray(out.boards));
  for (const b of out.boards) {
    for (const t of b.tasks) {
      assert.equal(typeof t.project, 'string');
      assert.equal(typeof t.topicKey, 'string');
    }
  }
  // plain 任务不该出现在任何组里
  assert.equal(out.boards.some((b) => b.tasks.some((t) => t.id === plain.id && b.key === board.key)), false);
});
