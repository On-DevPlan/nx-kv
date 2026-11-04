// 跨项目 blockBy：后继队列 get 须等前驱 completedAt
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sb = mkdtempSync(join(tmpdir(), 'nx-kv-cross-dag-'));
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');

const svc = await import('../../src/modules/localtask/service.js');
const { waitForTask } = await import('../../src/modules/tasktool/wait.js');
const { normalizeCwd } = svc;

const dirA = join(sb, 'proj-a');
const dirB = join(sb, 'proj-b');
mkdirSync(dirA, { recursive: true });
mkdirSync(dirB, { recursive: true });
const keyA = normalizeCwd(dirA).key;
const keyB = normalizeCwd(dirB).key;

test('跨队列依赖挡住后继领取；前驱 done 后可领', async () => {
  const a = await svc.addTask({ cwd: dirA, text: '# 前驱 A\n跨项目上游' });
  const b = await svc.addTask({
    cwd: dirB,
    text: '# 后继 B\n等 A',
    blockBy: [`${keyA}:${a.task.id}`],
  });
  assert.ok(b.task.blockBy.includes(`${keyA}:${a.task.id}`));

  const list1 = await svc.listTasks();
  const rowB1 = list1.topics.find((t) => t.key === keyB).tasks.find((t) => t.id === b.task.id);
  assert.equal(rowB1.ready, false, '前驱未完成时 B.ready=false');

  // instant get：被跨队列依赖挡住 → 立即 timeout
  const blocked = await waitForTask({
    cwd: dirB,
    summary: '试领 B',
    open: false,
    instant: true,
  });
  assert.equal(blocked.status, 'timeout', '跨队列未完成时应领不到 B');

  const claimed = await waitForTask({ cwd: dirA, summary: '领 A', open: false, instant: true });
  assert.equal(claimed.status, 'ok');
  assert.equal(claimed.task.id, a.task.id);
  await svc.completeTask({ cwd: dirA, id: a.task.id, summary: 'A 完成' });

  const list2 = await svc.listTasks();
  const rowB2 = list2.topics.find((t) => t.key === keyB).tasks.find((t) => t.id === b.task.id);
  assert.equal(rowB2.ready, true, 'A done 后 B.ready=true');

  const gotB = await waitForTask({ cwd: dirB, summary: '领 B', open: false, instant: true });
  assert.equal(gotB.status, 'ok');
  assert.equal(gotB.task.id, b.task.id);
});

test.after(() => {
  try {
    rmSync(sb, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
