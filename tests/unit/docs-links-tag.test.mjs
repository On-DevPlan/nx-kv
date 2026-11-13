// 简介文档 tag：docLinks 条目 = DocRef{ref} + 注解（note/tag）。
//
// tag 是给「补充」链接的分类小 chip（如 qa），要过三道关——写入口合并 /
// loadStore 归一化回贴 / zip 导出导入往返——三处丢一处，面板上就「标签莫名其妙没了」。
// v8：条目只存 refId，不再有 rel / path。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as refs from '../../src/modules/docs/refs.js';
import * as service from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as transfer from '../../src/modules/repos/transfer.js';
import { ensureDocRef } from '../../src/core/attachmentdb.js';
import { readZip } from '../../src/core/zip.js';
import { getDb, closeDb } from '../../src/core/db/index.js';

function unzipExport(buf) {
  let json = '';
  const docsFiles = [];
  for (const e of readZip(buf)) {
    if (e.name === 'layout.json') json = e.data.toString('utf8');
    else if (e.name.startsWith('docs/') && /\.md$/i.test(e.name)) {
      docsFiles.push({ refId: e.name.slice(5).replace(/\.md$/i, ''), data: e.data });
    }
  }
  return { json, docsFiles };
}

let dir = '';

beforeEach(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-linktag-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DB = join(dir, 'nxkv.db');
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

const QA = 'ref_aaaaaaaaaaaaaaaa';
const SPEC = 'ref_bbbbbbbbbbbbbbbb';
const newRef = (id) => ensureDocRef(getDb(), { ref: id });

async function seed() {
  const b = await boards.createBoard({ name: 'nx系列', desc: '' });
  const r = await service.addRepo({
    path: join(dir, 'alpha'),
    name: 'alpha',
    desc: '',
    remote: 'https://github.com/me/alpha',
  });
  newRef(QA);
  newRef(SPEC);
  return { b, r };
}

test('组级 setDocLink：tag 落条目；同 doc 重加 = 更新；空 tag = 清掉且 note 原样保留', async () => {
  const { b } = await seed();
  await refs.setDocLink({ board: b.id, ref: QA, note: '问答集', tag: 'qa' });
  let links = (await refs.setDocLink({ board: b.id, ref: SPEC })).links;
  assert.equal(links.length, 2);
  assert.equal(links.find((x) => x.ref === QA).tag, 'qa');

  // 重加同 doc：不产生第二条，tag/note 以本次为准
  links = (await refs.setDocLink({ board: b.id, ref: QA, note: '问答集', tag: 'qa文档' })).links;
  assert.equal(links.length, 2);
  const qa = links.find((x) => x.ref === QA);
  assert.equal(qa.tag, 'qa文档');
  assert.equal(qa.note, '问答集');

  // 清 tag：tag 传空串，note 不能被顺带抹掉
  links = (await refs.setDocLink({ board: b.id, ref: QA, note: '问答集', tag: '' })).links;
  const cleared = links.find((x) => x.ref === QA);
  assert.equal(cleared.tag, undefined);
  assert.equal(cleared.note, '问答集');
});

test('项目级 addRepoDoc：note/tag 贴回条目；同 ref 重加去重', async () => {
  const { r } = await seed();
  await refs.addRepoDoc(r.key, { ref: QA, note: '问答集', tag: 'qa' });

  const listed = await refs.listRepoDocs(r.key);
  assert.equal(listed.links.length, 1);
  assert.equal(listed.links[0].tag, 'qa');
  assert.equal(listed.links[0].note, '问答集');
  assert.equal(listed.links[0].ref, QA);
  assert.equal(listed.links[0].docId, 'ref:' + QA);

  // 重加同 ref：去重成一条，tag 更新
  const res = await refs.addRepoDoc(r.key, { ref: QA, note: '问答集', tag: 'QA' });
  assert.equal(res.count, 1);
  assert.equal(res.added.tag, 'QA');
  const again = await refs.listRepoDocs(r.key);
  assert.equal(again.links.length, 1);
  assert.equal(again.links[0].tag, 'QA');
});

test('loadStore 归一化：条目上的 tag 回贴，不丢（脏数据护栏对 tag 放行）', async () => {
  const { b } = await seed();
  await refs.setDocLink({ board: b.id, ref: QA, tag: 'qa', note: '问答集' });
  // 绕过写入口直接改条目（模拟手改 / 旧版本数据）
  await service.mutateStore((s) => {
    const bd = s.boards.find((x) => x.id === b.id);
    bd.docLinks[0].tag = '手改标签';
  });

  const loaded = await service.loadStore();
  const entry = loaded.boards.find((x) => x.id === b.id).docLinks[0];
  assert.equal(entry.tag, '手改标签');
  assert.equal(entry.note, '问答集');
  assert.equal(entry.ref, QA);
});

test('zip 导出 → 导入往返：board docLinks 的 tag 跟着条目走', async () => {
  const { b } = await seed();
  await refs.setDocLink({ board: b.id, ref: QA, note: '问答集', tag: 'qa' });

  const { json, docsFiles } = unzipExport(await transfer.repoExportZip({}));
  const layout = JSON.parse(json);
  assert.equal(layout.boards[0].docLinks[0].tag, 'qa');
  assert.equal(layout.boards[0].docLinks[0].ref, QA);

  // 换空环境导入，tag 还原
  await service.mutateStore((s) => {
    s.repos = [];
    s.boards = [];
  });
  await transfer.repoImport({ json, docsFiles, clone: 'none' });
  const bd = (await service.loadStore()).boards.find((x) => x.name === 'nx系列');
  assert.equal(bd.docLinks.length, 1);
  assert.equal(bd.docLinks[0].tag, 'qa');
  assert.equal(bd.docLinks[0].note, '问答集');
  assert.equal(bd.docLinks[0].ref, QA);
});
