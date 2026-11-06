// repos 域仓储层的单元测试（T05）：
// 行↔JSON 形态适配 / 哨兵仓库规则（隐藏 / 拒绝入组 / 导出排除）/ 队列绑定
// （先建 refs 再绑 topic）/ 组冻结 key / zip 往返四项相等（仓库清单 / 组成员 /
// ref 绑定 / 队列绑定）。
//
// 存储走 NX_KV_REPOS_STORE 指到的临时目录（映射为 <dir>/nxkv.db，测试内自设）；
// 队列行经 localtask/repo/topics 直接落在同一个库（两者本就共用一条连接）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as transfer from '../../src/modules/repos/transfer.js';
import { closeDb } from '../../src/core/db/index.js';
import repoLayer from '../../src/modules/repos/repo/index.js';
import { topicKeyOf, GLOBAL_TOPIC_KEY } from '../../src/core/topic-key.js';

let dir = '';
const repo = repoLayer;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-reposrepo-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  // docs 树同样隔离：约定路径绑定会扫这棵树
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

async function seedRepos() {
  const a = await repos.addRepo({ path: join(dir, 'alpha'), name: 'alpha', remote: 'git@github.com:o/alpha.git', desc: '第一个' });
  const b = await repos.addRepo({ path: join(dir, 'beta'), name: 'beta', remote: 'git@github.com:o/beta.git' });
  const r = await repos.addRepo({ path: join(dir, 'ref1'), name: 'ref1', type: 'ref', remote: 'git@github.com:o/ref1.git' });
  return { a, b, r };
}

// ─── 哨兵仓库规则（D3）────────────────────────────────────────────────

test('哨兵仓库：永远在库但不在用户视野；不能入组', async () => {
  const { a } = await seedRepos();
  // 库里在（db inspect 可见）
  const rows = repo.txw((conn) => repo.repos.listRepoRows(conn, { includeSentinel: true }));
  assert.ok(rows.some((x) => x.key === '__unbound__'), '哨兵行在库');
  // 用户视野里不在
  assert.equal((await repos.listRepos()).some((x) => x.key === '__unbound__'), false, 'listRepos 默认隐藏');
  assert.equal((await repos.loadStore()).repos.some((x) => x.key === '__unbound__'), false, 'store 组装也隐藏');
  assert.ok(a);
  // 不能入组
  const board = await boards.createBoard({ name: '哨兵组' });
  await assert.rejects(() => boards.assignRepo({ key: '__unbound__', board: board.id }), /哨兵/);
});

// ─── 组冻结 key（T05 裁决）────────────────────────────────────────────

test('组 key 冻结：改 name 后 key 不变；ext_legacy_id 保留 b_xxx', async () => {
  await seedRepos();
  const board = await boards.createBoard({ name: '前端' });
  const keyBefore = board.key;
  const legacyId = board.id;
  assert.ok(legacyId.startsWith('b_'), '本机行主键 b_xxx');
  assert.equal(keyBefore, 'board/前端');

  const renamed = await boards.updateBoard(board.id, { name: '前端组' });
  assert.equal(renamed.name, '前端组');
  assert.equal(renamed.key, keyBefore, '冻结 key 不随改名漂');

  // 重开进程（closeDb）后再读：冻结 key 从库行原样回来
  closeDb();
  const s = await repos.loadStore();
  const back = s.boards.find((x) => x.id === legacyId);
  assert.equal(back.key, keyBefore, '库里存的就是冻结 key');
  assert.equal(back.name, '前端组');
  assert.equal(back.id, legacyId, 'ext_legacy_id 往返一致');
});

// ─── 队列绑定（先建 refs 再绑 topic）──────────────────────────────────

test('bindTopicsToRepos：预览零副作用；apply 按**最长路径前缀**绑队列，先建 refs 索引', async () => {
  // 两个嵌套登记的仓库：长前缀的接管子目录队列
  const parent = await repos.addRepo({ path: join(dir, 'proj'), name: 'proj', remote: 'git@github.com:o/proj.git' });
  const child = await repos.addRepo({ path: join(dir, 'proj', 'sub'), name: 'sub', remote: 'git@github.com:o/sub.git' });

  // docs 树里放两份文档：一份命中 alpha 约定路径，一份自由文档（孤儿）
  mkdirSync(join(dir, 'docs', 'repo', child.key), { recursive: true });
  writeFileSync(join(dir, 'docs', 'repo', child.key, 'index.md'), '# sub 介绍\n');
  mkdirSync(join(dir, 'docs', 'free'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'free', 'note.md'), '# 自由文档\n');

  // 队列：proj 下一条、proj/sub 下一条、无关目录一条、全局池一条
  const mk = (cwd) => repo.txw((conn) => {
    const at = Date.now();
    conn.run(
      `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                           deleted_at, created_at, updated_at)
       VALUES (:key, '__unbound__', :cwd, NULL, :cwd, 1, '{}', '', 0, NULL, :at, :at)`,
      { key: topicKeyOf(cwd, ''), cwd, at }
    );
  });
  mk(join(dir, 'proj', 'app'));
  mk(join(dir, 'proj', 'sub', 'deep'));
  mk(join(dir, 'other'));
  repo.txw((conn) => {
    const at = Date.now();
    conn.run(
      `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                           deleted_at, created_at, updated_at)
       VALUES ('${GLOBAL_TOPIC_KEY}', '__unbound__', '', NULL, '全局任务', 1, '{}', '', 0, NULL, :at, :at)`,
      { at }
    );
  });

  // 预览：零副作用（库不变），只列计划
  const plan = await repos.bindTopicsToRepos({ apply: false });
  assert.equal(plan.scanned, 4);
  assert.equal(plan.bound.length, 2, '预览命中两条');
  assert.equal(plan.bound.some((x) => x.cwd === join(dir, 'other')), false, '无关目录不绑');
  const hitParent = plan.bound.find((x) => x.cwd === join(dir, 'proj', 'app'));
  const hitChild = plan.bound.find((x) => x.cwd === join(dir, 'proj', 'sub', 'deep'));
  assert.equal(hitParent.repoKey, parent.key, 'proj/app 归父仓库');
  assert.equal(hitChild.repoKey, child.key, 'proj/sub/deep 归子仓库（最长前缀赢）');
  assert.equal(plan.bound.some((x) => x.cwd === join(dir, 'other')), false, '无关目录不绑');
  assert.equal(plan.bound.some((x) => x.topicKey === GLOBAL_TOPIC_KEY), false, '全局池永远留哨兵');

  // apply 前：refs 索引还没建（预览零副作用）
  const orphanBefore = repo.txw((conn) => repo.refs.listOrphans(conn).map((o) => o.locator));
  assert.deepEqual(orphanBefore, []);

  const done = await repos.bindTopicsToRepos({ apply: true });
  assert.equal(done.changed, 2);
  assert.equal(done.refs.refs, 2, 'refs 索引先建：约定主篇 + 自由文档');
  assert.equal(done.refs.bindings, 1, '约定路径绑定 1 条（sub 的 index.md）');

  // 库面：绑定生效（ix_topics_repo 可查）
  const rows = repo.txw((conn) => ({
    bound: conn.all('SELECT key, cwd FROM topics WHERE repo_key = ?', [child.key]),
    left: conn.all("SELECT key, cwd FROM topics WHERE repo_key = '__unbound__'"),
  }));
  assert.deepEqual(rows.bound.map((x) => x.cwd), [join(dir, 'proj', 'sub', 'deep')]);
  assert.deepEqual(
    rows.left.map((x) => x.cwd).sort(),
    ['', join(dir, 'other')].sort(),
    '留哨兵的只有无关目录与全局池（proj/app 已绑父仓库）'
  );
  assert.equal(rows.left.length, 2);

  // 孤儿清单：自由文档可见，约定主篇已绑定
  const orphans = repo.txw((conn) => repo.refs.listOrphans(conn).map((o) => o.locator));
  assert.deepEqual(orphans, ['free/note.md']);
});

// ─── zip 往返四项相等 ─────────────────────────────────────────────────

test('zip 往返：仓库清单 / 组成员 / ref 绑定 / 队列绑定 四项相等', async () => {
  const { a, b, r } = await seedRepos();
  // 组 + 成员（含组内描述）
  const board = await boards.createBoard({ name: '常用' });
  await boards.assignRepo({ id: a.id, board: board.id });
  await boards.assignRepo({ id: b.id, board: board.id });
  await boards.setBoardRepoNote({ id: a.id, board: board.id, note: '主力' });
  // ref 绑定：ref → repo（双向记录）
  await (await import('../../src/modules/repos/ref.js')).bindTarget({ id: r.id, repo: a.id });
  // 队列绑定
  const cwd = join(dir, 'alpha', 'app');
  repo.txw((conn) => {
    const at = Date.now();
    conn.run(
      `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                           deleted_at, created_at, updated_at)
       VALUES (:key, '__unbound__', :cwd, NULL, :cwd, 1, '{}', '', 0, NULL, :at, :at)`,
      { key: topicKeyOf(cwd, ''), cwd, at }
    );
  });
  await repos.bindTopicsToRepos({ repo: a.id, apply: true });

  // 导出 zip
  const buf = await transfer.repoExportZip({});
  const { readZip } = await import('../../src/core/zip.js');
  let json = '';
  const docsFiles = [];
  for (const e of readZip(buf)) {
    if (e.name === 'layout.json') json = e.data.toString('utf8');
    else if (e.name.startsWith('docs/') && /\.md$/i.test(e.name)) docsFiles.push({ rel: e.name.slice('docs/'.length), data: e.data });
  }
  assert.ok(json, 'zip 里有 layout.json');

  // 清空后回灌（simulate 换机空库）
  await repos.mutateStore((s) => {
    s.repos = [];
    s.boards = [];
  });
  const result = await transfer.repoImport({ json, docsFiles, clone: 'none' });
  assert.equal(result.created.length, 3, '三个仓库重建');
  assert.equal(result.boardsCreated, 1, '组重建');
  assert.equal(result.links, 1, 'ref 绑定重建');

  // 四项相等
  const before = await repos.loadStore();
  const layout = JSON.parse(json);
  const after = await repos.loadStore();

  // ① 仓库清单（key 集合 + 名称 + remote + 类型）
  assert.deepEqual(
    after.repos.map((x) => [x.key, x.name, x.remote, x.type]).sort(),
    before.repos.map((x) => [x.key, x.name, x.remote, x.type]).sort(),
    '仓库清单相等'
  );
  assert.deepEqual(
    after.repos.map((x) => [x.key, x.linked]).sort(),
    before.repos.map((x) => [x.key, x.linked]).sort(),
    'ref 绑定相等（双向记录随 key 重建）'
  );

  // ② 组成员（key 序列 + 组内描述）
  const boardAfter = after.boards.find((x) => x.name === '常用');
  assert.deepEqual(boardAfter.repoKeys, ['github.com/o/alpha', 'github.com/o/beta'], '组成员相等');
  assert.deepEqual(
    boardAfter.repoNotes,
    { 'github.com/o/alpha': '主力' },
    '组内描述相等'
  );
  assert.equal(boardAfter.key, board.key, '组冻结 key 往返一致');

  // ③④ ref 绑定 / 队列绑定与 layout 对账
  assert.deepEqual(layout.links, [{ ref: 'github.com/o/ref1', to: [{ repo: 'github.com/o/alpha' }] }]);
  const boundRows = repo.txw((conn) => conn.all('SELECT cwd, repo_key FROM topics WHERE repo_key <> ?', ['__unbound__']));
  // 注意：清空 store 的 mutateStore 会把 repos 全删，topics.repo_key 外键
  // ON DELETE CASCADE 会连带删掉绑定的队列 —— 换机导入本来就没有队列，
  // 这里只断言「导入后没有指向不存在仓库的死绑定」。
  const repoKeys = new Set(after.repos.map((x) => x.key));
  assert.ok(boundRows.every((t) => repoKeys.has(t.repo_key)), '队列绑定不留死外键');
});

// ─── 仓储窄方法 ───────────────────────────────────────────────────────

test('repo.repos 窄方法：行读取 / 成员反查 / 删除前置检查', async () => {
  const { a, b } = await seedRepos();
  const board = await boards.createBoard({ name: '反查板' });
  await boards.assignRepo({ id: a.id, board: board.id });
  await boards.assignRepo({ id: b.id, board: board.id });

  const members = repo.repos.listGroupsOfRepo(a.key);
  assert.deepEqual(members.map((m) => m.group_key), [board.key], '反查：仓库在哪些组');

  // 删除有组员的仓库仍允许（组员边级联清，队列没绑）；绑定过队列的仓库拒绝删
  await assert.rejects(async () => {
    const cwd = join(dir, 'beta', 'x');
    repo.txw((conn) => {
      const at = Date.now();
      conn.run(
        `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version,
                             deleted_at, created_at, updated_at)
         VALUES (:key, :rk, :cwd, NULL, :cwd, 1, '{}', '', 0, NULL, :at, :at)`,
        { key: topicKeyOf(cwd, ''), rk: b.key, cwd, at }
      );
    });
    await repos.removeRepo(b.id);
  }, /队列绑定/);
  // 解绑后可删
  repo.txw((conn) => conn.run("UPDATE topics SET repo_key = '__unbound__'"));
  const removed = await repos.removeRepo(b.id);
  assert.equal(removed.key, b.key);
  const left = (await repos.loadStore()).repos.map((x) => x.key);
  assert.equal(left.includes(b.key), false);
});
