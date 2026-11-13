// ref 索引落库：desiredBindings 纯函数 + syncRefIndex 端到端（v8）。
//
// v8 口径：宿主 ext（doc / docLinks / repoDocs）只存 { ref: refId }，是语义权威；
// ref_bindings 是索引层，整表重建（幂等）。没有约定路径 / 文件清单参与。
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addRepo, loadStore, mutateStore } from '../../src/modules/repos/service.js';
import { createBoard, assignRepo } from '../../src/modules/repos/boards.js';
import { addRepoDoc, setDocLink } from '../../src/modules/docs/refs.js';
import { desiredBindings, syncRefIndex } from '../../src/modules/docs/ref-sync.js';
import { ensureDocRef } from '../../src/core/attachmentdb.js';
import { closeDb, getDb } from '../../src/core/db/index.js';

let dir = '';

beforeEach(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-refsync-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DB = join(dir, 'nxkv.db');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

after(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

const rows = (sql, params) => getDb().all(sql, params);
const newRef = (id) => ensureDocRef(getDb(), { ref: id });

const R = {
  repoMain: 'ref_aaaaaaaaaaaaaaaa',
  repoLink: 'ref_bbbbbbbbbbbbbbbb',
  groupMain: 'ref_cccccccccccccccc',
  groupLink: 'ref_dddddddddddddddd',
  groupNote: 'ref_eeeeeeeeeeeeeeee',
  free: 'ref_ffffffffffffffff',
  other: 'ref_1111111111111111',
};

test('desiredBindings：仓库（主篇 + 补充篇）与组（介绍 + 组内描述），位置从 0 起', () => {
  const s = {
    repos: [{
      key: 'github.com/me/x',
      type: 'dev',
      doc: { ref: R.repoMain },
      docLinks: [{ ref: R.repoLink, note: 'A' }],
    }],
    boards: [{
      key: 'board/g',
      name: 'g',
      doc: { ref: R.groupMain },
      docLinks: [{ ref: R.groupLink, tag: 'qa' }],
      repoDocs: { 'github.com/me/x': { ref: R.groupNote, note: '组内说明' } },
    }],
  };
  assert.deepEqual(
    desiredBindings(s).map((b) => [b.type, b.repoKey, b.groupKey, b.refId, b.position, b.note, b.tag]),
    [
      ['repo', 'github.com/me/x', null, R.repoMain, 0, '', ''],
      ['repo', 'github.com/me/x', null, R.repoLink, 1, 'A', ''],
      ['group', 'board/g', null, R.groupMain, 0, '', ''],
      ['group', 'board/g', null, R.groupLink, 1, '', 'qa'],
      ['group_repo', 'github.com/me/x', 'board/g', R.groupNote, 0, '组内说明', ''],
    ]
  );
});

test('desiredBindings：没有 ref 的条目（空 / rel / path 旧形状）一律跳过', () => {
  const s = {
    repos: [{ key: 'github.com/me/x', type: 'dev', doc: { rel: 'repo/x.md' }, docLinks: [{ path: 'D:/vault/a.md' }, {}] }],
    boards: [],
  };
  assert.deepEqual(desiredBindings(s), []);
  assert.deepEqual(desiredBindings({ repos: [{ key: 'github.com/me/x', type: 'dev' }], boards: [] }), []);
});

test('desiredBindings：组内描述只认显式 repoDocs（不再按约定路径推导）', () => {
  const s = {
    repos: [{ key: 'github.com/me/x', type: 'dev' }, { key: 'github.com/me/y', type: 'dev' }],
    boards: [{
      key: 'board/g',
      name: 'g',
      repoKeys: ['github.com/me/x', 'github.com/me/y'],
      repoDocs: { 'github.com/me/x': { ref: R.groupNote } },
    }],
  };
  assert.deepEqual(
    desiredBindings(s).map((b) => [b.type, b.repoKey, b.groupKey, b.refId]),
    [['group_repo', 'github.com/me/x', 'board/g', R.groupNote]]
  );
});

test('syncRefIndex：绑定落库（repo / group / group_repo），无绑定的 ref 回 orphan', async () => {
  for (const id of [R.repoMain, R.groupMain, R.groupNote, R.free]) newRef(id);
  await addRepo({ path: join(dir, 'x'), name: 'x', key: 'github.com/me/x' });
  await createBoard({ name: 'g', desc: '' });
  await assignRepo({ board: 'g', key: 'github.com/me/x' });
  await mutateStore((s) => {
    const r = s.repos.find((x) => x.key === 'github.com/me/x');
    r.doc = { ref: R.repoMain };
    const b = s.boards.find((x) => x.name === 'g');
    b.doc = { ref: R.groupMain };
    b.repoDocs = { 'github.com/me/x': { ref: R.groupNote } };
  });

  const res = await syncRefIndex();
  assert.equal(res.bindings, 3);

  assert.deepEqual(
    rows('SELECT type, repo_key, group_key, ref_id FROM ref_bindings ORDER BY type').map((x) => [
      x.type,
      x.repo_key,
      x.group_key,
      x.ref_id,
    ]),
    [
      ['group', 'board/g', null, R.groupMain],
      ['group_repo', 'github.com/me/x', 'board/g', R.groupNote],
      ['repo', 'github.com/me/x', null, R.repoMain],
    ]
  );
  assert.equal(rows('SELECT state FROM refs WHERE id = :id', { id: R.repoMain })[0].state, '', '绑定命中 → 非孤儿');
  assert.equal(rows('SELECT state FROM refs WHERE id = :id', { id: R.free })[0].state, 'orphan', '没绑定 → orphan');
});

test('addRepoDoc / setDocLink 写完即登记，摘掉即退回只剩仓库绑定', async () => {
  for (const id of [R.repoMain, R.repoLink]) newRef(id);
  await addRepo({ path: join(dir, 'x'), name: 'x', key: 'github.com/me/x' });
  await createBoard({ name: 'g', desc: '' });
  await mutateStore((s) => {
    s.repos.find((x) => x.key === 'github.com/me/x').doc = { ref: R.repoMain };
  });
  await syncRefIndex();

  await addRepoDoc('github.com/me/x', { ref: R.repoLink, note: '接口说明' });
  let hit = rows('SELECT type, position, note, ref_id FROM ref_bindings WHERE ref_id = :id', { id: R.repoLink });
  assert.deepEqual(hit.map((x) => [x.type, Number(x.position), x.note]), [['repo', 1, '接口说明']]);

  await setDocLink({ board: 'g', ref: R.repoLink, note: '组共享' });
  hit = rows('SELECT type, group_key, ref_id FROM ref_bindings WHERE ref_id = :id ORDER BY type', { id: R.repoLink });
  assert.deepEqual(hit.map((x) => [x.type, x.group_key]), [['group', null], ['repo', null]], '同一篇可同时挂在仓库与组上');

  await setDocLink({ board: 'g', remove: 1 });
  assert.equal(rows('SELECT count(*) AS c FROM ref_bindings WHERE ref_id = :id', { id: R.repoLink })[0].c, 1, '组的绑定摘掉后只剩仓库那条');
  assert.equal(rows('SELECT state FROM refs WHERE id = :id', { id: R.repoLink })[0].state, '', '仍挂在仓库上 → 不是 orphan');
});

test('syncRefIndex 幂等：重复跑不叠行，整表重建不残留旧绑定', async () => {
  for (const id of [R.repoMain, R.other]) newRef(id);
  await addRepo({ path: join(dir, 'x'), name: 'x', key: 'github.com/me/x' });
  await mutateStore((s) => {
    s.repos.find((x) => x.key === 'github.com/me/x').doc = { ref: R.repoMain };
  });

  const s = await loadStore();
  const a = await syncRefIndex({ store: s });
  const b = await syncRefIndex({ store: s });
  assert.equal(a.bindings, b.bindings);
  assert.equal(rows('SELECT count(*) AS c FROM ref_bindings')[0].c, 1);

  // 换绑到另一篇 ref → 整表重建后只剩新绑定
  const store2 = structuredClone(s);
  store2.repos[0].doc = { ref: R.other };
  await syncRefIndex({ store: store2 });
  assert.deepEqual(rows('SELECT ref_id FROM ref_bindings').map((x) => x.ref_id), [R.other]);
});
