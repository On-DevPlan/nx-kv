// 知识聚合（modules/docs/knowledge.js）的单元测试（v8）。
//
// v8 读取规则：宿主 ext 里的 DocRef 只有 refId；自有正文来自 ref_bodies，
// 外部 ref 按 refs.locator 读盘（目录会展开成一页页文档）；没有约定路径 / 惰性播种。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as refService from '../../src/modules/repos/ref.js';
import * as store from '../../src/modules/docs/store.js';
import * as refs from '../../src/modules/docs/refs.js';
import { createRef, updateDoc } from '../../src/modules/docs/service.js';
import { repoKnowledge } from '../../src/modules/docs/knowledge.js';
import { ensureDocRef } from '../../src/core/attachmentdb.js';
import { getDb, closeDb } from '../../src/core/db/index.js';

let dir = '';

beforeEach(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-docknow-'));
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

async function writeRef(refId, body) {
  await updateDoc({ ref: 'ref:' + refId, body });
  return refId;
}

async function build() {
  const a = await repos.addRepo({ path: join(dir, 'alpha'), name: 'alpha', remote: 'https://github.com/me/alpha' });
  const ref = await repos.addRepo({ path: join(dir, 'reflib'), name: 'reflib', type: 'ref', remote: 'https://github.com/me/reflib' });
  // createBoard 的 desc 会直接落成组介绍主篇（描述 = 文档）
  const b = await boards.createBoard({ name: 'nx系列', desc: '本机工具链组合' });
  await boards.assignRepo({ key: a.key, board: b.id });
  await boards.setBoardRepoNote({ key: a.key, board: b.id, note: '组里的任务出入口' });
  // v4：参考仓库绑在组上（组内共享），note 是组级描述
  await refService.bindTarget({ id: ref.id, board: [{ id: b.id, note: '契约来源' }] });

  // 项目介绍（主篇）：直接 ref + 正文
  const repoDoc = await createRef({ owner: 'repo', repo: a.key, desc: 'alpha' });
  await writeRef(repoDoc.refId, '# alpha\n\n项目介绍正文');

  const vault = join(dir, 'vault');
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, '命名法.md'), '# 命名法');
  return { a, ref, b, vault, repoDoc };
}

const asExternal = (refId) => {
  getDb().run("UPDATE refs SET origin = 'external' WHERE id = :id", { id: refId });
  return refId;
};

test('聚合形状：项目介绍 + 组（介绍/组内描述） + 参考仓库', async () => {
  const { a } = await build();

  const k = await repoKnowledge(a.id);
  assert.equal(k.repo.key, a.key);
  assert.equal(k.intro.missing, undefined);
  assert.equal(k.intro.title, 'alpha');
  assert.match(k.intro.body, /项目介绍正文/);

  assert.equal(k.boards.length, 1);
  const bd = k.boards[0];
  assert.equal(bd.name, 'nx系列');
  assert.equal(bd.intro.missing, undefined);
  assert.match(bd.intro.body, /本机工具链组合/);
  assert.ok(bd.note && !bd.note.missing, '组内描述来自 group_repo ref 的正文');
  assert.match(bd.note.body, /任务出入口/);
  assert.ok(await store.ownDocExists(bd.note.refId), '组内描述正文真实落库');

  // 没有登记额外文档 → 绑定与外部目录都为空
  assert.deepEqual(bd.docLinks, []);
  assert.equal(bd.externalDirs.length, 0);
  const k2 = await repoKnowledge(a.id);
  assert.deepEqual(k2.boards[0].docLinks, []);

  assert.equal(k.refRepos.length, 1);
  assert.equal(k.refRepos[0].name, 'reflib');
  assert.equal(k.refRepos[0].note, '契约来源');
});

test('组绑定：自有 ref 进全文，外部目录里的 .md 逐篇展开，缺失标 missing', async () => {
  const { a, b, vault } = await build();

  // 自有补充篇（组级 docLinks）
  const own = await createRef({ owner: 'group', group: b.id, desc: 'waitgoal 设计' });
  await writeRef(own.refId, '# waitgoal 设计\n\n正文');
  await refs.setDocLink({ board: b.id, ref: own.refId, note: '自有' });

  // 外部目录 ref（origin=external，locator 是目录）
  const dirRef = asExternal(ensureDocRef(getDb(), { locator: vault }));
  await refs.setDocLink({ board: b.id, ref: dirRef, note: 'Obsidian' });

  // 外部文件缺失（locator 指向不存在的 .md）
  const goneRef = asExternal(ensureDocRef(getDb(), { locator: join(dir, 'gone.md') }));
  await refs.setDocLink({ board: b.id, ref: goneRef, note: '缺失' });

  const k = await repoKnowledge(a.id);
  const links = k.boards[0].docLinks;
  assert.equal(links.length, 3);
  assert.match(links[0].body, /waitgoal 设计/);

  const vaultDoc = links.find((d) => d.name === '命名法.md');
  assert.ok(vaultDoc, '外部目录里的 .md 要逐篇展开成文档条目');
  assert.match(vaultDoc.body, /# 命名法/);

  const missing = links.find((d) => d.missing);
  assert.ok(missing, '不存在的 locator 标 missing');

  // v8：目录 ref 不再单独进 externalDirs（直接按文件展开）
  assert.equal(k.boards[0].externalDirs.length, 0);
});

test('--md：拼成单篇 markdown（介绍 → 组 → 绑定 → 参考）', async () => {
  const { a } = await build();
  const k = await repoKnowledge(a.id, { md: true });
  assert.ok(k.md.startsWith('# alpha'));
  assert.match(k.md, /## 组：nx系列/);
  assert.match(k.md, /本机工具链组合/);
  assert.match(k.md, /任务出入口/);
});

test('未登记目录 + 无 locator：报错信息指路（先登记或给 id）', async () => {
  await assert.rejects(() => repoKnowledge(), /当前目录不在已登记仓库内|repo 不存在/);
});
