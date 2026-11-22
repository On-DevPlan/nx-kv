// localtask tasks 的检索能力（#173）：--q 关键字（标题+正文）与 --limit 最新 N 条。
// 回顾 SOP（skill A07）依赖这两把钥匙找「所有轮次的原始意图」；结果每行带时间戳，
// 冲突/重复以最新为准（createdAt 倒序截断）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb } from '../../src/core/db/index.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-tasks-search-'));
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

const CWD = join(tmpdir(), 'nx-kv-tasks-search-proj');

/** 经 action 跑 localtask.tasks（契约即实现——q/limit 在 input 契约里）。 */
async function tasksFor(args) {
  const { container } = await import('../../src/runtime/container.js');
  const { LocaltaskTasksAction } = await import('../../src/modules/localtask/actions/localtask-tasks.js');
  const d = await new LocaltaskTasksAction(container).run({ cwd: CWD, ...args });
  return d;
}

async function seedThree() {
  const svc = await import('../../src/modules/localtask/service.js');
  mkdirSync(CWD, { recursive: true });
  await svc.addTask({ cwd: CWD, text: '# 平滑滚动优化\n\n实现列表的平滑滚动。' });
  await svc.addTask({ cwd: CWD, text: '# 登录页重构\n\n把登录表单改成两步式。' });
  await svc.addTask({ cwd: CWD, text: '# 无关任务\n\n整理文档目录。' });
  return svc;
}

test('--q 关键字：标题与正文都参与匹配（大小写不敏感）', async () => {
  await seedThree();
  const d = await tasksFor({ cwd: CWD, q: '滚动' });
  assert.equal(d.tasks.length, 1);
  assert.match(d.tasks[0].title, /平滑滚动/);
  const d2 = await tasksFor({ cwd: CWD, q: '两步式' });
  assert.equal(d2.tasks.length, 1, '正文措辞也命中（原始意图常埋在正文里）');
  assert.match(d2.tasks[0].title, /登录页/);
});

test('--q 无命中 → 空清单（total 仍为全量）', async () => {
  await seedThree();
  const d = await tasksFor({ cwd: CWD, q: '不存在的关键词' });
  assert.equal(d.tasks.length, 0);
  assert.equal(d.total, 3);
});

test('--limit 取最新 N 条（createdAt 倒序；冲突以最新为准）', async () => {
  await seedThree();
  const d = await tasksFor({ cwd: CWD, limit: 2 });
  assert.equal(d.tasks.length, 2);
  // 时间倒序：第一条的 createdAt >= 第二条
  const [a, b] = d.tasks;
  assert.ok(String(a.createdAt) >= String(b.createdAt), '按时间倒序');
  // 与全量对照：这两条就是全量里最新的两条
  const full = await tasksFor({ cwd: CWD });
  const newestTwo = [...full.tasks]
    .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))
    .slice(0, 2)
    .map((t) => t.id);
  assert.deepEqual(d.tasks.map((t) => t.id), newestTwo);
});

test('--q + --limit 组合：命中集合里取最新 N 条', async () => {
  mkdirSync(CWD, { recursive: true });
  const svc = await import('../../src/modules/localtask/service.js');
  // 三条都带同一关键词
  for (const t of ['# 轮询 A', '# 轮询 B', '# 轮询 C']) {
    await svc.addTask({ cwd: CWD, text: `${t}\n\n用轮询方式处理。` });
  }
  const d = await tasksFor({ cwd: CWD, q: '轮询', limit: 2 });
  assert.equal(d.tasks.length, 2, '命中 3 条只回最新 2 条');
  const full = await tasksFor({ cwd: CWD, q: '轮询' });
  const newestTwo = [...full.tasks]
    .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))
    .slice(0, 2)
    .map((t) => t.id);
  assert.deepEqual(d.tasks.map((t) => t.id), newestTwo);
});

test('每行带时间戳（回顾 SOP 靠它做冲突裁决）', async () => {
  await seedThree();
  const d = await tasksFor({ cwd: CWD, limit: 1 });
  assert.ok(d.tasks[0].createdAt, 'createdAt 在');
  assert.equal(typeof d.tasks[0].roundSummary, 'string', 'roundSummary 在');
});
