// 文档路径权威（modules/docs/paths.js + docref.js）的单元测试：
// 段级 slug 的 Windows 兜底、约定路径派生、自有 rel 守卫、DocRef/docId 形状。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  docSeg,
  boardSeg,
  repoDocRel,
  boardDocRel,
  groupNoteRel,
  assertOwnedRel,
  assertDocRef,
  sanitizeDocRef,
  parseDocId,
  ownDocId,
  extDocId,
} from '../../src/modules/docs/paths.js';
import { mdfileDirFromEnv } from '../../src/core/paths.js';

test('mdfileDirFromEnv：默认 ~/.nx-kv/docs，env 可覆盖（测试隔离的依据）', () => {
  const prev = process.env.NX_KV_DOCS_DIR;
  try {
    delete process.env.NX_KV_DOCS_DIR;
    assert.ok(mdfileDirFromEnv().endsWith(join('.nx-kv', 'docs')));
    process.env.NX_KV_DOCS_DIR = join(tmpdir(), 'nx-kv-docs-x');
    assert.equal(mdfileDirFromEnv(), join(tmpdir(), 'nx-kv-docs-x'));
  } finally {
    if (prev === undefined) delete process.env.NX_KV_DOCS_DIR;
    else process.env.NX_KV_DOCS_DIR = prev;
  }
});

test('docSeg：小写、压非法字符、尾点与保留名兜底', () => {
  assert.equal(docSeg('GitHub.COM'), 'github.com');
  assert.equal(docSeg('我的 仓库'), '我的-仓库');
  assert.equal(docSeg('name.'), 'name'); // 尾点段 Windows 拒绝创建
  assert.equal(docSeg('con'), 'con_'); // 保留设备名
  assert.equal(docSeg('NUL'), 'nul_'); // 不分大小写
  assert.equal(docSeg('...'), 'x'); // 全是点 → 空段占位
});

test('boardSeg 与 boardKeyOf 的 slug 同源（/ 已压成 -）', () => {
  assert.equal(boardSeg('nx系列'), 'nx系列');
  assert.equal(boardSeg('fr 常用 组'), 'fr-常用-组');
  assert.equal(boardSeg(''), 'repo', '空名走 localKeyOf 的兜底 repo');
});

test('约定路径：key 的 / 分段即目录层级，天然无碰撞', () => {
  assert.equal(repoDocRel('github.com/me/x'), 'repo/github.com/me/x.md');
  assert.equal(repoDocRel('local/alpha'), 'repo/local/alpha.md');
  assert.equal(boardDocRel('nx系列'), 'board/nx系列.md');
  assert.equal(groupNoteRel('nx系列', 'github.com/me/x'), 'group/nx系列/github.com/me/x.md');
  // 不同 key 不可能派生出同一路径（key 唯一 + 分段映射单射）
  assert.notEqual(repoDocRel('a/b/c'), repoDocRel('a/b-c'));
});

test('assertOwnedRel：拒绝绝对路径与 ..，必须 .md，返回归一化 POSIX', () => {
  assert.equal(assertOwnedRel('repo\\a\\b.md'), 'repo/a/b.md');
  assert.equal(assertOwnedRel('./notes/x.md'), 'notes/x.md');
  assert.throws(() => assertOwnedRel('D:\\x.md'), /相对路径/);
  assert.throws(() => assertOwnedRel('a/../b.md'), /\.\./);
  assert.throws(() => assertOwnedRel('notes/x.txt'), /\.md/);
  assert.throws(() => assertOwnedRel(''), /不能为空/);
});

test('assertDocRef / sanitizeDocRef：rel 与 path 二选一，非法形状丢弃', () => {
  assert.deepEqual(assertDocRef({ rel: 'repo/a.md' }), { rel: 'repo/a.md' });
  assert.deepEqual(assertDocRef({ path: 'D:/vault/x.md' }), { path: 'D:/vault/x.md' });
  assert.throws(() => assertDocRef({ rel: 'repo/a.md', path: 'D:/x' }), /二选一/);
  assert.throws(() => assertDocRef({}), /不能为空/);
  assert.throws(() => assertDocRef('字符串'), /绑定必须是/);
  assert.equal(sanitizeDocRef({ rel: 'bad' }), null, 'rel 非 md → 宽松版返回 null');
  assert.deepEqual(sanitizeDocRef(undefined), null);
});

test('docId：自有裸路径视为 rel:，外部必须 path: 前缀', () => {
  assert.deepEqual(parseDocId('repo/a.md'), { kind: 'own', rel: 'repo/a.md' });
  assert.deepEqual(parseDocId('rel:repo/a.md'), { kind: 'own', rel: 'repo/a.md' });
  assert.deepEqual(parseDocId('path:D:/vault/x.md'), { kind: 'external', path: 'D:/vault/x.md' });
  assert.throws(() => parseDocId('path:'), /不能为空/);
  assert.throws(() => parseDocId(''), /缺少文档标识/);
  assert.equal(ownDocId('repo/a.md'), 'rel:repo/a.md');
  assert.equal(extDocId('D:/vault/x.md'), 'path:D:/vault/x.md');
});
