// #134 · 绑定描述（组 ↔ 参考仓库 / 开发仓库 ↔ 参考仓库）= 参考仓库上的一篇文档。
//
// 口径：
//   · 描述**完全归档**到右侧栏的文档列表（参考仓库的文档集），定位靠
//     ref_bindings.tag = `link-note:<关系 key>`；
//   · 同一关系恒定对应同一篇文档：重复写只是改内容，不新增；
//   · 留空 = 清除（删掉那篇文档 + 关系边上的导出副本）；
//   · 关系边上的 note 只剩一份**冗余副本**（导出/导入要带走它），真身是文档。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as ref from '../../src/modules/repos/ref.js';
import * as link from '../../src/modules/repos/link-note.js';
import * as docs from '../../src/modules/docs/service.js';
import { getDb } from '../../src/core/db/index.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-linknote-'));
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
  mkdirSync(join(dir, 'docs'), { recursive: true });
});

/** 这个参考仓库在文档列表里的全部条目（ref_bindings）。 */
function docRowsOf(repoKey) {
  return getDb().all(
    `SELECT repo_key AS repoKey, ref_id AS refId, tag, position FROM ref_bindings
      WHERE type = 'repo' AND repo_key = :key ORDER BY position`,
    { key: repoKey },
  );
}

test('#134 写描述 → 参考仓库的文档列表里多一篇（tag 定位，desc 写明是哪条关系）', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, board: b.id });

  const refKey = 'github.com/x/r1';
  assert.equal(docRowsOf(refKey).length, 0, '一开始没有文档');

  const out = await link.setLinkNote({ id: r.id, board: b.id, note: '这个参考在本组里参考画布交互' });
  assert.ok(out.refId, '返回文档 id');
  assert.equal(out.docId, 'ref:' + out.refId);

  const rows = docRowsOf(refKey);
  assert.equal(rows.length, 1, '文档列表里一篇');
  assert.equal(rows[0].refId, out.refId);
  assert.equal(rows[0].tag, 'link-note:' + (await boards.getBoard(b.id)).key, '靠关系 key 定位');

  const doc = await docs.getDoc({ ref: out.refId });
  assert.match(String(doc.body || ''), /参考画布交互/);
  assert.equal(doc.desc, '在组「grp」里参考什么', '短标签写明是哪条关系');
});

test('#134 重复写 = 改同一篇（不新增）；留空 = 清除', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, board: b.id });
  const refKey = 'github.com/x/r1';

  const first = await link.setLinkNote({ id: r.id, board: b.id, note: '第一版' });
  const second = await link.setLinkNote({ id: r.id, board: b.id, note: '第二版' });
  assert.equal(second.refId, first.refId, '同一关系 → 同一篇文档');
  assert.equal(docRowsOf(refKey).length, 1, '不新增');
  assert.match(String((await docs.getDoc({ ref: first.refId })).body || ''), /第二版/);

  const cleared = await link.setLinkNote({ id: r.id, board: b.id, note: '' });
  assert.equal(cleared.refId, '', '清除后没有文档');
  assert.equal(docRowsOf(refKey).length, 0, '文档列表里没有了');
});

test('#134 仓库级与组级各一篇，互不覆盖', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, board: b.id, repo: dev.id });

  const boardNote = await link.setLinkNote({ id: r.id, board: b.id, note: '组里参考什么' });
  const repoNote = await link.setLinkNote({ id: r.id, repo: dev.id, note: '仓库里参考什么' });
  assert.notEqual(boardNote.refId, repoNote.refId, '两条关系 → 两篇文档');
  assert.equal(docRowsOf('github.com/x/r1').length, 2);
  assert.equal((await docs.getDoc({ ref: boardNote.refId })).desc, '在组「grp」里参考什么');
  assert.equal((await docs.getDoc({ ref: repoNote.refId })).desc, '在仓库「d1」里参考什么');
});

test('#134 未绑定的组 / 仓库显式报错（描述不静默挂空）', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b1 = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.id, board: b1.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });

  await assert.rejects(() => link.setLinkNote({ id: r.id, board: b1.id, note: 'x' }), /未绑定/);
  const b2 = await boards.createBoard({ name: 'grp2' });
  await assert.rejects(() => link.setLinkNote({ id: r.id, board: b2.id, note: 'x' }), /未绑定/);
  const d2 = await repos.addRepo({ path: join(dir, 'd2'), name: 'd2', key: 'local/d2' });
  await assert.rejects(() => link.setLinkNote({ id: r.id, repo: d2.id, note: 'x' }), /未直接绑定/);
});
