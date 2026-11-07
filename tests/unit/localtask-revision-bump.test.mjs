// 外部写必须顶 workflowRevision（CI 偶发搬家事故的回归防线，任务：修「过期引擎快照洗 blockBy」）。
//
// 事故链：引擎侧落盘有 revision CAS，但外部任务行写（设 blockBy / 领取 / 完成）不动
// revision → 引擎在途的过期快照落盘时 CAS 照过 → applySnapshotToTopic 把过期边重建回
// 全队列 blockBy → 刚设好的「队列内依赖」被洗空 → 搬家守卫放行 → 断言挂。
// 防线一：外部写落盘前 bumpWorkflowRevision（本文件）；防线二：投影改并集（workflow-project.test.mjs）。
//
// 存储一律指向临时文件（含 NX_KV_WORKFLOW_STORE——dag sync 否则会写进真实 ~/.nx-kv/workflows）。
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const sb = mkdtempSync(join(tmpdir(), 'nx-kv-revbump-'));
process.env.NX_KV_REPOS_STORE = join(sb, 'repos.json');
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
process.env.NX_KV_DOCS_DIR = join(sb, 'docs');
process.env.NX_KV_WORKFLOW_STORE = join(sb, 'workflows');

const svc = await import('../../src/modules/localtask/service.js');

const dirA = join(sb, 'proj-a');
const revisionOf = async () => {
  const store = await svc.loadStore();
  const t = Object.values(store.topics).find((x) => x.tasks.some((y) => !y.deletedAt));
  return Number(t && t.workflowRevision) || 0;
};

test('外部写逐次顶 workflowRevision（引擎过期快照的 CAS 依据）', async () => {
  const r = await svc.addTask({ cwd: dirA, text: '# 一号\nx' });
  const afterAdd = await revisionOf();
  assert.ok(afterAdd >= 1, `addTask 后 revision 必须 ≥1（实际 ${afterAdd}）`);

  await svc.updateTask({ cwd: dirA, id: r.task.id, text: `${r.task.text}\n补充` });
  const afterUpdate = await revisionOf();
  assert.ok(afterUpdate > afterAdd, `updateTask 后 revision 必须上涨（${afterAdd} → ${afterUpdate}）`);

  await svc.updateTask({ cwd: dirA, id: r.task.id, blockBy: [] });
  const afterDag = await revisionOf();
  assert.ok(afterDag > afterUpdate, `改依赖后 revision 必须上涨（${afterUpdate} → ${afterDag}）`);

  await svc.consumeFirstPending(svc.normalizeCwd(dirA).key, '领取');
  const afterClaim = await revisionOf();
  assert.ok(afterClaim > afterDag, `领取后 revision 必须上涨（${afterDag} → ${afterClaim}）`);

  await svc.reopenTask({ cwd: dirA, id: r.task.id });
  const afterReopen = await revisionOf();
  assert.ok(afterReopen > afterClaim, `reopen 后 revision 必须上涨（${afterClaim} → ${afterReopen}）`);
});

test('过期快照落盘被 CAS 拦下，外部 blockBy 存活（端到端）', async () => {
  const { topicToSnapshot, applySnapshotToTopic } = await import('../../src/core/workflow/project.js');
  const { createTopicAdapter } = await import('../../src/modules/localtask/store/topic-adapter.js');
  const { createSnapshotStore } = await import('../../src/modules/localtask/store/index.js');

  const dirB = join(sb, 'proj-b');
  const bKey = svc.normalizeCwd(dirB).key;
  await svc.addTask({ cwd: dirB, text: '# 依赖源\nx' });
  const r = await svc.addTask({ cwd: dirB, text: '# 带依赖\nx' });

  // T0：引擎拍快照（此刻 #2 还没有依赖）
  const before = await svc.loadStore();
  const snapAtT0 = topicToSnapshot(before.topics[bKey]);
  assert.equal(snapAtT0.edges.length, 0);

  // T1：外部写设 blockBy（updateTask 会顺带 dag sync，但边以任务行为准已被写进）
  await svc.updateTask({ cwd: dirB, id: r.task.id, blockBy: [r.task.id - 1] });
  const mid = await svc.loadStore();
  const revAtT1 = Number(mid.topics[bKey].workflowRevision) || 0;
  assert.ok(revAtT1 > snapAtT0.revision, '外部写必须顶 revision');
  assert.deepEqual(
    mid.topics[bKey].tasks.find((t) => t.id === r.task.id).blockBy,
    [r.task.id - 1],
    '外部依赖已落盘',
  );

  // T2：过期快照走 DB 版 topic-adapter 落盘（同一接口面；CAS 在 BEGIN IMMEDIATE 里
  // 比较 topics.version —— 比旧「先读后写」更严：过期快照连写盘机会都没有）
  const adapter = createTopicAdapter();
  const store = createSnapshotStore({ adapter });
  const staleSnap = { ...snapAtT0, revision: snapAtT0.revision };
  await assert.rejects(
    () => store.saveAtomic(staleSnap, { expectedRevision: snapAtT0.revision }),
    (err) => err.code === 'CAS_CONFLICT',
    '过期快照必须被 CAS 拦下，不得落盘',
  );

  // 即便有人绕过 CAS 直接投影（防线二），并集也保住外部依赖
  const fresh = await svc.loadStore();
  applySnapshotToTopic(fresh.topics[bKey], staleSnap);
  assert.deepEqual(
    fresh.topics[bKey].tasks.find((t) => t.id === r.task.id).blockBy,
    [r.task.id - 1],
    '并集投影不洗外部依赖',
  );
});

test('清理', () => {
  try { svc.closeDb(); } catch { /* ignore */ }
  rmSync(sb, { recursive: true, force: true });
});
