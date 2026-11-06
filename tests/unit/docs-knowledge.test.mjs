// 知识聚合（modules/docs/knowledge.js）的单元测试：
// 聚合形状、惰性播种触发、组绑定混排（自有全文 / 外部目录清单）、--md 拼装、参考仓库。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as store from '../../src/modules/docs/store.js';
import * as paths from '../../src/modules/docs/paths.js';
import { repoKnowledge } from '../../src/modules/docs/knowledge.js';
import { closeDb } from '../../src/core/db/index.js';  // T05：库化后测试清理要先关连接（Windows rmSync 否则 EBUSY）

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-docknow-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
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

async function build() {
  const a = await repos.addRepo({ path: join(dir, 'alpha'), name: 'alpha', desc: '管清单的', remote: 'https://github.com/me/alpha' });
  const ref = await repos.addRepo({ path: join(dir, 'reflib'), name: 'reflib', type: 'ref', remote: 'https://github.com/me/reflib' });
  const b = await boards.createBoard({ name: 'nx系列', desc: 'nx 工具链' });
  await boards.assignRepo({ key: a.key, board: b.id });
  await boards.setBoardRepoNote({ key: a.key, board: b.id, note: '组里的任务出入口' });
  await repos.updateRepo(a.id, { linked: [{ kind: 'ref', id: ref.key, note: '契约来源' }] });
  // 组介绍 + 组绑定（自有一份 + 外部目录一份）
  await store.writeOwnDoc(paths.boardDocRel('nx系列'), '# nx系列\n\n本机工具链组合');
  const vault = join(dir, 'vault');
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, '命名法.md'), '# 命名法');
  await boards.updateBoard(b.id, {});
  return { a, ref, b, vault };
}

test('聚合形状：介绍（惰性播种）+ 组（介绍/组内描述/绑定混排）+ 参考', async () => {
  const { a, vault } = await build();
  await store.writeOwnDoc(paths.repoDocRel(a.key), '# alpha\n\n项目介绍正文');

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
  assert.ok(bd.note && !bd.note.missing, '组内描述：约定路径缺失 + note 字符串非空 → 惰性播种');
  assert.match(bd.note.body, /任务出入口/);
  // 播种真实落盘（幂等的证据）
  assert.ok(await store.ownDocExists(paths.groupNoteRel('nx系列', a.key)));

  // 外部目录绑定只列清单不进全文
  assert.equal(bd.externalDirs.length, 0);
  const k2 = await repoKnowledge(a.id);
  assert.deepEqual(k2.boards[0].docLinks, []);

  assert.equal(k.refs.length, 1);
  assert.equal(k.refs[0].name, 'reflib');
  assert.equal(k.refs[0].note, '契约来源');
  assert.ok(join(vault, '命名法.md'));
});

test('组绑定：自有 rel 进全文，外部目录进 externalDirs 清单，缺失标 missing', async () => {
  const { a, b, vault } = await build();
  await store.writeOwnDoc('notes/waitgoal-设计.md', '# waitgoal 设计\n\n正文');
  await repos.mutateStore((s) => {
    const bd = s.boards.find((x) => x.id === b.id);
    bd.docLinks = [
      { rel: 'notes/waitgoal-设计.md', note: '自有' },
      { path: vault, note: 'Obsidian' },
      { path: join(dir, 'gone.md'), note: '缺失' },
    ];
  });

  const k = await repoKnowledge(a.id);
  const links = k.boards[0].docLinks;
  assert.equal(links.length, 2);
  assert.match(links[0].body, /waitgoal 设计/);
  assert.equal(links[1].missing, true);
  const dirs = k.boards[0].externalDirs;
  assert.equal(dirs.length, 1);
  assert.deepEqual(dirs[0].files.map((f) => f.replace(/\\/g, '/')), [join(vault, '命名法.md').replace(/\\/g, '/')]);
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
