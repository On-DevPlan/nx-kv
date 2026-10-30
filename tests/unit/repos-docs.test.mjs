// 仓库的「描述文档」（md 列表）的单元测试。
//
// 用户的诉求：desc 不该只有一句话——它是 []md 的下位形态，md 才是仓库描述的载体
// （链接到仓库里的本地 md 文件）。所以这里钉住三件事：
//   1. 只认**仓库内**的相对路径（绝对路径 / `..` 越界一律不收）；
//   2. 读正文要如实报错（不存在 / 不是 md / 太大），不能静默给空串；
//   3. 增改查三处对 docs 的口径一致（不清空、不丢、不重复）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as service from '../../src/modules/repos/service.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-doc-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_CONFIG = join(dir, 'config.json');
});

const makeRepo = (name, files = {}) => {
  const p = join(dir, name);
  mkdirSync(p, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(p, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, text);
  }
  return p;
};

test('sanitizeDocs：只留仓库内相对 md 路径，去重、挡掉绝对路径与越界', () => {
  const list = service.sanitizeDocs([
    'README.md',
    './docs/arch.md',
    'docs\\dev.md',        // 反斜杠归一
    'README.md',           // 重复（大小写不同也算同一个）
    'readme.md',
    '/etc/passwd.md',      // 绝对路径
    'D:/x/y.md',           // 盘符
    '../../escape.md',     // 越界
    'notes.txt',           // 不是 md
    '', null, undefined,
  ]);
  assert.deepEqual(list, ['README.md', 'docs/arch.md', 'docs/dev.md']);
});

test('docs 跟着登记走：add 带 docs、get 与 list 都读得到', async () => {
  const p = makeRepo('with-docs', { 'README.md': '# 标题\n正文', 'docs/a.md': '# a' });
  await service.addRepo({ path: p, name: 'with-docs', remote: 'https://github.com/a/d.git', docs: ['README.md', 'docs/a.md', 'bad.txt'] });

  const got = await service.getRepo('github.com/a/d');
  assert.deepEqual(got.docs, ['README.md', 'docs/a.md']);
  const [row] = await service.listRepos();
  assert.deepEqual(row.docs, ['README.md', 'docs/a.md']);
});

test('updateRepo 改 docs：给空数组 = 清空（不是「不改」）', async () => {
  const p = makeRepo('clear-docs', { 'README.md': '# r' });
  const r = await service.addRepo({ path: p, name: 'clear-docs', docs: ['README.md'] });
  assert.deepEqual(r.docs, ['README.md']);

  const cleared = await service.updateRepo(r.id, { docs: [] });
  assert.deepEqual(cleared.docs, []);
  // 没传 docs 的更新不该把它清掉
  await service.updateRepo(r.id, { docs: ['README.md'] });
  const kept = await service.updateRepo(r.id, { desc: '改个描述' });
  assert.deepEqual(kept.docs, ['README.md']);
});

test('readRepoDoc：能读出正文，路径归一后与登记一致', async () => {
  const p = makeRepo('read-doc', { 'docs/arch.md': '# 架构\n\n正文内容' });
  await service.addRepo({ path: p, name: 'read-doc', remote: 'https://github.com/a/r.git', docs: ['docs/arch.md'] });

  const d = await service.readRepoDoc('github.com/a/r', 'docs/arch.md');
  assert.equal(d.path, 'docs/arch.md');
  assert.match(d.text, /正文内容/);
  assert.ok(d.size > 0);
});

test('readRepoDoc：越界 / 非 md / 不存在 都显式报错', async () => {
  const p = makeRepo('guard', { 'README.md': '# x', 'a.txt': 'x' });
  await service.addRepo({ path: p, name: 'guard', remote: 'https://github.com/a/g.git' });

  await assert.rejects(() => service.readRepoDoc('github.com/a/g', '../outside.md'), /路径不合法|越出/);
  await assert.rejects(() => service.readRepoDoc('github.com/a/g', 'a.txt'), /路径不合法/);
  await assert.rejects(() => service.readRepoDoc('github.com/a/g', 'nope.md'), /不存在/);
});

test('readRepoDoc：超过 512KB 拒读（面板不是用来灌大文件的）', async () => {
  const big = '# x\n' + 'a'.repeat(520 * 1024);
  const p = makeRepo('big-doc', { 'big.md': big });
  await service.addRepo({ path: p, name: 'big-doc', remote: 'https://github.com/a/big.git' });

  await assert.rejects(() => service.readRepoDoc('github.com/a/big', 'big.md'), /太大/);
});

test('导出布局不带 docs 的本地文件内容（只带登记）', async () => {
  const p = makeRepo('exp-doc', { 'README.md': '# 机密正文' });
  await service.addRepo({ path: p, name: 'exp-doc', remote: 'https://github.com/a/e.git', docs: ['README.md'] });

  const transfer = await import('../../src/modules/repos/transfer.js');
  const layout = await transfer.repoExport({ includeUnassigned: true });
  const text = JSON.stringify(layout);
  assert.ok(!text.includes('机密正文'), '导出的布局不得包含 md 正文');
  assert.ok(!text.includes(p.replace(/\\/g, '\\\\')), '也不得含本地路径');
});

test.after?.(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});
