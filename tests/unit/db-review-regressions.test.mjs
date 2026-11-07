// SQLite 重构 review 的回归测试：把「schema 画了约束、仓储却没落到」的几条路径钉住。
//
// 覆盖：
//   1. 多队列下 task_deps 存全局 tasks.id（blockBy 视图仍是主题内 seq）
//   2. topic 时间戳（SELECT * 蛇形列名 → camelCase 别名的坑）
//   3. 主题软删 + ensureTopic 恢复（保留任务）
//   4. 看板保存不能把组行删掉重建（ref_bindings 的级联删除）
//   5. 旧 timegoal.duration 字符串 → 秒
//   6. 双进程并发 add 不撞 UNIQUE(topic_id, seq)
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'cli.mjs');
const execFileAsync = promisify(execFile);

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-review-'));
process.env.NX_KV_LOCALTASK_STORE = join(tmp, 'store.json');
process.env.NX_KV_REPOS_STORE = join(tmp, 'repos.json');
process.env.NX_KV_DOCS_DIR = join(tmp, 'docs');
process.env.NX_KV_DB = join(tmp, 'nxkv.db');

const localtask = await import('../../src/modules/localtask/service.js');
const repo = await import('../../src/modules/localtask/repo/index.js');
const { legacyDurationSec } = await import('../../src/core/db/import-json.js');
const reposService = await import('../../src/modules/repos/service.js');
const boards = await import('../../src/modules/repos/boards.js');

const A = join(tmp, 'alpha');
const B = join(tmp, 'beta');

beforeEach(async () => {
  localtask.resetLocaltaskStore();
});

after(() => {
  try {
    localtask.closeDb();
  } catch {
    /* 未打开 */
  }
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows 句柄残留 */
  }
});

test('多队列：task_deps 落全局 tasks.id，视图仍按主题内 seq 解析', async () => {
  await localtask.addTask({ cwd: A, text: 'A1' });
  await localtask.addTask({ cwd: A, text: 'A2' }); // 全局 id 1、2
  await localtask.addTask({ cwd: B, text: 'B1' }); // 全局 id 3，局部 seq 1
  await localtask.addTask({ cwd: B, text: 'B2', blockBy: '1' }); // 局部 seq 2

  const conn = repo.db();
  const topicB = conn.get('SELECT id FROM topics WHERE cwd = :c', { c: B });
  const b1 = conn.get('SELECT id, seq FROM tasks WHERE topic_id = :t AND seq = 1', { t: topicB.id });
  const b2 = conn.get('SELECT id FROM tasks WHERE topic_id = :t AND seq = 2', { t: topicB.id });
  assert.ok(b1.id !== b1.seq, '这个场景必须让全局 id ≠ 局部 seq，否则测不到原 bug');

  const dep = conn.get('SELECT dep_id FROM task_deps WHERE task_id = :t', { t: b2.id });
  assert.equal(Number(dep.dep_id), Number(b1.id), '依赖边必须指向全局 id，而不是裸 seq');

  const view = repo.topics.getTopic(localtask.resolveTopicKey({ cwd: B }));
  const b2View = view.tasks.find((x) => Number(x.id) === 2);
  assert.deepEqual(b2View.blockBy, [1], '视图层仍应看到主题内 seq');
});

test('topic 时间戳：createdAt/updatedAt 不是空串（SELECT * 别名坑）', async () => {
  await localtask.addTask({ cwd: A, text: 'A1' });
  const t = repo.topics.getTopic(localtask.resolveTopicKey({ cwd: A }));
  assert.ok(t.createdAt, 'createdAt 必须非空');
  assert.ok(t.updatedAt, 'updatedAt 必须非空');
});

test('软删主题：list 不可见，ensureTopic 同名恢复且旧任务还在', async () => {
  const key = localtask.resolveTopicKey({ cwd: A });
  await localtask.addTask({ cwd: A, text: 'A1' });
  await localtask.removeTopic({ key, force: true });
  assert.equal((await localtask.listTasks()).topics.length, 0, '软删后读路径不可见');

  await localtask.addTask({ cwd: A, text: 'A2' });
  const t = (await localtask.listTasks()).topics.find((x) => x.key === key);
  assert.ok(t, '同名主题必须恢复');
  assert.equal(t.tasks.length, 2, '恢复的是同一行，旧任务不能丢');
});

test('看板保存：组行不删后重建，ref_bindings 不被级联清掉', async () => {
  const r = await reposService.addRepo({ path: A, name: 'alpha', key: 'local/alpha' });
  const b = await boards.createBoard({ name: '前端' });
  await boards.assignRepo({ id: r.id, board: b.id });

  const conn = repo.db();
  const group = conn.get("SELECT key FROM repos WHERE type = 'group' AND deleted_at IS NULL");
  conn.run(
    `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
     VALUES ('ref_review', 'md', 'repo/alpha/index.md', '', 0, NULL, 1, 1)`
  );
  conn.run(
    `INSERT INTO ref_bindings (repo_key, group_key, ref_id, type, position, note, created_at)
     VALUES (:repo, :group, 'ref_review', 'group_repo', 0, '', 1)`,
    { repo: r.key, group: group.key }
  );

  // 任意一次 repos 写都会走 mutateStore → persistStore（旧实现会把组行删掉重建）
  await reposService.addRepo({ path: B, name: 'beta', key: 'local/beta' });

  const binding = conn.get("SELECT * FROM ref_bindings WHERE ref_id = 'ref_review'");
  assert.ok(binding, 'ref_bindings 必须存活');
  assert.equal(binding.group_key, group.key);
  const groupStill = conn.get("SELECT key FROM repos WHERE type = 'group' AND key = :k", { k: group.key });
  assert.ok(groupStill, '组行必须是同一行（软删/不重建），不是删了再插');
});

test('旧 timegoal.duration 字符串解析成秒', () => {
  assert.equal(legacyDurationSec({ duration: '2h' }), 7200);
  assert.equal(legacyDurationSec({ duration: '90m' }), 5400);
  assert.equal(legacyDurationSec({ duration: '30 分钟' }), 1800);
  assert.equal(legacyDurationSec({ durationSec: 1800 }), 1800, '新形状优先');
  assert.equal(legacyDurationSec({}), 0);
});

test('双进程并发 add：编号不撞 UNIQUE(topic_id, seq)', async () => {
  const env = { ...process.env };
  const run = (text) =>
    execFileAsync(process.execPath, [BIN, 'localtask', 'add', text, '--cwd', A, '--json'], {
      env,
      encoding: 'utf8',
    });

  const [r1, r2] = await Promise.all([run('并发一'), run('并发二')]);
  assert.doesNotThrow(() => JSON.parse(r1.stdout));
  assert.doesNotThrow(() => JSON.parse(r2.stdout));
  const out1 = JSON.parse(r1.stdout);
  const out2 = JSON.parse(r2.stdout);
  assert.equal(out1.status, 'ok');
  assert.equal(out2.status, 'ok');

  const conn = repo.db();
  const seqs = conn
    .all('SELECT seq FROM tasks ORDER BY seq')
    .map((x) => Number(x.seq));
  assert.deepEqual(seqs, [1, 2], '两条任务必须拿到不同编号');
});
