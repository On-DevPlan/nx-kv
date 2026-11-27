// 面包屑子目录后端守卫（#276/#279）：repo.dirs 的路径守卫纯函数。
// （#279 验收修正：本地路径单独显示、不融进面包屑——路径分段函数已随方案撤除。）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

// 隔离（check-test-isolation）：本文件 import 了 repos 服务（它会去读 store），
// 所以先把本机库指到临时目录——必须在 import 之前设好，故用动态 import。
process.env.NX_KV_HOME = mkdtempSync(join(tmpdir(), 'nxkv-crumbs-dirs-'));
process.env.NX_KV_DB = join(process.env.NX_KV_HOME, 'nxkv.db');

const { isInsideRoots, normPath } = await import('../../src/modules/repos/service/dirs.js');

test('目录守卫：只许落在已登记仓库内', () => {
  // 用当前平台的绝对路径（Linux CI 下 Windows 盘符不是合法路径，不能写死 D:\）
  const root = resolve('nxkv-guard-root');
  const roots = [root];
  assert.equal(isInsideRoots(join(root, 'src'), roots), true);
  assert.equal(isInsideRoots(root, roots), true);
  assert.equal(isInsideRoots(resolve('nxkv-guard-other'), roots), false);
  assert.equal(isInsideRoots(resolve('nxkv-guard-root-evil'), roots), false, '前缀相似不算在仓库内');
  assert.equal(isInsideRoots(resolve('nxkv-guard-x'), []), false, '没有登记仓库时一律拒绝');
});

test('目录守卫：路径归一（去尾分隔符、Windows 大小写不敏感）', () => {
  const root = resolve('nxkv-norm-test');
  assert.equal(normPath(root + sep), normPath(root), '尾分隔符归一');
  assert.equal(normPath(root).endsWith(sep), false);
  if (process.platform === 'win32') {
    assert.equal(normPath(root.toUpperCase()), normPath(root.toLowerCase()), 'Windows 下大小写不敏感');
  }
});
