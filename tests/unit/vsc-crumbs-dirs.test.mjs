// 面包屑子目录后端守卫（#276/#279）：repo.dirs 的路径守卫纯函数。
// （#279 验收修正：本地路径单独显示、不融进面包屑——路径分段函数已随方案撤除。）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 隔离（check-test-isolation）：本文件 import 了 repos 服务（它会去读 store），
// 所以先把本机库指到临时目录——必须在 import 之前设好，故用动态 import。
process.env.NX_KV_HOME = mkdtempSync(join(tmpdir(), 'nxkv-crumbs-dirs-'));
process.env.NX_KV_DB = join(process.env.NX_KV_HOME, 'nxkv.db');

const { isInsideRoots, normPath } = await import('../../src/modules/repos/service/dirs.js');

test('目录守卫：只许落在已登记仓库内', () => {
  const roots = ['D:\\DevProjects\\my\\github\\nx-kv'];
  assert.equal(isInsideRoots('D:\\DevProjects\\my\\github\\nx-kv\\src', roots), true);
  assert.equal(isInsideRoots('D:\\DevProjects\\my\\github\\nx-kv', roots), true);
  assert.equal(isInsideRoots('D:\\DevProjects\\my\\github\\other', roots), false);
  assert.equal(isInsideRoots('D:\\Windows', roots), false);
  assert.equal(isInsideRoots('D:\\DevProjects\\my\\github\\nx-kv-evil', roots), false, '前缀相似不算在仓库内');
  assert.equal(isInsideRoots('D:\\x', []), false, '没有登记仓库时一律拒绝');
});

test('目录守卫：路径归一（去尾分隔符、Windows 大小写不敏感）', () => {
  const a = normPath('D:\\Foo\\Bar\\');
  const b = normPath('D:\\foo\\bar');
  assert.equal(a, process.platform === 'win32' ? b : a);
  assert.equal(normPath('D:\\Foo\\Bar\\').endsWith('\\'), false);
});
