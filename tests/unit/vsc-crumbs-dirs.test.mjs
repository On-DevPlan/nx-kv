// 面包屑「完整本地路径 + 选子目录」（#276）：路径分段纯函数 + 后端目录守卫纯函数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 隔离（check-test-isolation）：本文件 import 了 repos 服务（它会去读 store），
// 所以先把本机库指到临时目录——必须在 import 之前设好，故用动态 import。
process.env.NX_KV_HOME = mkdtempSync(join(tmpdir(), 'nxkv-crumbs-dirs-'));
process.env.NX_KV_DB = join(process.env.NX_KV_HOME, 'nxkv.db');

const { pathSegmentsOf } = await import(
  '../../src/web/frontend/components/layout/vsc-crumbs-model.js'
);
const { isInsideRoots, normPath } = await import('../../src/modules/repos/service/dirs.js');

test('pathSegmentsOf：Windows 路径拆成盘符段 + 各级目录', () => {
  const segs = pathSegmentsOf('D:\\DevProjects\\my\\github\\nx-kv');
  assert.deepEqual(
    segs.map((s) => s.label),
    ['D:\\', 'DevProjects', 'my', 'github', 'nx-kv']
  );
  assert.equal(segs[0].path, 'D:\\');
  assert.equal(segs[1].path, 'D:\\DevProjects');
  assert.equal(segs[4].path, 'D:\\DevProjects\\my\\github\\nx-kv');
});

test('pathSegmentsOf：POSIX 路径 / 尾分隔符 / 空串', () => {
  assert.deepEqual(pathSegmentsOf('/home/joke/code').map((s) => s.label), ['home', 'joke', 'code']);
  assert.deepEqual(pathSegmentsOf('/home/joke/code/').map((s) => s.label), ['home', 'joke', 'code']);
  assert.deepEqual(pathSegmentsOf(''), []);
  assert.deepEqual(pathSegmentsOf('   '), []);
});

test('pathSegmentsOf：每段路径都是可定位的绝对路径前缀', () => {
  const segs = pathSegmentsOf('D:\\a\\b\\c');
  for (let i = 1; i < segs.length; i += 1) {
    assert.ok(segs[i].path.startsWith(segs[i - 1].path), `${segs[i].path} 应以 ${segs[i - 1].path} 开头`);
  }
});

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
