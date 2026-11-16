// #134 · 绑定描述（组 ↔ 参考仓库 / 开发仓库 ↔ 参考仓库）= 参考仓库上的一篇文档。
//
// 口径（#137 改过定位方式）：
//   · 描述**完全归档**到右侧栏的文档列表（参考仓库的文档集）；
//   · **desc 就在 ref 上**：同一条关系 = 该仓库文档列表里 desc 等于
//     「在组「<组名>」里参考什么」的那一篇 —— 重复写只是改内容，不新增；
//   · 留空 = 清除（删掉那篇文档）。
//   （早先靠 `ref_bindings.tag = link-note:<关系 key>` 定位，那是把「分类标签」
//     这个无效概念当成了定位器；v12 已把 tag 整个删掉。）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as ref from '../../src/modules/repos/ref.js';
import * as refNote from '../../src/modules/repos/ref-note-doc.js';
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

/** 这个参考仓库在文档列表里的全部条目。 */
function docRowsOf(repoKey) {
  return getDb().all(
    `SELECT b.repo_key AS repoKey, b.ref_id AS refId, position FROM ref_bindings b
      WHERE b.type = 'repo' AND b.repo_key = :key ORDER BY b.position`,
    { key: repoKey },
  );
}

test('#134 写描述 → 参考仓库的文档列表里多一篇（desc 写明是哪条关系）', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, board: b.id });
  const refKey = 'github.com/x/r1';

  assert.equal(docRowsOf(refKey).length, 0, '一开始没有文档');

  const out = await refNote.setLinkNote({ id: r.id, board: b.id, note: '这个参考在本组里参考画布交互' });
  assert.ok(out.refId, '返回文档 id');
  assert.equal(out.docId, 'ref:' + out.refId);

  const rows = docRowsOf(refKey);
  assert.equal(rows.length, 1, '文档列表里一篇');
  assert.equal(rows[0].refId, out.refId);

  const doc = await docs.getDoc({ ref: out.refId });
  assert.match(String(doc.body || ''), /参考画布交互/, '正文是描述全文');
  assert.equal(doc.desc, '在组「grp」里参考什么', 'desc 由系统生成：写明是哪条关系');
});

test('#134 重复写 = 改同一篇（desc 是定位键，不新增）', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, board: b.id });
  const refKey = 'github.com/x/r1';

  const first = await refNote.setLinkNote({ id: r.id, board: b.id, note: '第一版' });
  const second = await refNote.setLinkNote({ id: r.id, board: b.id, note: '第二版' });
  assert.equal(second.refId, first.refId, '同一关系 → 同一篇文档');
  assert.equal(docRowsOf(refKey).length, 1, '不新增');
  assert.match(String((await docs.getDoc({ ref: first.refId })).body || ''), /第二版/);
});

test('#134 仓库级与组级各一篇（desc 不同 → 两篇）', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, board: b.id, repo: dev.id });
  const refKey = 'github.com/x/r1';

  const boardNote = await refNote.setLinkNote({ id: r.id, board: b.id, note: '组里参考什么' });
  const repoNote = await refNote.setLinkNote({ id: r.id, repo: dev.id, note: '仓库里参考什么' });
  assert.notEqual(boardNote.refId, repoNote.refId, '两条关系 → 两篇文档');
  assert.equal(docRowsOf(refKey).length, 2);
  assert.equal((await docs.getDoc({ ref: boardNote.refId })).desc, '在组「grp」里参考什么');
  assert.equal((await docs.getDoc({ ref: repoNote.refId })).desc, '在仓库「d1」里参考什么');
});

test('#134 留空 = 清除（删掉那篇描述文档）；未绑定的关系显式报错', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, board: b.id });
  const refKey = 'github.com/x/r1';

  const wrote = await refNote.setLinkNote({ id: r.id, board: b.id, note: '要清掉的一句' });
  assert.equal(docRowsOf(refKey).length, 1);
  assert.ok(wrote.refId, '先写上');

  const cleared = await refNote.setLinkNote({ id: r.id, board: b.id, note: '' });
  assert.equal(cleared.refId, '', '清除后没有文档');
  assert.equal(docRowsOf(refKey).length, 0, '文档列表里没有了');

  const b2 = await boards.createBoard({ name: 'grp2' });
  await assert.rejects(() => refNote.setLinkNote({ id: r.id, board: b2.id, note: 'x' }), /未绑定/);
  const d2 = await repos.addRepo({ path: join(dir, 'd2'), name: 'd2', key: 'local/d2' });
  await assert.rejects(() => refNote.setLinkNote({ id: r.id, repo: d2.id, note: 'x' }), /未直接绑定/);
});
