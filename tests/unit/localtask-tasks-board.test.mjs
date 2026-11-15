// localtask.tasks 的 `board` 标注（端侧组页的唯一数据来源）。
//
// 背景：fr（手机端）的组页要列「本组任务」，而组任务**物理上落在成员项目的队列里**
// （agent 按目录领活，队列归属不变），只有正文 frontmatter 的 `board` 说明它属于
// 哪个组 —— 这就是面板里的「两种走向」（见 task-view.ts 的 boardMarkOf）。
//
// 面板自己有全量 /api/localtasks（含正文），端侧没有：它只调 localtask.tasks 这条
// 轻量读接口。这条接口若不回 board，端侧就只能把「组」做成成员的导航 —— 那恰好是
// 2026-11-03 明确改掉的形态。所以这里钉住两件事：
//   1. 纯项目任务 → board 为空串（端侧据此把它留在项目队列里）；
//   2. 组任务 → board 为 frontmatter 里的原值（端侧据此把它归到该组）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'nx-kv-tasks-board-'));
process.env.NX_KV_HOME = join(dir, 'home');
process.env.NX_KV_DB = join(dir, 'nxkv.db');
process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');

const { ACTIONS } = await import('../../src/runtime/registry.js');
const addAction = ACTIONS.find((a) => a.id === 'localtask.add');
const tasksAction = ACTIONS.find((a) => a.id === 'localtask.tasks');
const { closeDb } = await import('../../src/core/db/index.js');

after(async () => {
  try { closeDb(); } catch { /* 已关 */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

test('localtask.tasks：组任务带 board，纯项目任务为空串', async () => {
  const cwd = join(dir, 'proj');
  const plain = await addAction.run({ cwd, text: '# 纯项目任务\n\n正文' }, { transport: 'cli' });
  const grouped = await addAction.run(
    { cwd, text: '---\nboard: b_mobile\nproject: local/proj\n---\n# 组任务\n\n正文' },
    { transport: 'cli' },
  );

  const out = await tasksAction.run({ cwd }, { transport: 'cli' });
  const byId = new Map(out.tasks.map((t) => [t.id, t]));
  assert.equal(byId.get(plain.id).board, '', '纯项目任务不该被算进任何组');
  assert.equal(byId.get(grouped.id).board, 'b_mobile', '组任务的 board 必须原样透出');
});

test('localtask.tasks：输出契约里 board 是必填字段（端侧按它分流，不能缺）', async () => {
  const out = await tasksAction.run({ cwd: join(dir, 'proj') }, { transport: 'cli' });
  for (const t of out.tasks) {
    assert.equal(typeof t.board, 'string', `#${t.id} 的 board 必须是字符串`);
  }
  // 契约对象本身也要有这一格 —— 少了它，生成出来的端侧模型就没有这个字段
  const parsed = tasksAction.output.safeParse(out);
  assert.ok(parsed.success, '真实返回必须能被出参契约解析');
});
