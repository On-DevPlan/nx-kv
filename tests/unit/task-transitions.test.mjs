// 状态跃迁表 + repo 语义写函数的收敛护栏（2026-11-19）。
//
// 背景：全仓所有 `SET status` 已收敛到 repo/tasks.ts 一个文件，但通用
// updateTask 的 colMap 曾留有 status 口子——5 处业务调用绕过带守卫的语义函数
// 直写状态。本文件锁住两层：
//   ① 表层：TASK_TRANSITIONS 覆盖全部状态、终态无出边、canTransition 正反判定；
//   ② 库层：updateTask({ status }) 是静默 no-op（状态不能再绕守卫直写）；
//      tombstoneAsCancelled / switchPlanStatus / alignClaimedFromSnapshot
//      三个语义函数的守卫行为与跃迁表逐条对齐。
//
// 存储指向临时文件（NX_KV_LOCALTASK_STORE），绝不写用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TASK_STATUSES, TASK_TRANSITIONS, canTransition } from '../../src/shared/task-status.js';
import * as svc from '../../src/modules/localtask/service.js';
import * as tasksRepo from '../../src/modules/localtask/repo/tasks.js';
import * as topicsRepo from '../../src/modules/localtask/repo/topics.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-transitions-'));
const storeFile = join(tmp, 'localtasks.json');
const dir = join(tmp, 'proj');
mkdirSync(dir, { recursive: true });
process.env.NX_KV_LOCALTASK_STORE = storeFile;
process.env.NX_KV_CONFIG = join(tmp, 'config.json'); // 隔离登录态，不触网

process.on('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结果 */
  }
});

const key = svc.normalizeCwd(dir).key;

// ── ① 表层：声明式状态机 ──────────────────────────────────────────────

test('跃迁表：五态全覆盖、终态无出边', () => {
  for (const s of TASK_STATUSES) {
    assert.ok(Array.isArray(TASK_TRANSITIONS[s]), `状态 ${s} 缺少跃迁表条目`);
  }
  assert.deepEqual(TASK_TRANSITIONS.done, [], 'done 是终态，不许有出边');
  assert.deepEqual(TASK_TRANSITIONS.cancelled, [], 'cancelled 是终态，不许有出边');
});

test('canTransition：合法边真、非法边与未知状态一律假', () => {
  // 全部合法边（与 repo 语义函数守卫一一对应）
  assert.ok(canTransition('pending', 'claimed'));
  assert.ok(canTransition('pending', 'done'));
  assert.ok(canTransition('pending', 'cancelled'));
  assert.ok(canTransition('pending', 'plan'));
  assert.ok(canTransition('plan', 'pending'));
  assert.ok(canTransition('plan', 'claimed'));
  assert.ok(canTransition('plan', 'cancelled'));
  assert.ok(canTransition('claimed', 'done'));
  assert.ok(canTransition('claimed', 'cancelled'));
  // 非法流转
  assert.equal(canTransition('done', 'pending'), false, '终态不许复活');
  assert.equal(canTransition('cancelled', 'pending'), false);
  assert.equal(canTransition('claimed', 'plan'), false, '正在跑的任务不许变草稿');
  assert.equal(canTransition('done', 'cancelled'), false, '终态之间不互转');
  // 未知状态一律 false（正判定哲学：宁可挡住也不放行）
  assert.equal(canTransition('unknown', 'pending'), false);
  assert.equal(canTransition('pending', 'unknown'), false);
});

// ── ② 库层：收敛护栏 ─────────────────────────────────────────────────

test('updateTask 通用 patch 不能再写 status（收敛核心断言）', async () => {
  await svc.resetLocaltaskStore();
  const added = await svc.addTask({ cwd: dir, text: '不许绕守卫' });
  const t = topicsRepo.getTopic(key);
  const next = tasksRepo.updateTask(t.id, added.task.id, { status: 'done', text: '改正文' });
  assert.equal(next.status, 'pending', 'status 应被通用 patch 忽略');
  assert.equal(next.text, '改正文', '其余字段照常生效');
});

test('tombstoneAsCancelled：pending/claimed 可定格；done 不动；重复定格幂等', async () => {
  await svc.resetLocaltaskStore();
  const a = await svc.addTask({ cwd: dir, text: '待领取直接定格' });
  const t = topicsRepo.getTopic(key);

  // pending → cancelled + ext 审计字段
  const r1 = tasksRepo.tombstoneAsCancelled(t.id, a.task.id, { supersededBy: 42 });
  assert.equal(r1.status, 'cancelled');
  assert.equal(r1.supersededBy, 42);
  // 已 cancelled 再定格：状态不变，但 ext 审计字段仍可补写（重开已取消任务要留派生标记）
  const r2 = tasksRepo.tombstoneAsCancelled(t.id, a.task.id, { supersededBy: 43 });
  assert.equal(r2.status, 'cancelled');
  assert.equal(r2.supersededBy, 43);

  // claimed → cancelled
  const b = await svc.addTask({ cwd: dir, text: '先领再定格' });
  tasksRepo.claimTask(t.id, b.task.id, {});
  assert.equal(tasksRepo.tombstoneAsCancelled(t.id, b.task.id).status, 'cancelled');

  // done 保持 done（tombstone 拿不到、状态不被改写）
  const c = await svc.addTask({ cwd: dir, text: '已完成不许改' });
  tasksRepo.claimTask(t.id, c.task.id, {});
  tasksRepo.completeTask(t.id, c.task.id, { feedback: '交付了' });
  assert.equal(tasksRepo.tombstoneAsCancelled(t.id, c.task.id), null);
  assert.equal(tasksRepo.getTaskRow(t.id, c.task.id).task.status, 'done');
});

test('switchPlanStatus：pending↔plan 双向；其余状态被守卫拒绝', async () => {
  await svc.resetLocaltaskStore();
  const a = await svc.addTask({ cwd: dir, text: '转草稿再转回' });
  const t = topicsRepo.getTopic(key);
  assert.equal(tasksRepo.switchPlanStatus(t.id, a.task.id, 'plan').status, 'plan');
  assert.equal(tasksRepo.switchPlanStatus(t.id, a.task.id, 'pending').status, 'pending');
  // claimed → plan 拒绝（正在跑的活不许悄悄变草稿）
  tasksRepo.claimTask(t.id, a.task.id, {});
  assert.equal(tasksRepo.switchPlanStatus(t.id, a.task.id, 'plan'), null);
  assert.equal(tasksRepo.getTaskRow(t.id, a.task.id).task.status, 'claimed');
});

test('alignClaimedFromSnapshot：非终态对齐为 claimed；幂等；done/cancelled 不动', async () => {
  await svc.resetLocaltaskStore();
  const a = await svc.addTask({ cwd: dir, text: '外部 DAG 说在跑' });
  const t = topicsRepo.getTopic(key);
  assert.equal(tasksRepo.alignClaimedFromSnapshot(t.id, a.task.id), true);
  assert.equal(tasksRepo.getTaskRow(t.id, a.task.id).task.status, 'claimed');
  // 幂等：已 claimed 返回 false，不再重复 bump
  assert.equal(tasksRepo.alignClaimedFromSnapshot(t.id, a.task.id), false);
  // done 不许被对齐改写
  tasksRepo.completeTask(t.id, a.task.id, { feedback: '交付了' });
  assert.equal(tasksRepo.alignClaimedFromSnapshot(t.id, a.task.id), false);
  assert.equal(tasksRepo.getTaskRow(t.id, a.task.id).task.status, 'done');
  // plan 也可被外部快照对齐（外部引擎说在跑就是事实）
  const b = await svc.addTask({ cwd: dir, text: '草稿被外部领走' });
  tasksRepo.switchPlanStatus(t.id, b.task.id, 'plan');
  assert.equal(tasksRepo.alignClaimedFromSnapshot(t.id, b.task.id), true);
});
