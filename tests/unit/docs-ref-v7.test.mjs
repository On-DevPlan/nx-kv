// v7 直接 ref：desc + 归属（refs + ref_bodies + ref_bindings）。
//
// 口径（任务 #97）：ref 是 DB 实体，没有路径 / 文件名 / 扩展名；新建只给
// desc 与宿主，正文为空、可立即编辑；归属直接写 ref_bindings，整表重建不丢。
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, getDb } from '../../src/core/db/index.js';
import { addRepo } from '../../src/modules/repos/service.js';
import { createBoard, assignRepo } from '../../src/modules/repos/boards.js';
import { createRef, getDoc, unbindRef, updateDoc } from '../../src/modules/docs/service.js';
import { syncRefIndex } from '../../src/modules/docs/ref-sync.js';
import { boardKeyOf } from '../../src/modules/repos/service/identity.js';

let dir = '';

beforeEach(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-refv7-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

after(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

const one = (sql, params) => getDb().get(sql, params);
const all = (sql, params) => getDb().all(sql, params);

test('v7：refs 有 desc 列且默认空串', () => {
  const cols = all('SELECT name, dflt_value, "notnull" AS nn FROM pragma_table_info(\'refs\')');
  const desc = cols.find((c) => c.name === 'desc');
  assert.ok(desc, 'refs.desc 必须存在');
  assert.equal(Number(desc.nn), 1);
  assert.equal(String(desc.dflt_value), "''");
});

test('createRef(repo)：rel=id、locator 为空、空正文落行、归属落 ref_bindings', async () => {
  await addRepo({ path: join(dir, 'r1'), name: 'r1', key: 'github.com/me/r1' });
  const r = await createRef({ owner: 'repo', repo: 'github.com/me/r1', desc: '需求说明' });
  assert.match(r.refId, /^ref_[0-9a-f]{16}$/);

  const row = one('SELECT id, rel, locator, origin, state, "desc" FROM refs WHERE id = :id', { id: r.refId });
  assert.equal(row.rel, row.id, 'rel 只作内部唯一键，等于 id');
  assert.equal(row.locator, '', '不写任何路径');
  assert.equal(row.origin, 'own');
  assert.equal(row.state, '', '有归属 → 不是 orphan');
  assert.equal(row.desc, '需求说明');

  const body = one('SELECT body, body_bytes FROM ref_bodies WHERE ref_id = :id', { id: r.refId });
  assert.equal(body.body, '', '空正文也落行（新建的是可编辑文档，不是空壳）');
  assert.equal(Number(body.body_bytes), 0);

  const bind = all('SELECT type, repo_key, group_key, position FROM ref_bindings WHERE ref_id = :id', { id: r.refId });
  assert.deepEqual(bind.map((b) => [b.type, b.repo_key, b.group_key, Number(b.position)]), [
    ['repo', 'github.com/me/r1', null, 0],
  ]);

  // getDoc 按 refId 寻址：ref 自带 desc + 归属
  const got = await getDoc({ ref: 'ref:' + r.refId });
  assert.equal(got.refId, r.refId);
  assert.equal(got.desc, '需求说明');
  assert.equal(got.body, '');
  assert.deepEqual(got.bindings?.map((b) => b.type), ['repo']);

  // 只改描述：不碰正文
  await updateDoc({ ref: 'ref:' + r.refId, desc: '改过的描述' });
  assert.equal(one('SELECT "desc" FROM refs WHERE id = :id', { id: r.refId }).desc, '改过的描述');
  assert.equal(one('SELECT body FROM ref_bodies WHERE ref_id = :id', { id: r.refId }).body, '');
});

test('createRef(group_repo)：组下的仓库归属落 group_repo + group_key', async () => {
  await addRepo({ path: join(dir, 'r2'), name: 'r2', key: 'github.com/me/r2' });
  const b = await createBoard({ name: 'nx组', desc: '' });
  await assignRepo({ key: 'github.com/me/r2', board: b.id });

  const r = await createRef({ owner: 'group_repo', repo: 'github.com/me/r2', group: b.name, desc: '组内文档' });
  const bind = all('SELECT type, repo_key, group_key, position FROM ref_bindings WHERE ref_id = :id', { id: r.refId });
  assert.deepEqual(bind.map((x) => [x.type, x.repo_key, x.group_key, Number(x.position)]), [
    ['group_repo', 'github.com/me/r2', boardKeyOf('nx组'), 0],
  ]);
});

test('syncRefIndex 不抹掉直接绑定；unbind 后回 orphan（文档与正文都保留）', async () => {
  await addRepo({ path: join(dir, 'r3'), name: 'r3', key: 'github.com/me/r3' });
  const r = await createRef({ owner: 'repo', repo: 'github.com/me/r3', desc: '别弄丢' });

  await syncRefIndex();
  assert.equal(
    one('SELECT count(*) AS c FROM ref_bindings WHERE ref_id = :id', { id: r.refId }).c,
    1,
    '整表重建必须保留直接 ref 的归属'
  );

  const un = await unbindRef({ ref: r.refId, type: 'repo', repo: 'github.com/me/r3' });
  assert.equal(un.removed, 1);
  assert.equal(un.orphan, true);
  assert.equal(one('SELECT count(*) AS c FROM ref_bindings WHERE ref_id = :id', { id: r.refId }).c, 0);
  assert.equal(one('SELECT state FROM refs WHERE id = :id', { id: r.refId }).state, 'orphan');
  assert.equal(one('SELECT count(*) AS c FROM refs WHERE id = :id', { id: r.refId }).c, 1, 'ref 行不删');
  assert.equal(one('SELECT count(*) AS c FROM ref_bodies WHERE ref_id = :id', { id: r.refId }).c, 1, '正文不删');
});
