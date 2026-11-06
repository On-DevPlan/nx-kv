// 种子与摘要（modules/docs/seed.js）的单元测试：
// 摘要派生（frontmatter description 优先）、回写 desc/repoNotes、惰性与显式种子。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as store from '../../src/modules/docs/store.js';
import * as seed from '../../src/modules/docs/seed.js';
import * as paths from '../../src/modules/docs/paths.js';
import { closeDb } from '../../src/core/db/index.js';  // T05：库化后测试清理要先关连接（Windows rmSync 否则 EBUSY）

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-docseed-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

async function seedData() {
  const r = await repos.addRepo({ path: join(dir, 'alpha'), name: 'alpha', desc: '第一个仓库，管清单' });
  // add 现在会直接把 --desc 播种成主篇；种子测试要的是**老数据**形态
  // （字符串有值、文档还没落盘），所以把刚种下去的主篇删掉。
  await store.removeOwnDoc(paths.repoDocRel(r.key));
  const b = await boards.createBoard({ name: 'nx系列', desc: 'nx 工具链' });
  await boards.assignRepo({ key: r.key, board: b.id });
  await boards.setBoardRepoNote({ key: r.key, board: b.id, note: '组里的任务出入口' });
  // createBoard / setBoardRepoNote 同样会直接落文档，一并清掉才是「老数据」形态
  await store.removeOwnDoc(paths.boardDocRel('nx系列'));
  await store.removeOwnDoc(paths.groupNoteRel('nx系列', r.key));
  return r;
}

test('summaryFromMd：frontmatter description 优先，否则首个正文行，截 120 字', () => {
  assert.equal(seed.summaryFromMd('---\ndescription: 元描述\n---\n\n# 标题\n\n正文在这里'), '元描述');
  assert.equal(seed.summaryFromMd('# 标题\n\n> 引用不算\n\n正文第一行'), '正文第一行');
  assert.equal(seed.summaryFromMd('# 只有标题'), '');
  const long = 'x'.repeat(200);
  assert.equal(seed.summaryFromMd(long).length, 120);
});

test('ownerOfRel / writeBackSummary：保存 md 后 desc / 组内 note 单向回写', async () => {
  const r = await seedData();
  const rel = paths.repoDocRel(r.key);
  assert.equal((await seed.ownerOfRel(rel)).kind, 'repo');
  const noteRel = paths.groupNoteRel('nx系列', r.key);
  assert.equal((await seed.ownerOfRel(noteRel)).kind, 'note');
  // 自由文档没有归属 → 回写返回 null
  assert.equal(await seed.ownerOfRel('notes/free.md'), null);
  assert.equal(await seed.writeBackSummary('notes/free.md', '# 自由'), null);

  await seed.writeBackSummary(rel, '# alpha\n\n改过的介绍');
  assert.equal((await repos.getRepo(r.id)).desc, '改过的介绍');
  await seed.writeBackSummary(noteRel, '# 组内\n\n变成出入口了');
  const bd = (await boards.getBoard('nx系列')).repos[0];
  assert.equal(bd.note, '变成出入口了');
  // 摘要清空 → 组内 note 删除
  await seed.writeBackSummary(noteRel, '# 组内');
  assert.equal((await boards.getBoard('nx系列')).repos[0].note, '');
});

test('seedPlan / seedApply：字符串字段 → 约定路径 md，幂等', async () => {
  const r = await seedData();
  const plan = await seed.seedPlan();
  const rels = plan.items.map((x) => x.rel);
  assert.ok(rels.includes(paths.repoDocRel(r.key)));
  assert.ok(rels.includes(paths.boardDocRel('nx系列')));
  assert.ok(rels.includes(paths.groupNoteRel('nx系列', r.key)));
  assert.equal(plan.count, 3);

  const applied = await seed.seedApply();
  assert.equal(applied.written, 3);
  // 已落盘 → 再次计划为空（幂等）
  assert.equal((await seed.seedPlan()).count, 0);
  // 种子正文带上标题与原字符串
  const body = await store.readOwnDoc(paths.repoDocRel(r.key));
  assert.match(body, /^# alpha\n/);
  assert.match(body, /第一个仓库，管清单/);
});

test('ensureSeedForRel：约定路径缺失且字符串非空才播种；自由路径返回 null', async () => {
  const r = await seedData();
  const rel = paths.repoDocRel(r.key);
  const body = await seed.ensureSeedForRel(rel);
  assert.match(body, /^# alpha/);
  // 第二次：文件已在 → 不再走种子（读原文件由调用方负责；这里验证幂等不抛错）
  assert.match(await seed.ensureSeedForRel(rel), /^# alpha/);
  assert.equal(await seed.ensureSeedForRel('notes/free.md'), null);
});
