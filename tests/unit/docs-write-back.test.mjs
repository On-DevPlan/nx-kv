// 文档写回口径（任务 #88「简介文档优化」）：
//   rel:  自有树 → 可读可写
//   path: 外部登记 → **可读可写回来源**（写侧必须仍在绑定闭包内、必须是 .md、不能是目录）
//   dir:  外部目录绑定 → 只读清单
// 这组断言守住三件最容易回归的事：读侧 writable 标记、写侧闭包守卫、目录拒写。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as paths from '../../src/modules/docs/paths.js';
import { ACTIONS } from '../../src/runtime/registry.js';
import { closeDb } from '../../src/core/db/index.js';

let dir = '';
let vault = '';

const docGet = ACTIONS.find((a) => a.id === 'doc.get');
const docUpdate = ACTIONS.find((a) => a.id === 'doc.update');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-docwrite-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
  vault = join(dir, 'vault');
  mkdirSync(join(vault, 'sub'), { recursive: true });
  writeFileSync(join(vault, 'root.md'), '# 根文档\n\n原文\n', 'utf8');
  writeFileSync(join(vault, 'sub', 'deep.md'), '# 深文档\n', 'utf8');
  writeFileSync(join(dir, 'outside.md'), '# 闭包外\n', 'utf8');

  await repos.addRepo({ path: join(dir, 'alpha'), name: 'alpha' });
  await repos.mutateStore((s) => {
    // 单文件绑定 + 目录绑定同时在场：前者精确命中，后者覆盖目录内所有 .md
    s.repos[0].doc = { path: join(vault, 'root.md') };
    s.boards.push({
      id: 'b_1',
      name: 'nx系列',
      desc: '',
      createdAt: new Date().toISOString(),
      repoKeys: [],
      docLinks: [{ path: vault, note: 'vault 目录' }],
    });
  });
});

test.after?.(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

test('读侧：自有与外部登记文档都是 writable（弹窗/页签才给得出编辑器）', async () => {
  const own = await docGet.run({ ref: paths.ownDocId('repo/a.md') }, { transport: 'http' });
  assert.equal(own.writable, true, '自有文档恒可写（缺文件也可写 —— 保存即创建）');

  const ext = await docGet.run({ ref: paths.extDocId(join(vault, 'root.md')) }, { transport: 'http' });
  assert.equal(ext.writable, true, '外部登记文档可写回来源');
  assert.equal(ext.external, true);

  const deep = await docGet.run({ ref: paths.extDocId(join(vault, 'sub', 'deep.md')) }, { transport: 'http' });
  assert.equal(deep.writable, true, '目录绑定内的 .md 也可写');
});

test('写侧：闭包内的外部文档写回原文件', async () => {
  const abs = join(vault, 'root.md');
  const res = await docUpdate.run(
    { ref: paths.extDocId(abs), body: '# 改过的\n\n新正文\n' },
    { transport: 'http' }
  );
  assert.equal(res.external, true);
  assert.equal(readFileSync(abs, 'utf8'), '# 改过的\n\n新正文\n');

  // 目录绑定内的嵌套文件同样可写（父目录已存在，不该报错）
  const deep = join(vault, 'sub', 'deep.md');
  await docUpdate.run({ ref: paths.extDocId(deep), body: '# 深改\n' }, { transport: 'http' });
  assert.equal(readFileSync(deep, 'utf8'), '# 深改\n');
});

test('写侧：闭包外的路径一律拒写（PATCH 不能变成任意文件写入口）', async () => {
  const outside = join(dir, 'outside.md');
  await assert.rejects(
    () => docUpdate.run({ ref: paths.extDocId(outside), body: '# 越界\n' }, { transport: 'http' }),
    /不在绑定闭包内/
  );
  assert.equal(readFileSync(outside, 'utf8'), '# 闭包外\n', '被拒后原文件不能被动过');

  // 前缀拼接骗不过闭包判定
  await assert.rejects(
    () => docUpdate.run({ ref: paths.extDocId(vault + '-sibling.md'), body: 'x' }, { transport: 'http' }),
    /不在绑定闭包内/
  );
});

test('写侧：目录本身与非 .md 拒写', async () => {
  await assert.rejects(
    () => docUpdate.run({ ref: paths.extDocId(vault), body: 'x' }, { transport: 'http' }),
    /不能整体写回|\.md/
  );
  const txt = join(vault, 'note.txt');
  writeFileSync(txt, 'txt', 'utf8');
  await assert.rejects(
    () => docUpdate.run({ ref: paths.extDocId(txt), body: 'x' }, { transport: 'http' }),
    /只能写回 \.md/
  );
  assertOk(txt);
});

function assertOk(p) {
  assert.ok(existsSync(p), '守卫失败时不该在磁盘上留下副作用');
}
