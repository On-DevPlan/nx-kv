// #183 ref 索引落库：desiredBindings 纯函数 + syncRefIndex 端到端。
//
// 背景：ext 里的 DocRef（doc / docLinks / repoDocs）是「宿主挂了哪些篇」，
// refs / ref_bindings 是索引层。此前索引层只在 bind-topics 与导入器写过，
// 面板上明明挂着文档、库里却全是 orphan —— 这几条用例把「写入即登记」
// 钉住，避免再退回两份事实。
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeOwnDoc } from '../../src/modules/docs/store.js';
import { addRepo, loadStore } from '../../src/modules/repos/service.js';
import { createBoard, assignRepo } from '../../src/modules/repos/boards.js';
import { addRepoDoc, setDocLink } from '../../src/modules/docs/refs.js';
import { desiredBindings, syncRefIndex } from '../../src/modules/docs/ref-sync.js';
import { closeDb, getDb } from '../../src/core/db/index.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-refsync-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

after(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

const rows = (sql, params) => getDb().all(sql, params);

test('desiredBindings：仓库/组/组内三类宿主，主篇按约定路径回落，位置从 0 起', () => {
  const s = {
    repos: [{ key: 'github.com/me/x', type: 'dev', docLinks: [{ rel: 'notes/a.md', note: 'A' }] }],
    boards: [{
      key: 'board/g',
      name: 'g',
      docLinks: [{ rel: 'notes/b.md' }],
      repoDocs: { 'github.com/me/x': { rel: 'group/g/github.com/me/x.md', note: '组内说明' } },
    }],
  };
  const files = ['repo/github.com/me/x/index.md', 'board/g/index.md'];
  const out = desiredBindings(s, files);
  assert.deepEqual(
    out.map((b) => [b.type, b.repoKey, b.groupKey, b.locator, b.position]),
    [
      ['repo', 'github.com/me/x', null, 'repo/github.com/me/x/index.md', 0],
      ['repo', 'github.com/me/x', null, 'notes/a.md', 1],
      ['group', 'board/g', null, 'board/g/index.md', 0],
      ['group', 'board/g', null, 'notes/b.md', 1],
      ['group_repo', 'github.com/me/x', 'board/g', 'group/g/github.com/me/x.md', 0],
    ]
  );
});

test('desiredBindings：约定路径不在盘上就不绑（目录主篇 → 旧单文件 → 空）', () => {
  const s = { repos: [{ key: 'github.com/me/x', type: 'dev' }], boards: [] };
  assert.deepEqual(desiredBindings(s, []), []);
  assert.deepEqual(
    desiredBindings(s, ['repo/github.com/me/x.md']).map((b) => b.locator),
    ['repo/github.com/me/x.md'],
    '没有目录主篇时回落旧单文件'
  );
  assert.deepEqual(
    desiredBindings({ repos: [{ key: 'github.com/me/x', type: 'dev', doc: { rel: 'custom.md' } }], boards: [] }, []).map((b) => b.locator),
    ['custom.md'],
    '显式 doc 覆盖优先，且不受盘上是否有约定路径限制'
  );
});

test('syncRefIndex：绑定落库（repo / group / group_repo），命中的 ref 不再是 orphan', async () => {
  await writeOwnDoc('repo/github.com/me/x/index.md', '# x\n');
  await writeOwnDoc('board/g/index.md', '# g\n');
  await writeOwnDoc('notes/free.md', '# 自由文档\n');
  await addRepo({ path: join(dir, 'x'), name: 'x', key: 'github.com/me/x' });
  await createBoard({ name: 'g', desc: '' });
  await assignRepo({ board: 'g', key: 'github.com/me/x' });

  const res = await syncRefIndex();
  assert.equal(res.bindings, 2, '仓库主篇 + 组主篇');

  const bindings = rows('SELECT repo_key, group_key, type FROM ref_bindings ORDER BY type');
  assert.deepEqual(bindings.map((b) => [b.type, b.repo_key, b.group_key]), [
    ['group', 'board/g', null],
    ['repo', 'github.com/me/x', null],
  ]);
  const state = rows("SELECT locator, state FROM refs WHERE locator = 'repo/github.com/me/x/index.md'")[0];
  assert.equal(state.state, '', '绑定命中 → state 清空');
  const free = rows("SELECT state FROM refs WHERE locator = 'notes/free.md'")[0];
  assert.equal(free.state, 'orphan', '盘上有但没绑定的文档仍是 orphan（可被孤儿清单列出）');
});

test('addRepoDoc / setDocLink 写完即登记，摘掉即退回 orphan', async () => {
  await writeOwnDoc('repo/github.com/me/x/index.md', '# x\n');
  await writeOwnDoc('notes/a.md', '# A\n');
  await writeOwnDoc('board/g/index.md', '# g\n');
  await addRepo({ path: join(dir, 'x'), name: 'x', key: 'github.com/me/x' });
  await createBoard({ name: 'g', desc: '' });

  await addRepoDoc('github.com/me/x', { rel: 'notes/a.md', note: '接口说明' });
  let hit = rows("SELECT b.type, b.position, b.note FROM ref_bindings b JOIN refs r ON r.id = b.ref_id WHERE r.locator = 'notes/a.md'");
  assert.deepEqual(hit.map((x) => [x.type, x.position, x.note]), [['repo', 1, '接口说明']], '仓库 docLinks 落成 repo 绑定，位置与说明都带上');

  await setDocLink({ board: 'g', doc: 'notes/a.md', note: '组共享' });
  hit = rows("SELECT b.type, b.group_key FROM ref_bindings b JOIN refs r ON r.id = b.ref_id WHERE r.locator = 'notes/a.md' ORDER BY b.type");
  assert.deepEqual(hit.map((x) => [x.type, x.group_key]), [['group', null], ['repo', null]], '同一篇可以同时挂在仓库与组上');

  await setDocLink({ board: 'g', remove: 1 });
  assert.equal(
    rows("SELECT count(*) AS c FROM ref_bindings b JOIN refs r ON r.id = b.ref_id WHERE r.locator = 'notes/a.md'")[0].c,
    1,
    '组的绑定摘掉后只剩仓库那条'
  );
  await addRepoDoc('github.com/me/x', { rel: 'notes/a.md' });
  // 仍挂在仓库上 → 不能因为摘了组的就变 orphan
  assert.equal(rows("SELECT state FROM refs WHERE locator = 'notes/a.md'")[0].state, '');
});

test('syncRefIndex 幂等：重复跑不叠行，整表重建不残留旧绑定', async () => {
  await writeOwnDoc('repo/github.com/me/x/index.md', '# x\n');
  await addRepo({ path: join(dir, 'x'), name: 'x', key: 'github.com/me/x' });
  const s = await loadStore();
  const a = await syncRefIndex({ store: s });
  const b = await syncRefIndex({ store: s });
  assert.equal(a.bindings, b.bindings);
  assert.equal(rows('SELECT count(*) AS c FROM ref_bindings')[0].c, 1);

  // 拆掉显式 doc 覆盖 → 重建后仍回落约定路径，不产生第二行
  const store2 = structuredClone(s);
  store2.repos[0].doc = { rel: 'notes/other.md' };
  await syncRefIndex({ store: store2 });
  assert.deepEqual(
    rows('SELECT r.locator FROM ref_bindings b JOIN refs r ON r.id = b.ref_id').map((x) => x.locator).sort(),
    ['notes/other.md']
  );
});
