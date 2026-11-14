// #132 · 参考仓库的文档与开发仓库同构。
//
// 用户口径：
//   · 「右边的文档列表需要收敛」——文档宿主只有一个地方（右侧栏列表）；
//   · 「参考仓库在组当中的 ref 文档列表需要显示」——组视图要带上组内**参考仓库**的文档；
//   · 「没有存在列表 参考仓库也是可以提交文档的呀」——参考仓库没有文档列表时也能新建；
//   · 「开发仓库和参考仓库只有一个 kind 的差异」——底层同构，列表上标出 kind 就够。
//
// 本文件钉住这四条：
//   ① 参考仓库能当文档宿主（createRef → ref_bindings type=repo）；
//   ② 单仓库视图（--host）能查到参考仓库自己的文档，hostKind='ref'；
//   ③ 组视图带上组内参考仓库的文档，且排在成员仓库文档之后；
//   ④ 删文档后宿主 ext 不再留悬空 refId（主篇 / 补充篇都清）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// env 先行（模块导入前钉住独立库 / home / 文档树）——**绝不碰用户真实的 ~/.nx-kv**。
// 注意：这些模块在 import 时读环境算 APP_DIR，所以 env 只能在 import 之前设，
// 不能每个用例再换一次（换目录不会换已算好的 APP_DIR）。
const dir = mkdtempSync(join(tmpdir(), 'nx-kv-refrepo-'));
process.env.NX_KV_HOME = join(dir, 'home');
process.env.NX_KV_DB = join(dir, 'nxkv.db');
process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
process.env.NX_KV_DOCS_DIR = join(dir, 'docs');

const docsSvc = await import('../../src/modules/docs/service.js');
const reposSvc = await import('../../src/modules/repos/service.js');
const boardsSvc = await import('../../src/modules/repos/boards.js');
// 参考仓库的绑定（group_refs）在 ref.ts 里，不在 service 门面
const refSvc = await import('../../src/modules/repos/ref.js');
const registry = await import('../../src/runtime/registry.js');
const { getDb, closeDb } = await import('../../src/core/db/index.js');
// 连接是进程级单例，服务层可能重开它——句柄每次现取，别在 import 时抓住一个已关的。
const db = () => getDb();

after(async () => {
  try { closeDb(); } catch { /* 已关 */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

const bindingsAction = () => registry.ACTIONS.find((a) => a.id === 'docs.bindings');
const runBindings = async (q) => bindingsAction().run(q, { transport: 'http' });

test('#132 参考仓库能当文档宿主：新建 → 绑定落 ref_bindings(type=repo)', async () => {
  const tag = 'a';
  await reposSvc.addRepo({ path: join(dir, 'ref1-' + tag), name: 'ref1', key: 'github.com/me/ref1-' + tag, type: 'ref' });
  const r = await docsSvc.createRef({ owner: 'repo', repo: 'github.com/me/ref1-' + tag, desc: '参考仓库的文档' });
  assert.match(r.refId, /^ref_[0-9a-f]{16}$/);
  const bind = db().all('SELECT type, repo_key FROM ref_bindings WHERE ref_id = :id', { id: r.refId });
  assert.deepEqual(bind.map((b) => [b.type, b.repo_key]), [['repo', 'github.com/me/ref1-' + tag]]);

  // 宿主的文档集（ext.doc）也写上了——参考仓库与开发仓库同一套结构
  const row = db().get('SELECT ext FROM repos WHERE key = :k', { k: 'github.com/me/ref1-' + tag });
  assert.match(String(row.ext), /ref_/, '参考仓库的 ext 里要有文档引用');
});

test('#132 单仓库视图能查参考仓库的文档，hostKind 标出 ref', async () => {
  const tag = 'b';
  await reposSvc.addRepo({ path: join(dir, 'ref1-' + tag), name: 'ref1', key: 'github.com/me/ref1-' + tag, type: 'ref' });
  await docsSvc.createRef({ owner: 'repo', repo: 'github.com/me/ref1-' + tag, desc: '参考仓库的文档' });
  const out = await runBindings({ host: 'github.com/me/ref1-' + tag });
  assert.equal(out.bindings.length, 1);
  assert.equal(out.bindings[0].type, 'repo');
  assert.equal(out.bindings[0].hostKind, 'ref', '参考仓库的文档要标 hostKind=ref');
});

test('#132 开发仓库的文档 hostKind=dev（同一套字段，只有 kind 不同）', async () => {
  const tag = 'c';
  await reposSvc.addRepo({ path: join(dir, 'dev1-' + tag), name: 'dev1', key: 'github.com/me/dev1-' + tag });
  await docsSvc.createRef({ owner: 'repo', repo: 'github.com/me/dev1-' + tag, desc: '开发仓库的文档' });
  const out = await runBindings({ host: 'github.com/me/dev1-' + tag });
  assert.equal(out.bindings[0].hostKind, 'dev');
});

test('#132 组视图带上组内参考仓库的文档，且排在成员仓库文档之后', async () => {
  const tag = 'd';
  const board = await boardsSvc.createBoard({ name: 'grp' });
  await reposSvc.addRepo({ path: join(dir, 'dev1-' + tag), name: 'dev1', key: 'github.com/me/dev1-' + tag });
  await reposSvc.addRepo({ path: join(dir, 'ref1-' + tag), name: 'ref1', key: 'github.com/me/ref1-' + tag, type: 'ref' });
  await boardsSvc.assignRepo({ key: 'github.com/me/dev1-' + tag, board: board.id });
  // 参考仓库绑到这个组（组级参考，group_refs）
  await refSvc.bindTarget({ key: 'github.com/me/ref1-' + tag, board: board.id });

  await docsSvc.createRef({ owner: 'repo', repo: 'github.com/me/dev1-' + tag, desc: '成员仓库的文档' });
  await docsSvc.createRef({ owner: 'repo', repo: 'github.com/me/ref1-' + tag, desc: '参考仓库的文档' });

  const out = await runBindings({ group: board.key });
  const kinds = out.bindings.map((b) => b.hostKind);
  assert.ok(kinds.includes('ref'), '组视图必须带上组内参考仓库的文档');
  const idxRef = out.bindings.findIndex((b) => b.hostKind === 'ref');
  const idxDev = out.bindings.findIndex((b) => b.hostKind === 'dev');
  assert.ok(idxRef > idxDev, '参考仓库的文档排在成员仓库文档之后');
  const refRow = out.bindings[idxRef];
  assert.equal(refRow.repoKey, 'github.com/me/ref1-' + tag);
  assert.equal(refRow.type, 'repo', '参考仓库的文档归属仍是 repo（与开发仓库同构）');
});

test('#132 删文档后宿主 ext 不留悬空 refId', async () => {
  const tag = 'e';
  await reposSvc.addRepo({ path: join(dir, 'ref1-' + tag), name: 'ref1', key: 'github.com/me/ref1-' + tag, type: 'ref' });
  const main = await docsSvc.createRef({ owner: 'repo', repo: 'github.com/me/ref1-' + tag, desc: '主篇' });
  const extra = await docsSvc.createRef({ owner: 'repo', repo: 'github.com/me/ref1-' + tag, desc: '补充篇' });
  const extOf = () => String(db().get('SELECT ext FROM repos WHERE key = :k', { k: 'github.com/me/ref1-' + tag }).ext);

  assert.match(extOf(), new RegExp(main.refId), '建完主篇在 ext 里');
  assert.match(extOf(), new RegExp(extra.refId), '建完补充篇在 ext 里');

  await docsSvc.removeDoc({ ref: 'ref:' + main.refId });
  assert.doesNotMatch(extOf(), new RegExp(main.refId), '删主篇后 ext 不该再指它');
  assert.match(extOf(), new RegExp(extra.refId), '另一篇还在');

  await docsSvc.removeDoc({ ref: 'ref:' + extra.refId });
  assert.doesNotMatch(extOf(), new RegExp(extra.refId), '删补充篇后 ext 也不该再指它');
  const out = await runBindings({ host: 'github.com/me/ref1-' + tag });
  assert.equal(out.bindings.length, 0, '删完宿主列表为空');
});
