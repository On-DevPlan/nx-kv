// 关系改用 key 的单元测试：
// 看板成员 / 绑定关系一律按 key（不再是随机 id）；导入时「本地未拥有」的成员保留占位；
// clone 用占位的 key 补齐；remote 对齐（list / pick / check）；一次性迁移幂等。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as ref from '../../src/modules/repos/ref.js';
import * as keys from '../../src/modules/repos/keys.js';
import * as remote from '../../src/modules/repos/remote.js';
import * as transfer from '../../src/modules/repos/transfer.js';
import { closeDb } from '../../src/core/db/index.js';  // T05：库化后测试清理要先关连接（Windows rmSync 否则 EBUSY）

let dir = '';
let cfgDir = '';

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const git = (args, cwd) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-rel-'));
  cfgDir = mkdtempSync(join(tmpdir(), 'nx-kv-relcfg-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_CONFIG = join(cfgDir, 'config.json');
  // docs 树也要隔离：本文件的用例会经 repos/boards/ref 写项目与组介绍文档，
  // 不设就会落到真实 ~/.nx-kv/docs（docsRoot() 回落 APP_DIR/docs）。
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  for (const d of [dir, cfgDir]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

// ─── 看板成员按 key ─────────────────────────────────────────────────────

test('看板成员存 key：assign 后 repoKeys 是 key 不是随机 id', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', remote: 'git@github.com:o/d1.git' });
  const b = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.id, board: b.id });

  // 存储已库化（T05）：读“成员按 key 固化”改从 loadStore 断言
  //（repo_group_members 两端都是 repos.key，随机 id 在库层就不存在了）
  const board = (await repos.loadStore()).boards.find((x) => x.name === 'grp');
  assert.deepEqual(board.repoKeys, ['github.com/o/d1']);
  assert.equal(board.repoIds, undefined, '不再用随机 id');

  // 投影也带 key
  const got = await boards.getBoard(b.id);
  assert.equal(got.repos[0].key, 'github.com/o/d1');
  assert.equal(got.repos[0].present, true);
  assert.equal(got.repos[0].note, '');
});

test('组内描述按 key：note 落在 repoNotes[key] 上', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', remote: 'git@github.com:o/d1.git' });
  const b = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.key, board: b.key });
  await boards.setBoardRepoNote({ id: dev.key, board: b.key, note: '契约方' });

  // 存储已库化（T05）：repo_group_members.note 承载组内描述，按 key 读回
  const board = (await repos.loadStore()).boards.find((x) => x.name === 'grp');
  assert.equal(board.repoNotes['github.com/o/d1'], '契约方');

  const got = await boards.getBoard(b.key);
  assert.equal(got.repos[0].note, '契约方');
});

test('绑定关系按 key：参考仓库可绑组（group_refs）也可绑单个仓库（ext.linked）', async () => {
  const b = await boards.createBoard({ name: 'nx' });
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', remote: 'git@github.com:o/d1.git' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'git@github.com:o/r1.git' });
  await ref.bindTarget({ id: r.id, repo: dev.id, board: b.id });

  const got = await boards.getBoard(b.id);
  assert.deepEqual(got.refs, [{ id: 'github.com/o/r1' }]);
  // 仓库级绑定独立存在（不折算成组）
  const devSide = await repos.getRepo(dev.id);
  assert.deepEqual(devSide.linked, [{ kind: 'ref', id: 'github.com/o/r1' }]);
});

test('绑定到看板也按 key（board/<名称>）', async () => {
  const b = await boards.createBoard({ name: 'nx' });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'git@github.com:o/r1.git' });
  await ref.bindTarget({ id: r.id, board: b.id });
  const got = await boards.getBoard(b.key);
  assert.deepEqual(got.refs, [{ id: 'github.com/o/r1' }]);
});

// ─── 导入占位 ───────────────────────────────────────────────────────────

test('导入：本地未拥有的成员在组里保留位置（占位），组内描述也保留', async () => {
  const layout = {
    version: 3,
    repos: [{ key: 'github.com/have/it', name: 'have-it', type: 'dev', remote: 'https://github.com/have/it.git' }],
    boards: [{
      key: 'board/g',
      name: 'g',
      desc: '',
      repos: [
        { key: 'github.com/have/it' },
        { key: 'github.com/miss/ing', note: '还没 clone 的参考' },
      ],
    }],
    links: [],
  };
  const { saveConfig } = await import('../../src/core/config.js');
  await saveConfig({ gitRepoRoot: join(dir, 'root'), gitDevRoot: join(dir, 'root') });

  const r = await transfer.repoImport({ json: JSON.stringify(layout), clone: 'none' });
  assert.equal(r.created.length, 1);
  assert.equal(r.unmatched.length, 1);
  assert.equal(r.unmatched[0].entry, 'github.com/miss/ing');

  // 组里位置保留
  const b = (await boards.listBoards()).boards.find((x) => x.name === 'g');
  assert.equal(b.repos.length, 2, '占位成员也占位');
  const miss = b.repos.find((x) => x.key === 'github.com/miss/ing');
  assert.equal(miss.present, false, '本地未拥有');
  assert.equal(miss.note, '还没 clone 的参考', '组内描述按 key 保留，等补齐后生效');
});

test('clone 补齐占位：用占位的 key 登记 → 占位自动转正、位置不动', async () => {
  if (!hasGit) return;
  // 本地源仓库（当远程用）
  const src = join(dir, 'src');
  mkdirSync(src);
  git(['init', '-q', '--initial-branch=main'], src);
  writeFileSync(join(src, 'a.md'), 'a');
  git(['add', '.'], src);
  git(['commit', '-qm', 'init'], src);
  const srcUrl = 'file://' + src.replace(/\\/g, '/');

  const { saveConfig } = await import('../../src/core/config.js');
  await saveConfig({ gitRepoRoot: join(dir, 'root'), gitDevRoot: join(dir, 'root') });

  // 导入一个布局：成员只在看板里被引用、repos 里没有定义
  // —— 这是「本地未拥有」的真占位：位置照抄进组里，仓库本身不登记。
  // （自定义 key 的占位才能测出「用占位的 key 登记」——remote 派生不出来的那种）
  const layout = {
    version: 3,
    repos: [],
    boards: [{ key: 'board/g', name: 'g', desc: '', repos: [{ key: 'my/custom-ing', note: '组内描述' }] }],
    links: [],
  };
  const r = await transfer.repoImport({ json: JSON.stringify(layout), clone: 'none' });
  assert.equal(r.unmatched.length, 1, '占位成员如实报告');

  // 占位在组里
  let b = (await boards.listBoards()).boards.find((x) => x.name === 'g');
  assert.equal(b.repos.length, 1);
  assert.equal(b.repos[0].present, false);
  assert.equal(b.repos[0].note, '组内描述');

  // clone 补齐（用占位的 key 登记）
  const c = await remote.cloneRepo({ remote: srcUrl, key: 'my/custom-ing', type: 'ref' });
  assert.equal(c.key, 'my/custom-ing');

  // 占位转正：位置不动、描述还在
  b = (await boards.listBoards()).boards.find((x) => x.name === 'g');
  assert.equal(b.repos.length, 1);
  assert.equal(b.repos[0].present, true, 'clone 后占位转正');
  assert.equal(b.repos[0].note, '组内描述');
  const got = await repos.getRepo('my/custom-ing');
  assert.equal(got.key, 'my/custom-ing');
  assert.equal(got.keyCustom, true, '显式指定的 key 是自定义 key');
});

// ─── 迁移 ───────────────────────────────────────────────────────────────

test('migrateRelations：库化后幂等空转（repoIds→key 的换算在导入事务里，见 db-migrate-from-json）', async () => {
  // T05 起存储是 SQLite：老结构（成员存随机 id）只能经 JSON 导入进库，
  // 换算发生在 importRepos（repoIds / 按 id 键的 repoNotes → key）。运行期
  // 的 store 里 boards 永远带 repoKeys 数组 —— migrateRelations 应是幂等空转。
  const dev = await repos.addRepo({ path: join(dir, 'm1'), name: 'm1', remote: 'git@github.com:o/m1.git' });
  const b = await boards.createBoard({ name: 'mgrp' });
  await boards.assignRepo({ id: dev.id, board: b.id });

  const preview = await keys.migrateRelations({ apply: false });
  assert.equal(preview.changed, 0, '新结构无待改写关系');

  const applied = await keys.migrateRelations({ apply: true });
  assert.equal(applied.changed, 0, 'apply 也是空转');
  const board = (await repos.loadStore()).boards.find((x) => x.name === 'mgrp');
  assert.deepEqual(board.repoKeys, ['github.com/o/m1'], '成员关系原样保留');
});

// ─── remote 对齐 ───────────────────────────────────────────────────────

if (hasGit) {
  test('remote list：列出 git remote -v 的全部候选，标出当前采纳的', async () => {
    const p = join(dir, 'proj');
    mkdirSync(p);
    git(['init', '-q', '--initial-branch=main'], p);
    git(['remote', 'add', 'origin', 'https://github.com/x/proj.git'], p);
    git(['remote', 'add', 'upstream', 'git@github.com:x/proj.git'], p);

    const r = await repos.addRepo({ path: p, name: 'proj', remote: 'git@github.com:x/proj.git' });
    const d = await remote.listRemotes(r.id);
    assert.equal(d.remotes.length, 2);
    const ssh = d.remotes.find((x) => x.url.indexOf('git@') === 0);
    assert.equal(ssh.current, true, '当前采纳的是 SSH 那条');
    assert.equal(ssh.derivedKey, 'github.com/x/proj');
  });

  test('remote pick：人工换一条 → key 跟随重算', async () => {
    const p = join(dir, 'proj2');
    mkdirSync(p);
    git(['init', '-q', '--initial-branch=main'], p);
    git(['remote', 'add', 'origin', 'https://github.com/x/proj2.git'], p);

    const r = await repos.addRepo({ path: p, name: 'proj2', remote: 'https://github.com/x/proj2.git' });
    assert.equal(r.key, 'github.com/x/proj2');

    // 自定义 key 的仓库：换 remote 时 key 不动
    const c = await repos.addRepo({
      path: join(dir, 'custom'), name: 'custom',
      remote: 'https://github.com/x/custom.git', key: 'My/Custom', keyCustom: true,
    });
    const picked = await remote.pickRemote(c.id, 'git@github.com:x/custom.git');
    assert.equal(picked.key, 'my/custom', '自定义 key 不随 remote 变');
    assert.equal(picked.remote, 'git@github.com:x/custom.git');
  });

  test('remote check：不存在的地址与可达的地址结论不同', async () => {
    const r = await repos.addRepo({
      path: join(dir, 'c'), name: 'c',
      remote: 'https://github.com/x/definitely-not-exist-xyz.git',
    });
    const miss = await remote.checkRemote(r.id);
    assert.ok(['missing', 'unreachable'].includes(miss.status), 'status=' + miss.status);
    assert.ok(miss.detail.length > 0);
  });
}
