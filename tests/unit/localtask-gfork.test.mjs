// fork/clone 保留组归属（#281）：组页新增的任务（boardMark/groupTopicId）被 fork /
// clone 后，新任务必须带上同样的组归属——否则组页视图按 boardMark 过滤后看不到
// 新任务，用户点 Fork/克隆「显示已生成、实际无响应」。
//
// 存储一律指向临时文件（NX_KV_* 前缀），绝不写脏用户目录。
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const sb = mkdtempSync(join(tmpdir(), 'nx-kv-gfork-'));
process.env.NX_KV_REPOS_STORE = join(sb, 'repos.json');
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
process.env.NX_KV_DOCS_DIR = join(sb, 'docs');
process.env.NX_KV_WORKFLOW_STORE = join(sb, 'workflows');

const repos = await import('../../src/modules/repos/service.js');
const boards = await import('../../src/modules/repos/boards.js');
const svc = await import('../../src/modules/localtask/service.js');
const { submitTask } = await import('../../src/modules/localtask/lifecycle/add.js');

const dirA = join(sb, 'proj-a');
mkdirSync(dirA, { recursive: true });
const repoA = await repos.addRepo({
  path: dirA, name: 'proj-a', desc: 'A 项目', remote: 'https://github.com/me/proja',
});
const board = await boards.createBoard({ name: '派生组', desc: 'fork/clone 组归属测试组' });
await boards.assignRepo({ key: repoA.key, board: board.id });

// 组页新增口径的任务（--board/--project → 带 boardMark/groupTopicId）
const g = await submitTask({ text: '# 组任务\n派生源头', board: board.id, project: repoA.key });
const cwd = g.cwd;
const srcShown = await svc.getTask({ cwd, id: g.task.id });
const srcMark = srcShown.boardMark;
const srcGid = srcShown.groupTopicId;
assert.ok(srcMark, '前置：组页口径的任务应带 boardMark');
assert.ok(srcGid, '前置：组页口径的任务应带 groupTopicId');

test('fork 组任务 → 新任务保留 boardMark/groupTopicId（在组范围可见）', async () => {
  const r = await svc.forkTask({ cwd, id: g.task.id });
  const fid = r.task?.id ?? r.id;
  const shown = await svc.getTask({ cwd, id: fid });
  assert.equal(shown.boardMark, srcMark, 'fork 新任务应继承源任务的组标注');
  assert.equal(Number(shown.groupTopicId), Number(srcGid), 'fork 新任务应继承 groupTopicId');
});

test('clone 组任务 → 新任务同样保留组归属', async () => {
  const r = await svc.cloneTask({ cwd, id: g.task.id });
  const cid = r.task?.id ?? r.id;
  const shown = await svc.getTask({ cwd, id: cid });
  assert.equal(shown.boardMark, srcMark, 'clone 新任务应继承源任务的组标注');
  assert.equal(Number(shown.groupTopicId), Number(srcGid), 'clone 新任务应继承 groupTopicId');
});

test('纯仓库任务（无组归属）fork → 不凭空造组归属', async () => {
  const plain = await submitTask({ text: '# 纯仓库任务\n无组', project: repoA.key });
  const rf = await svc.forkTask({ cwd, id: plain.task.id });
  const shownF = await svc.getTask({ cwd, id: rf.task?.id ?? rf.id });
  assert.equal(shownF.boardMark || '', '', '无组来源不应造出组标注');
  assert.equal(shownF.groupTopicId ?? null, null, '无组来源不应造出 groupTopicId');
});

test('清理（尽力而为：Windows 上 SQLite 句柄未放时允许残留临时目录）', () => {
  try {
    rmSync(sb, { recursive: true, force: true });
  } catch {
    // 句柄未放时的 EBUSY 不算失败——临时目录由系统回收
  }
});
