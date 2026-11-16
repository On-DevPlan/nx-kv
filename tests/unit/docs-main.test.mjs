// #144：把某一篇设为宿主的**主篇**——语义是「换位」，不是覆盖。
//
// 这条用例锁的是三件在 UI 上看不出来的事：
//   ① 目标那篇从附加篇摘出来（否则同一篇会同时出现在主篇位与附加篇里）；
//   ② 原主篇退回附加篇（否则它失去归属 → 3 天后被孤儿清理悄悄删掉）；
//   ③ 没绑在这个宿主上的文档不许「顺手」变主篇（列表不能凭空多一篇）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as docs from '../../src/modules/docs/service.js';
import * as refs from '../../src/modules/docs/refs.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-docmain-'));
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
  mkdirSync(join(dir, 'docs'), { recursive: true });
});

/** 建一个仓库 + 两篇文档（第一篇自动成为主篇）。 */
async function setupRepo(tag = 'r1') {
  const r = await repos.addRepo({ path: join(dir, tag), name: tag, key: 'local/' + tag });
  const a = await docs.createRef({ owner: 'repo', repo: r.key, desc: '甲' });
  const b = await docs.createRef({ owner: 'repo', repo: r.key, desc: '乙' });
  return { key: r.key, a: a.refId, b: b.refId };
}

test('#144 设为主篇：目标上位、原主篇退回附加篇，列表不多不少', async () => {
  const { key, a, b } = await setupRepo();
  const before = await refs.listRepoDocs(key);
  assert.equal(before.main.refId, a, '第一篇是主篇');
  assert.deepEqual(before.extras.map((e) => e.refId), [b]);

  const out = await refs.setDocMain({ repo: key, ref: b });
  assert.equal(out.changed, true);
  assert.equal(out.previous, a, '返回里带原主篇');

  const after = await refs.listRepoDocs(key);
  assert.equal(after.main.refId, b, '目标成了主篇');
  assert.deepEqual(after.extras.map((e) => e.refId), [a], '原主篇退回附加篇');
  assert.equal(after.count, 2, '还是两篇：没有复制、也没有丢');
});

test('#144 原主篇仍保有归属（不会掉进孤儿名单）', async () => {
  const { key, a, b } = await setupRepo();
  await refs.setDocMain({ repo: key, ref: b });
  const doc = await docs.getDoc({ ref: a });
  assert.ok((doc.bindings || []).length > 0, '原主篇必须还挂在宿主上');
});

test('#144 重复设同一篇：幂等（alreadyMain，不再动列表）', async () => {
  const { key, a } = await setupRepo();
  const out = await refs.setDocMain({ repo: key, ref: a });
  assert.equal(out.changed, false);
  assert.equal(out.alreadyMain, true);
  const after = await refs.listRepoDocs(key);
  assert.equal(after.main.refId, a);
  assert.equal(after.count, 2);
});

test('#144 目标已在附加篇：摘出来再上位（同一篇不出现两次）', async () => {
  const { key, a, b } = await setupRepo();
  await refs.setDocMain({ repo: key, ref: b });
  await refs.setDocMain({ repo: key, ref: a }); // a 从附加篇回到主篇位
  const after = await refs.listRepoDocs(key);
  assert.equal(after.main.refId, a);
  assert.deepEqual(after.extras.map((e) => e.refId), [b], 'a 不在附加篇里重复出现');
  assert.equal(after.count, 2);
});

test('#144 没绑在这个宿主上的文档：显式报错（不隐式加一篇）', async () => {
  const { key } = await setupRepo();
  const other = await repos.addRepo({ path: join(dir, 'r2'), name: 'r2', key: 'local/r2' });
  const outsider = await docs.createRef({ owner: 'repo', repo: other.key, desc: '别的仓库的文档' });
  await assert.rejects(
    () => refs.setDocMain({ repo: key, ref: outsider.refId }),
    /不在这个宿主的文档列表里/
  );
  const after = await refs.listRepoDocs(key);
  assert.equal(after.count, 2, '列表没被偷偷加一篇');
});

test('#144 组也有主篇：--board 走同一套换位', async () => {
  const g = await boards.createBoard({ name: 'grp1' });
  const a = await docs.createRef({ owner: 'group', group: g.id, desc: '组甲' });
  const b = await docs.createRef({ owner: 'group', group: g.id, desc: '组乙' });

  const before = await boards.getBoard(g.id);
  assert.equal(before.docId, 'ref:' + a.refId, '组甲一开始是主篇');

  const out = await refs.setDocMain({ board: g.id, ref: b.refId });
  assert.equal(out.changed, true);

  // getBoard 的投影给 docId（主篇）+ introExtras（附加篇），与面板读的是同一份
  const after = await boards.getBoard(g.id);
  assert.equal(after.docId, 'ref:' + b.refId, '组主篇换成乙');
  assert.deepEqual((after.introExtras || []).map((x) => x.refId), [a.refId], '甲退回附加篇');
  assert.equal(after.introCount, 2, '还是两篇');
});

test('#144 repo 与 board 必须二选一', async () => {
  await assert.rejects(() => refs.setDocMain({}), /二选一/);
});
