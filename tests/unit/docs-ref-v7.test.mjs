// 直接 ref：desc + 归属（refs + ref_bodies + ref_bindings）。
//
// 口径（v8）：ref 是 DB 实体，地址只有 id；没有 rel / 路径 / 文件名 / 扩展名。
// 新建只给 desc 与宿主，正文为空、可立即编辑；归属同时写宿主 ext 与 ref_bindings。
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

test('v8：refs 有 desc 列且没有 rel 列', () => {
  const cols = all('SELECT name, dflt_value, "notnull" AS nn FROM pragma_table_info(\'refs\')');
  const desc = cols.find((c) => c.name === 'desc');
  assert.ok(desc, 'refs.desc 必须存在');
  assert.equal(Number(desc.nn), 1);
  assert.equal(String(desc.dflt_value), "''");
  assert.ok(!cols.some((c) => c.name === 'rel'), 'v8 起 refs 不再有 rel');
});

test('createRef(repo)：地址就是 id、locator 为空、空正文落行、归属落 ref_bindings', async () => {
  await addRepo({ path: join(dir, 'r1'), name: 'r1', key: 'github.com/me/r1' });
  const r = await createRef({ owner: 'repo', repo: 'github.com/me/r1', desc: '需求说明' });
  assert.match(r.refId, /^ref_[0-9a-f]{16}$/);

  const row = one('SELECT id, locator, origin, state, "desc" FROM refs WHERE id = :id', { id: r.refId });
  assert.equal(row.id, r.refId, 'ref 的地址只有 id');
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

// #105：组视图的文档集 = 组本身 → 组内各仓库的组内文档 → 组内仓库自己的文档。
// 口径来自「组的主题只认 repo / group，不认组下的 repo」——切到组时把整个组域的知识
// 按重要度排出来；非成员仓库的文档不得混进来。
test('#105 docs.bindings --group：组本身 → 组内仓库文档 → 仓库自己的文档（非成员不混入）', async () => {
  await addRepo({ path: join(dir, 'ga'), name: 'ga', key: 'github.com/me/ga' });
  await addRepo({ path: join(dir, 'gb'), name: 'gb', key: 'github.com/me/gb' });
  const board = await createBoard({ name: 'team-x' }, { seedDoc: false });
  await assignRepo({ key: 'github.com/me/ga', board: board.key });
  await assignRepo({ key: 'github.com/me/gb', board: board.key });

  await createRef({ owner: 'group', group: board.key, desc: '组级文档' });
  await createRef({ owner: 'group_repo', repo: 'github.com/me/ga', group: board.key, desc: 'ga 组内文档' });
  await createRef({ owner: 'repo', repo: 'github.com/me/ga', desc: 'ga 自己的文档' });
  // 非成员仓库：自己的文档不该出现在这个组的列表里
  await addRepo({ path: join(dir, 'gc'), name: 'gc', key: 'github.com/me/gc' });
  await createRef({ owner: 'repo', repo: 'github.com/me/gc', desc: 'gc 无关文档' });

  const { ACTIONS } = await import('../../src/runtime/registry.js');
  const act = ACTIONS.find((a) => a.id === 'docs.bindings');
  assert.ok(act, 'docs.bindings 已注册');

  const out = await act.run({ group: board.key }, { transport: 'http' });
  const descs = out.bindings.map((b) => b.desc);
  assert.deepEqual(descs, ['组级文档', 'ga 组内文档', 'ga 自己的文档'], '组 → 组内仓库 → 仓库自己');
  assert.deepEqual(out.bindings.map((b) => b.type), ['group', 'group_repo', 'repo']);

  // #116：repo 级视图只给这个仓库**自己的**文档——组级文档与组内仓库文档
  // 属于组域，混进仓库列表只会让人以为「这个仓库有两篇，其实一篇是组里的」。
  const one2 = await act.run({ host: 'github.com/me/ga' }, { transport: 'http' });
  assert.deepEqual(one2.bindings.map((b) => b.desc), ['ga 自己的文档']);
  assert.deepEqual(one2.bindings.map((b) => b.type), ['repo']);
  assert.ok(!one2.bindings.some((b) => b.desc === 'ga 组内文档' || b.desc === '组级文档' || b.desc === 'gc 无关文档'));
});

// #114：GC 没有正文的 ref——默认只报数（dry-run），apply 才删；有正文的必须留下。
// 口径：空文档没有展示价值，列表里也不再有「无正文」这种兼容态。
test('#114 docs gc：空正文 ref 默认只报数，apply 才删，有正文的不动', async () => {
  await addRepo({ path: join(dir, 'gd'), name: 'gd', key: 'github.com/me/gd' });
  const empty = await createRef({ owner: 'repo', repo: 'github.com/me/gd', desc: '空文档' });
  const filled = await createRef({ owner: 'repo', repo: 'github.com/me/gd', desc: '有正文' });
  await updateDoc({ ref: 'ref:' + filled.refId, body: '# 有正文\n\n内容在这里' });

  const { gcEmptyDocs } = await import('../../src/modules/docs/gc.js');
  const dry = await gcEmptyDocs();
  assert.equal(dry.dryRun, true);
  assert.ok(dry.ids.includes(empty.refId), 'dry-run 报出空文档');
  assert.ok(!dry.ids.includes(filled.refId), '有正文的不在名单里');
  assert.equal(one('SELECT count(*) AS c FROM refs WHERE id = :id', { id: empty.refId }).c, 1, 'dry-run 不落盘');

  const done = await gcEmptyDocs({ apply: true });
  assert.equal(done.dryRun, false);
  assert.ok(done.count >= 1);
  assert.equal(one('SELECT count(*) AS c FROM refs WHERE id = :id', { id: empty.refId }).c, 0, '空文档已删');
  assert.equal(one('SELECT count(*) AS c FROM refs WHERE id = :id', { id: filled.refId }).c, 1, '有正文的保留');
});

// #119：组的身份是**冻结 key**，历史组的 key 可能是 `group/<name>`（新算出来是
// `board/<name>`）。createRef 以前只比 id / 派生 key / 名字，拿 `group/nx` 建组文档
// 会直接「组不存在」——web 上点「＋」加组文档就是一串红色报错。
test('#119 createRef 认冻结组 key：group/<name> 能建组文档与组内文档', async () => {
  const legacy = await createBoard({ name: 'legacy-nx', key: 'group/legacy-nx' }, { seedDoc: false });
  await addRepo({ path: join(dir, 'lg'), name: 'lg', key: 'github.com/me/lg' });

  // 组级文档：用冻结 key（历史前缀 group/）
  const g = await createRef({ owner: 'group', group: 'group/legacy-nx', desc: '组介绍' });
  assert.ok(g.refId);
  assert.equal(one('SELECT count(*) AS c FROM ref_bindings WHERE ref_id = :id AND type = :t', { id: g.refId, t: 'group' }).c, 1);

  // 组内文档：同一个冻结 key
  const gr = await createRef({ owner: 'group_repo', repo: 'github.com/me/lg', group: 'group/legacy-nx', desc: '组内描述' });
  assert.equal(one('SELECT group_key AS g FROM ref_bindings WHERE ref_id = :id', { id: gr.refId }).g, 'group/legacy-nx');

  // id / 名字 / 派生 key 仍要能定位（老入口不许退化）
  await createRef({ owner: 'group', group: legacy.id, desc: '按 id' });
  await createRef({ owner: 'group', group: 'legacy-nx', desc: '按名字' });
  const rows = await (await import('../../src/runtime/registry.js')).ACTIONS
    .find((a) => a.id === 'docs.bindings')
    .run({ group: 'group/legacy-nx' }, { transport: 'http' });
  assert.equal(rows.bindings.filter((b) => b.type === 'group').length, 3, '三篇组级文档都落在同一个组上');
});
