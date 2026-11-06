// 就绪内核合一的一致性钉子（任务 #52）：
// 同一份任务行，任务行入口（isReadyToClaim / findFirstReadyPending）与
// 快照入口（topicToSnapshot → isNodeReady，即引擎 scheduler 同款内核）
// 对每条任务「可领/被挡」的结论必须逐一相等。
// 另钉跨队列依赖的 fail-open 三态（无解析器/未完成/已完成）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isReadyToClaim,
  findFirstReadyPending,
  normalizeBlockBy,
} from '../../src/modules/localtask/dag.js';
import { isNodeReady } from '../../src/core/workflow/readiness.js';
import { topicToSnapshot } from '../../src/core/workflow/project.js';

const T = (id, patch = {}) => ({
  id,
  text: `t${id}`,
  status: 'pending',
  createdAt: '',
  completedAt: '',
  deletedAt: '',
  migratedTo: null,
  blockBy: [],
  blocksFollowing: false,
  ...patch,
});

/**
 * 双模型一致性断言：对每条 alive 任务，
 *   isReadyToClaim(row, rows)  ===  isNodeReady(snap, node(row.id))
 * 含 foreign 引用的行不在快照图里（edgesFromTasks 跳过 "key:id"）→ 单列场景钉，不进此对比。
 */
function assertModelsAgree(name, rows) {
  const snap = topicToSnapshot({ key: 'k', tasks: rows });
  for (const row of rows) {
    if (row.deletedAt || row.migratedTo) continue; // 死行不在快照图里，两边都无从判
    const hasForeign = normalizeBlockBy(row.blockBy, row.id).some((d) => String(d).includes(':'));
    if (hasForeign) continue;
    const a = isReadyToClaim(row, rows);
    const node = snap.nodes.find((n) => String(n.id) === String(row.id));
    const b = node ? isNodeReady(snap, node) : true;
    assert.equal(a, b, `${name} #${row.id}: 任务行入口=${a} 快照入口=${b} 不一致`);
  }
  // findFirstReadyPending 自洽：选中的那条 = 数组序第一条 isReadyToClaim 为真的 pending
  const first = findFirstReadyPending(rows);
  const expected = rows.find((r) => !r.deletedAt && !r.migratedTo && r.status === 'pending' && isReadyToClaim(r, rows)) || null;
  assert.equal(first ? Number(first.id) : null, expected ? Number(expected.id) : null, `${name}: findFirstReadyPending 与逐条判定不一致`);
}

test('双模型一致：FIFO 无依赖', () => {
  const rows = [T(1), T(2), T(3)];
  assertModelsAgree('fifo', rows);
});

test('双模型一致：本地依赖链逐级解锁', () => {
  const rows = [T(1), T(2, { blockBy: [1] }), T(3, { blockBy: [2] })];
  assertModelsAgree('chain', rows);
  assert.equal(findFirstReadyPending(rows).id, 1);
  rows[0] = T(1, { status: 'done', completedAt: '2026-11-04 10:00:00' });
  assertModelsAgree('chain-1done', rows);
  assert.equal(findFirstReadyPending(rows).id, 2);
});

test('双模型一致：闸门挡住其后全部（含 claimed 未完成的闸门）', () => {
  const rows = [T(1, { blocksFollowing: true }), T(2), T(3)];
  assertModelsAgree('gate-blocks', rows);
  assert.equal(findFirstReadyPending(rows).id, 1, '闸门自身作为 pending 可领（它挡后续，不挡自己）');
  // 闸门已领取但未完成（claimed）→ 依旧挡（只有终态才放行）
  rows[0] = T(1, { blocksFollowing: true, status: 'claimed' });
  assertModelsAgree('gate-claimed', rows);
  assert.equal(findFirstReadyPending(rows), null);
  // 闸门完成 → 全放行
  rows[0] = T(1, { blocksFollowing: true, status: 'done', completedAt: '2026-11-04 10:00:00' });
  assertModelsAgree('gate-done', rows);
  assert.equal(findFirstReadyPending(rows).id, 2);
});

test('双模型一致：闸门在中间/尾部 + 删除行穿插', () => {
  const cases = [
    [T(1), T(2, { blocksFollowing: true }), T(3)],
    [T(1), T(2, { deletedAt: 'x' }), T(3, { blocksFollowing: true }), T(4)],
    [T(1, { blocksFollowing: true }), T(2, { deletedAt: 'x' }), T(3)],
  ];
  cases.forEach((rows, i) => assertModelsAgree(`gate-mid-${i}`, rows));
});

test('双模型一致：依赖 + 闸门组合（依赖的前驱本身被闸门挡住）', () => {
  const rows = [
    T(1, { blocksFollowing: true }),
    T(2, { blockBy: [1] }),
    T(3),
    T(4, { blockBy: [3] }),
  ];
  assertModelsAgree('combo', rows);
  // 完成闸门：#2 解锁（其依赖 #1 done），#3 也可领
  rows[0] = T(1, { blocksFollowing: true, status: 'done', completedAt: '2026-11-04 10:00:00' });
  assertModelsAgree('combo-gate-done', rows);
  assert.equal(findFirstReadyPending(rows).id, 2);
});

test('双模型一致：依赖已删/缺失 → fail-open；completed 缺 status 也认 completedAt', () => {
  const rows = [
    T(1, { deletedAt: 'x' }),
    T(2, { blockBy: [1] }), // 依赖已删 → 不挡
    T(3, { blockBy: [99] }), // 依赖不存在 → 不挡
    T(4, { blockBy: [5] }), // 依赖=只有 completedAt 的行 → completedAt 即放行
    T(5, { status: '', completedAt: '2026-11-04 09:00:00' }),
  ];
  assertModelsAgree('fail-open', rows);
  assert.equal(findFirstReadyPending(rows).id, 2);
});

test('跨队列依赖三态：无解析器放行 / 未完成挡 / 已完成放行（快照入口无此边，不参与对比）', () => {
  const foreign = { key: 'otherkey', id: 7 };
  let foreignTask = T(7, { status: 'claimed' });
  const resolveForeign = (k, id) => (k === foreign.key && id === foreign.id ? foreignTask : null);
  const row = T(9, { blockBy: [`${foreign.key}:${foreign.id}`] });

  assert.equal(isReadyToClaim(row, [row]), true, '无解析器 → fail-open 放行');
  assert.equal(isReadyToClaim(row, [row], { resolveForeign }), false, '前驱未完成 → 挡');
  foreignTask = T(7, { status: 'done', completedAt: '2026-11-04 10:00:00' });
  assert.equal(isReadyToClaim(row, [row], { resolveForeign }), true, '前驱完成 → 放行');
  assert.equal(isReadyToClaim(row, [row], { resolveForeign: () => null }), true, '解析不到 → fail-open');
});

test('快照内核驱动器（driveReadyStates）与任务行入口对同一 store 结论一致', async () => {
  // 端到端：service 建队列（闸门+依赖），两入口逐条对比
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const sb = mkdtempSync(join(tmpdir(), 'nx-kv-readiness-consistency-'));
  process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
  try {
    const svc = await import('../../src/modules/localtask/service.js');
    const dir = join(sb, 'proj');
    const a = await svc.addTask({ cwd: dir, text: '# 闸门', gate: true });
    await svc.addTask({ cwd: dir, text: '# 后续' });
    const c = await svc.addTask({ cwd: dir, text: '# 独立' });
    await svc.completeTask({ cwd: dir, id: a.task.id, summary: '闸门完成' });
    await svc.addTask({ cwd: dir, text: '# 等独立', blockBy: [String(c.task.id)] });

    const list = await svc.listTasks();
    const topic = list.topics.find((t) => !t.isGlobal);
    const rows = topic.tasks.filter((x) => !x.deletedAt && !x.migratedTo);
    assertModelsAgree('service-store', rows);
  } finally {
    // T03：先关库连接再删临时目录（svc 是 try 块内的局部 import，finally 里够不着）
    const { closeDb } = await import('../../src/modules/localtask/repo/index.js');
    try { closeDb(); } catch { /* ignore */ }
    rmSync(sb, { recursive: true, force: true, maxRetries: 3 });
  }
});
