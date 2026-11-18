// localtask prune 的 `--missing-dir`（#155）：清理「工作目录已不存在」的主题。
//
// 背景：用户库里有几条 `D:\Temp\tmp.xxxx` / `nx-kv-dbtest-xxx` 主题——11-14 的测试
// 跑在了真实库上（当时夹具还没隔离），临时目录删掉后就成了「面板里看得见、左边树里
// 没有」的幽灵。默认 prune 不碰它们（外接盘没挂载也会命中，不能擅自删），
// 所以做成显式开关，并且**有待领任务的目录一律不清**。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'nx-kv-prune-missing-'));
process.env.NX_KV_HOME = join(root, 'home');
process.env.NX_KV_DB = join(root, 'nxkv.db');
process.env.NX_KV_LOCALTASK_STORE = join(root, 'localtasks.json');
process.env.NX_KV_REPOS_STORE = join(root, 'repos.json');
process.env.NX_KV_DOCS_DIR = join(root, 'docs');
process.env.NX_KV_CONFIG = join(root, 'config.json');

const svc = await import('../../src/modules/localtask/service.js');
const { getTask } = await import('../../src/modules/tasktool/get.js');
const { closeDb } = await import('../../src/core/db/index.js');

after(() => {
  try { closeDb(); } catch { /* 已关 */ }
  try { rmSync(root, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

const ALIVE = join(root, 'alive');
const GONE = join(root, 'gone-temp-dir');
mkdirSync(ALIVE, { recursive: true });

const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
const findTopic = async (cwd) => (await svc.listTasks()).topics.find((t) => norm(t.cwd) === norm(cwd));

test('cwdExists：目录还在 true / 已被删 false', async () => {
  await svc.addTask({ cwd: ALIVE, text: '活着' });
  await svc.addTask({ cwd: GONE, text: '幽灵' });
  assert.equal((await findTopic(ALIVE)).cwdExists, true);
  assert.equal((await findTopic(GONE)).cwdExists, false, '目录不存在 → false');
});

test('有待领任务的幽灵目录：默认与 --missing-dir 都不清（保护还没人领的活）', async () => {
  const gone = await findTopic(GONE);
  assert.ok(gone.tasks.some((t) => t.status === 'pending'), '前提：它还有待领取任务');

  for (const opts of [{ dryRun: true }, { missingDir: true, dryRun: true }]) {
    const d = await svc.pruneTopics(opts);
    assert.equal(d.removed.some((r) => r.key === gone.key), false, JSON.stringify(opts));
  }
  assert.ok(await findTopic(GONE), '主题原样保留');
});

test('任务领走并完成后：默认不清，--missing-dir 才报告「目录已不存在」', async () => {
  const gone = await findTopic(GONE);
  assert.ok(gone && gone.tasks.length > 0, '前置：幽灵目录里有一任务');
  // 真正领走（tasktool.get）→ 标记完成：不再 pending，但任务仍在，
  // 所以不会被「空主题」命中，只有 --missing-dir 能认出来
  const got = await getTask({ cwd: GONE, instant: true, open: false });
  assert.ok(got && got.task, '领到了幽灵目录里的任务');
  await svc.completeTask({ cwd: GONE, id: got.task.id, summary: '测试' });

  const plain = await svc.pruneTopics({ dryRun: true });
  assert.equal(plain.removed.some((r) => r.reason === '目录已不存在'), false, '默认不碰');

  const withFlag = await svc.pruneTopics({ missingDir: true, dryRun: true });
  assert.ok(
    withFlag.removed.some((r) => r.reason === '目录已不存在' && norm(r.cwd) === norm(GONE)),
    '开了 --missing-dir 才报告它',
  );
});

test('真正执行：幽灵主题被清，活着的主题与目录都不受影响', async () => {
  const d = await svc.pruneTopics({ missingDir: true });
  assert.ok(d.count >= 1);
  assert.equal(await findTopic(GONE), undefined, '幽灵主题已清');
  assert.ok(existsSync(ALIVE), '真实目录不受影响');
  assert.ok(await findTopic(ALIVE), '活着的主题保留');
});
