// task move —— 本机 ⇄ 云端迁移的服务端逻辑测试（原型设计稿 §5 / §7.3 契约）。
//
// 云端（todo 服务）依赖 KV 后端与登录态，单测里用**注入的假云端**（move.js 的
// _cloud 注入口）模拟：待办桶 + 同内容多条 + 目标端写失败。真实环境的一致性由
// todo-logic.test.mjs 与 smoke 覆盖。
//
// 存储一律指向临时文件（NX_KV_LOCALTASK_STORE），绝不写脏用户目录。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-task-move-'));
process.env.NX_KV_LOCALTASK_STORE = join(tmp, 'store.json');

const { addTask, listTasks } = await import('../../src/modules/localtask/service.js');
const { moveTask } = await import('../../src/modules/localtask/move.js');
const { splitQueueTasks } = await import('../../src/modules/localtask/board.js');

const DIR = 'D:/tmp/nx-kv-move-test';

// 假云端：open 桶数组 + 可控失败
function fakeCloud({ open = [], fail = false } = {}) {
  let nextId = Math.max(0, ...open.map((t) => t.id)) + 1;
  const state = { open, fail };
  return {
    state,
    async loadAll() {
      if (state.fail) throw new Error('KV 后端不可达（模拟）');
      return { open: state.open.map((t) => ({ ...t })), done: [], freeze: [], topics: [] };
    },
    async addTodo({ topic, text, from = '' }) {
      if (state.fail) throw new Error('KV 后端不可达（模拟）');
      const task = { id: nextId++, topic, text, from, createdAt: '2026-10-28T12:00:00+08:00', doneAt: '', note: '', frozenAt: '' };
      state.open.push(task);
      return { task, topicAdded: false, id: task.id };
    },
    async removeOpenById(id) {
      if (state.fail) throw new Error('KV 后端不可达（模拟）');
      const i = state.open.findIndex((t) => t.id === id);
      if (i < 0) throw new Error('待办里没有 #' + id);
      return { removed: state.open.splice(i, 1)[0] };
    },
  };
}

async function topicByName(name) {
  return (await listTasks()).topics.find((t) => t.name === name);
}

beforeEach(async () => {
  rmSync(process.env.NX_KV_LOCALTASK_STORE, { force: true });
});

test('local→cloud：目标端先写成功，源端才打迁出标记（原子序）', async () => {
  await addTask({ cwd: DIR, text: '任务A' });
  const cloud = fakeCloud();
  const r = await moveTask({ from: 'local', to: 'cloud', cwd: DIR, id: 1, _cloud: cloud });

  assert.equal(r.from, 'local');
  assert.equal(r.targetId, 1); // 云端新待办 #1
  assert.equal(r.tombstoneId, 1);
  assert.equal(cloud.state.open[0].text, '任务A');
  assert.equal(cloud.state.open[0].from, 'local', '云端侧要带「来自本机」来源标记');

  const t = await topicByName('nx-kv-move-test');
  assert.equal(t.pending, 0, '迁出后不再算待领取（不会被派发给 agent）');
  const split = splitQueueTasks(t.tasks);
  assert.equal(split.pending.length, 0);
  assert.equal(split.migrated.length, 1);
  assert.equal(split.migrated[0].migratedTo.topic, 'nx-kv-move-test');
  assert.equal(split.migrated[0].migratedTo.targetId, 1);
});

test('local→cloud：目标端写失败 → 源端原地不动、不产生迁出记录', async () => {
  await addTask({ cwd: DIR, text: '任务B' });
  const cloud = fakeCloud({ fail: true });
  await assert.rejects(() => moveTask({ from: 'local', to: 'cloud', cwd: DIR, id: 1, _cloud: cloud }), /KV 后端不可达/);

  const t = await topicByName('nx-kv-move-test');
  assert.equal(t.pending, 1, '任务留在原地可重试');
  assert.equal(splitQueueTasks(t.tasks).migrated.length, 0, '失败不留迁出记录');
});

test('local→cloud：merge 合并到已有同内容条目，不新增', async () => {
  await addTask({ cwd: DIR, text: '同内容' });
  const cloud = fakeCloud({ open: [{ id: 7, topic: 'nx-kv-move-test', text: '同内容', from: '', createdAt: '', doneAt: '', note: '', frozenAt: '' }] });
  const r = await moveTask({ from: 'local', to: 'cloud', cwd: DIR, id: 1, merge: true, _cloud: cloud });

  assert.equal(r.merged, true);
  assert.equal(r.targetId, 7);
  assert.equal(cloud.state.open.length, 1, '没有新增云端条目');
});

test('cloud→local：落到待领取首位并带「来自云端」标记，云端那条删除', async () => {
  const cloud = fakeCloud({
    open: [
      { id: 3, topic: 'somewhere', text: '云端任务X', from: '', createdAt: 'c1', doneAt: '', note: '', frozenAt: '' },
      { id: 4, topic: 'somewhere', text: '云端任务X', from: '', createdAt: 'c2', doneAt: '', note: '', frozenAt: '' },
    ],
  });
  // 同内容 ×N 必须消歧，不能悄悄吞掉
  await assert.rejects(
    () => moveTask({ from: 'cloud', to: 'local', topic: 'somewhere', text: '云端任务X', cwd: DIR, _cloud: cloud }),
    (e) => e.code === 'CONFLICT' && e.details.candidates.length === 2
  );
  assert.equal(cloud.state.open.length, 2, '消歧冲突时不删任何一条');

  await addTask({ cwd: DIR, text: '已有任务' });
  const r = await moveTask({ from: 'cloud', to: 'local', topic: 'somewhere', text: '云端任务X', pick: 1, cwd: DIR, _cloud: cloud });

  assert.equal(r.targetId, 2, '新任务插到队列（编号顺延）');
  assert.equal(cloud.state.open.length, 1, '云端那条被删');
  assert.equal(cloud.state.open[0].id, 3, '删的是 pick 指定的那条（#4）');

  const t = await topicByName('nx-kv-move-test');
  const split = splitQueueTasks(t.tasks);
  assert.equal(split.pending[0].text, '云端任务X', '待领取首位');
  assert.equal(split.pending[0].from, 'cloud');
  assert.equal(split.pending[1].text, '已有任务');
});

test('撤销 local→cloud：按 targetId 精确删云端条目，本机回到待领取首位', async () => {
  await addTask({ cwd: DIR, text: '任务C' });
  await addTask({ cwd: DIR, text: '任务D' });
  const cloud = fakeCloud();
  const r = await moveTask({ from: 'local', to: 'cloud', cwd: DIR, id: 1, _cloud: cloud });
  assert.equal(r.targetId, 1);

  const u = await moveTask({
    from: 'local', to: 'cloud', undo: true, 'target-id': r.targetId, id: r.tombstoneId, cwd: DIR, _cloud: cloud,
  });
  assert.equal(u.undone, true);
  assert.equal(cloud.state.open.length, 0, '云端条目被精确删除');
  const t = await topicByName('nx-kv-move-test');
  const split = splitQueueTasks(t.tasks);
  assert.equal(split.pending.length, 2, '两条任务都回到待领取');
  assert.equal(split.pending[0].text, '任务C', '撤销后回到原优先级位置（首位）');
  assert.equal(split.migrated.length, 0);
});

test('撤销 cloud→local：移除本机那条，云端原样恢复', async () => {
  const cloud = fakeCloud();
  // 手动构造一条「已从云端迁入」的本机任务
  const { insertTaskAtTop } = await import('../../src/modules/localtask/service.js');
  const ins = await insertTaskAtTop({ cwd: DIR, text: '云端任务Y', from: 'cloud' });

  const u = await moveTask({
    from: 'cloud', to: 'local', undo: true, 'target-id': ins.task.id,
    topic: 'somewhere', text: '云端任务Y', cwd: DIR, _cloud: cloud,
  });
  assert.equal(u.undone, true);
  assert.equal(cloud.state.open[0].text, '云端任务Y');
  assert.equal(cloud.state.open[0].topic, 'somewhere');
  const t = await topicByName('nx-kv-move-test');
  assert.equal(splitQueueTasks(t.tasks).pending.length, 0, '本机那条已移除');
});

test('参数校验：方向相同 / 缺定位参数，报「用法:」式错误且不碰两端', async () => {
  await addTask({ cwd: DIR, text: '任务E' });
  const cloud = fakeCloud();
  await assert.rejects(() => moveTask({ from: 'local', to: 'local', _cloud: cloud }), /--from 与 --to 不能相同/);
  await assert.rejects(() => moveTask({ from: 'local', to: 'cloud', _cloud: cloud }), /--id/);
  await assert.rejects(() => moveTask({ from: 'cloud', to: 'local', _cloud: cloud }), /--text/);
  assert.equal(cloud.state.open.length, 0);
  assert.equal((await topicByName('nx-kv-move-test')).pending, 1);
});

test('重复迁移被拒绝（tombstone 幂等保护）', async () => {
  await addTask({ cwd: DIR, text: '任务F' });
  const cloud = fakeCloud();
  await moveTask({ from: 'local', to: 'cloud', cwd: DIR, id: 1, _cloud: cloud });
  await assert.rejects(
    () => moveTask({ from: 'local', to: 'cloud', cwd: DIR, id: 1, _cloud: cloud }),
    /已迁移/
  );
  assert.equal(cloud.state.open.length, 1, '不会重复写入云端');
});
