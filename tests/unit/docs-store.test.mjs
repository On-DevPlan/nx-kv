// 文档存储原语（modules/docs/store.js）的单元测试：
// NX_KV_DOCS_DIR 隔离、原子写、守卫（.. / 绝对路径 / 非 md）、外部绑定闭包与越界拒绝。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as store from '../../src/modules/docs/store.js';
import * as repos from '../../src/modules/repos/service.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-docstore-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

test('写读删 round-trip：返回归一化 rel，子目录自动创建', async () => {
  const rel = await store.writeOwnDoc('group\\nx系列\\github.com\\me\\x.md', '# 标题\n');
  assert.equal(rel, 'group/nx系列/github.com/me/x.md');
  assert.equal(await store.readOwnDoc(rel), '# 标题\n');
  const docs = await store.listOwnDocs();
  assert.deepEqual(
    docs.map((d) => d.rel),
    ['group/nx系列/github.com/me/x.md']
  );
  await store.removeOwnDoc(rel);
  await assert.rejects(() => store.readOwnDoc(rel), /不存在/);
  await assert.rejects(() => store.removeOwnDoc(rel), /不存在/);
});

test('守卫：拒绝 ..、绝对路径、非 .md', async () => {
  await assert.rejects(() => store.writeOwnDoc('a/../b.md', 'x'), /\.\./);
  await assert.rejects(() => store.writeOwnDoc('D:\\evil.md', 'x'), /相对路径/);
  await assert.rejects(() => store.writeOwnDoc('notes.txt', 'x'), /\.md/);
  // 读路径同样过守卫（.. 与绝对路径两类消息都要拦）
  await assert.rejects(() => store.readOwnDoc('../repos.json'), /\.\.|相对路径/);
  await assert.rejects(() => store.readOwnDoc(join(dir, 'x.md')), /相对路径/);
});

test('listOwnDocs 只收 .md，跳过树不存在与非 md 杂物', async () => {
  assert.deepEqual(await store.listOwnDocs(), []); // 树还没建
  await store.writeOwnDoc('a.md', 'a');
  // 非 md 用裸 fs 造（API 守卫本来就不允许 .txt 进树，但盘上可能有历史杂物）
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(join(process.env.NX_KV_DOCS_DIR, 'sub'), { recursive: true });
  writeFileSync(join(process.env.NX_KV_DOCS_DIR, 'sub', 'b.txt'), '不是文档');
  const docs = await store.listOwnDocs();
  assert.deepEqual(docs.map((d) => d.rel), ['a.md']);
});

test('外部绑定闭包：从 store 收集全部 path 绑定，探测存在性', async () => {
  await repos.addRepo({ path: join(dir, 'alpha'), name: 'alpha' });
  const vault = join(dir, 'vault');
  mkdirSync(join(vault, 'docs'), { recursive: true });
  writeFileSync(join(vault, 'root.md'), '# vault');
  writeFileSync(join(vault, 'docs', 'deep.md'), '# deep');
  writeFileSync(join(vault, 'notes.txt'), '不是文档');

  await repos.mutateStore((s) => {
    s.repos[0].doc = { path: join(vault, 'root.md') };
    s.boards.push({
      id: 'b_1',
      name: 'nx系列',
      desc: '',
      createdAt: new Date().toISOString(),
      repoKeys: [],
      docLinks: [{ path: vault, note: 'Obsidian vault' }],
    });
  });

  const s = await repos.loadStore();
  const closure = await store.externalClosure(s);
  assert.equal(closure.length, 2);
  const byPath = new Map(closure.map((c) => [c.path, c]));
  assert.equal(byPath.get(join(vault, 'root.md')).isDir, false);
  assert.equal(byPath.get(vault).isDir, true);

  // 闭包内：精确文件 + 目录前缀；闭包外：一律 null
  assert.ok(store.resolveExternal(join(vault, 'root.md'), closure));
  assert.ok(store.resolveExternal(join(vault, 'docs', 'deep.md'), closure));
  assert.equal(store.resolveExternal(join(dir, 'outside.md'), closure), null);
  assert.equal(store.resolveExternal(vault + '-sibling.md', closure), null, '前缀不能是裸字符串拼接');

  // 枚举：目录绑定展开 .md（限深/限 .md），单文件绑定 = 文件本身
  const files = await store.listExternalDocs(closure);
  const names = files.map((p) => p.replace(/\\/g, '/')).sort();
  assert.deepEqual(names, [join(vault, 'docs', 'deep.md').replace(/\\/g, '/'), join(vault, 'root.md').replace(/\\/g, '/')].sort());
});

test('缺失的外部路径保留在闭包里（exists=false，导入侧标待初始化的依据）', async () => {
  await repos.addRepo({ path: join(dir, 'alpha'), name: 'alpha' });
  await repos.mutateStore((s) => {
    s.repos[0].doc = { path: join(dir, '不存在的vault') };
  });
  const closure = await store.externalClosure(await repos.loadStore());
  assert.equal(closure.length, 1);
  assert.equal(closure[0].exists, false);
});
