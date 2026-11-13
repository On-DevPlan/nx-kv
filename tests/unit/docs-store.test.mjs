// 文档存储原语（modules/docs/store.js）的单元测试（v8）。
//
// v8 口径：ref 的地址只有 refs.id；读写删一律收 refId，写前 ref 必须已存在。
// 外部绑定闭包只来自 refs 里 origin='external' 的行（locator 是实际位置）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as store from '../../src/modules/docs/store.js';
import { ensureDocRef } from '../../src/core/attachmentdb.js';
import { getDb, closeDb } from '../../src/core/db/index.js';

let dir = '';

beforeEach(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-docstore-'));
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

const newRef = (id) => ensureDocRef(getDb(), { ref: id });
const posix = (p) => String(p).replace(/\\/g, '/');

test('写读删 round-trip：一律按 refId 寻址，正文只进 ref_bodies', async () => {
  const refId = 'ref_aaaaaaaaaaaaaaaa';
  newRef(refId);
  assert.equal(await store.writeOwnDoc(refId, '# 标题\n'), refId);
  assert.equal(await store.readOwnDoc(refId), '# 标题\n');
  assert.equal(await store.ownDocExists(refId), true);

  const docs = await store.listOwnDocs();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].id, refId);
  assert.equal(docs[0].hasBody, true);
  assert.equal(docs[0].kind, 'normal');
  assert.equal(docs[0].locator, '');

  await store.removeOwnDoc(refId);
  await assert.rejects(() => store.readOwnDoc(refId), /不存在/);
  await assert.rejects(() => store.removeOwnDoc(refId), /不存在/);
});

test('写前 ref 必须存在：未知 refId 报 notFound（不再按路径猜）', async () => {
  const missing = 'ref_bbbbbbbbbbbbbbbb';
  await assert.rejects(() => store.writeOwnDoc(missing, 'x'), /文档不存在/);
  await assert.rejects(() => store.readOwnDoc(missing), /不存在/);
  await assert.rejects(() => store.removeOwnDoc(missing), /不存在/);
});

test('listOwnDocs：默认只给有正文的正常文档；includeEmpty 连空壳/外部一起给', async () => {
  newRef('ref_cccccccccccccccc');
  await store.writeOwnDoc('ref_cccccccccccccccc', '正常文档');
  newRef('ref_dddddddddddddddd'); // 有行无正文 → empty
  ensureDocRef(getDb(), { locator: join(dir, 'vault', 'ext.md') }); // 外部镜像 → external

  const normal = await store.listOwnDocs();
  assert.deepEqual(normal.map((d) => d.id), ['ref_cccccccccccccccc']);

  const all = await store.listOwnDocs({ includeEmpty: true });
  const byId = new Map(all.map((d) => [d.id, d]));
  assert.equal(byId.get('ref_cccccccccccccccc').kind, 'normal');
  assert.equal(byId.get('ref_dddddddddddddddd').kind, 'empty');
  assert.equal(byId.get('ref_dddddddddddddddd').hasBody, false);
  const ext = all.find((d) => d.kind === 'external');
  assert.ok(ext, '外部镜像条目要能列出（includeEmpty）');
  assert.match(ext.locator.replace(/\\/g, '/'), /vault\/ext\.md$/);
});

test('ownDocState：区分 normal / empty / 不存在，并带 desc', async () => {
  newRef('ref_eeeeeeeeeeeeeeee');
  await store.writeOwnDoc('ref_eeeeeeeeeeeeeeee', '# E');
  await store.setOwnDocDesc('ref_eeeeeeeeeeeeeeee', '简介');
  const normal = await store.ownDocState('ref_eeeeeeeeeeeeeeee');
  assert.equal(normal.exists, true);
  assert.equal(normal.hasBody, true);
  assert.equal(normal.kind, 'normal');
  assert.equal(normal.desc, '简介');

  newRef('ref_ffffffffffffffff');
  const empty = await store.ownDocState('ref_ffffffffffffffff');
  assert.equal(empty.exists, true);
  assert.equal(empty.hasBody, false);
  assert.ok(empty.reason.length > 0);

  const gone = await store.ownDocState('ref_0000000000000000');
  assert.equal(gone.exists, false);
});

test('外部绑定闭包：只收 origin=external 的行，探测存在性', async () => {
  const vault = join(dir, 'vault');
  mkdirSync(join(vault, 'docs'), { recursive: true });
  writeFileSync(join(vault, 'root.md'), '# vault');
  writeFileSync(join(vault, 'docs', 'deep.md'), '# deep');
  writeFileSync(join(vault, 'notes.txt'), '不是文档');

  const fileRef = ensureDocRef(getDb(), { locator: join(vault, 'root.md') });
  const dirRef = ensureDocRef(getDb(), { locator: vault });
  const goneRef = ensureDocRef(getDb(), { locator: join(dir, '不存在的目录', 'x.md') });
  assert.ok(fileRef && dirRef && goneRef);
  // 非外部行（自有直接 ref）不进闭包
  newRef('ref_1111111111111111');

  const closure = await store.externalClosure();
  assert.equal(closure.length, 3);
  const byPath = new Map(closure.map((c) => [posix(c.path), c]));
  assert.equal(byPath.get(posix(join(vault, 'root.md'))).isDir, false);
  assert.equal(byPath.get(posix(join(vault, 'root.md'))).exists, true);
  assert.equal(byPath.get(posix(vault)).isDir, true);
  assert.equal(byPath.get(posix(join(dir, '不存在的目录', 'x.md'))).exists, false);

  // 闭包内：精确文件 + 目录前缀；闭包外：一律 null
  assert.ok(store.resolveExternal(join(vault, 'root.md'), closure));
  assert.ok(store.resolveExternal(join(vault, 'docs', 'deep.md'), closure));
  assert.equal(store.resolveExternal(join(dir, 'outside.md'), closure), null);
  assert.equal(store.resolveExternal(vault + '-sibling.md', closure), null, '前缀不能是裸字符串拼接');

  // 枚举：目录绑定展开 .md（限深/限 .md），单文件绑定 = 文件本身
  const files = (await store.listExternalDocs(closure)).map(posix).sort();
  assert.deepEqual(files, [posix(join(vault, 'docs', 'deep.md')), posix(join(vault, 'root.md'))].sort());
});

test('缺失的外部路径保留在闭包里（exists=false，导入侧标待初始化的依据）', async () => {
  ensureDocRef(getDb(), { locator: join(dir, '不存在的vault') });
  const closure = await store.externalClosure();
  assert.equal(closure.length, 1);
  assert.equal(closure[0].exists, false);
});
