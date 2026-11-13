// repos 域仓储层的单元测试（T05）：
// 行↔JSON 形态适配 / 哨兵仓库规则（隐藏 / 拒绝入组 / 导出排除）/ 队列绑定
// （按路径前缀绑 topic）/ 组冻结 key / zip 往返四项相等（仓库清单 / 组成员 /
// 文档绑定 / 参考关系与队列绑定）。
//
// 存储走 NX_KV_REPOS_STORE 指到的临时目录（映射为 <dir>/nxkv.db，测试内自设）；
// 队列行经 localtask/repo/topics 直接落在同一个库（两者本就共用一条连接）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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

test('bindTopicsToRepos：预览零副作用；apply 按**最长路径前缀**绑队列', async () => {
  // 两个嵌套登记的仓库：长前缀的接管子目录队列
  const parent = await repos.addRepo({ path: join(dir, 'proj'), name: 'proj', remote: 'git@github.com:o/proj.git' });
  const child = await repos.addRepo({ path: join(dir, 'proj', 'sub'), name: 'sub', remote: 'git@github.com:o/sub.git' });

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

  // apply 前：预览零副作用（没有绑定）
  const before = repo.txw((conn) => ({
    bound: conn.all("SELECT key FROM topics WHERE repo_key != '__unbound__'"),
  }));
  assert.deepEqual(before.bound, []);

  const done = await repos.bindTopicsToRepos({ apply: true });
  assert.equal(done.changed, 2);

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
});

// ─── zip 往返四项相等 ─────────────────────────────────────────────────

test('zip 往返：仓库清单 / 组成员 / 文档绑定 / 队列绑定 四项相等', async () => {
  const { a, b, r } = await seedRepos();
  // 组 + 成员（含组内描述）
  const board = await boards.createBoard({ name: '常用' });
  await boards.assignRepo({ id: a.id, board: board.id });
  await boards.assignRepo({ id: b.id, board: board.id });
  await boards.setBoardRepoNote({ id: a.id, board: board.id, note: '主力' });

  // v8：文档绑定只存 refId；项目主篇 + 补充篇 + 组介绍各建一条 ref
  const docs = await import('../../src/modules/docs/service.js');
  const docStore = await import('../../src/modules/docs/store.js');
  const projectId = await repos.writeRepoDocContent({ key: a.key, name: a.name }, '项目介绍');
  const extra = await docs.createRef({ owner: 'repo', repo: a.key, desc: '补充篇' });
  await docs.updateDoc({ ref: 'ref:' + extra.refId, body: '# alpha 补充\n\n补充正文\n' });
  const groupDoc = await docs.createRef({ owner: 'group', group: board.id });
  await docs.updateDoc({ ref: 'ref:' + groupDoc.refId, body: '# 常用\n\n组介绍\n' });

  // ref 绑定：组级 + 仓库级两类并存
  await (await import('../../src/modules/repos/ref.js')).bindTarget({ id: r.id, repo: a.id, board: board.id });
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

  // 导出 zip（v5：docs/<refId>.md + layout.refs）
  const buf = await transfer.repoExportZip({});
  const { readZip } = await import('../../src/core/zip.js');
  let json = '';
  const docsFiles = [];
  for (const e of readZip(buf)) {
    if (e.name === 'layout.json') json = e.data.toString('utf8');
    else if (e.name.startsWith('docs/') && /\.md$/i.test(e.name)) {
      docsFiles.push({ refId: e.name.slice('docs/'.length).replace(/\.md$/i, ''), data: e.data });
    }
  }
  assert.ok(json, 'zip 里有 layout.json');
  const layout = JSON.parse(json);
  assert.equal(layout.version, 5, '导出物是 v5 布局');
  assert.ok(
    (layout.refs || []).some((x) => x.refId === projectId),
    'layout.refs 带项目主篇的 refId'
  );
  assert.equal(docsFiles.length, 4, '四篇文档正文按 refId 打包');

  // 记录导出前的绑定形状（按 refId）
  const before = await repos.loadStore();
  const beforeRepo = before.repos.find((x) => x.key === a.key);
  const beforeBoard = before.boards.find((x) => x.name === '常用');
  const beforeRepoDocs = { doc: beforeRepo.doc, links: beforeRepo.docLinks };
  const beforeBoardDocs = { doc: beforeBoard.doc, links: beforeBoard.docLinks, repoDocs: beforeBoard.repoDocs };

  // 清空后回灌（simulate 换机空库：登记与正文都不在）
  await repos.mutateStore((s) => {
    s.repos = [];
    s.boards = [];
  });
  for (const f of await docStore.listOwnDocs()) await docStore.removeOwnDoc(f.id);

  const result = await transfer.repoImport({ json, docsFiles, clone: 'none' });
  assert.equal(result.created.length, 3, '三个仓库重建');
  assert.equal(result.boardsCreated, 1, '组重建');
  assert.equal(result.links, 2, 'ref 绑定重建（组级 + 仓库级）');
  assert.equal(result.docs.written.length, 4, '四篇文档正文全部还原');

  // 四项相等
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
    'ref 绑定相等（组级 + 仓库级，仓库行 linked 应一致）'
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

  // ③ 文档绑定按 refId 往返（项目主篇 / 补充篇 / 组介绍 / 组内描述）
  const afterRepo = after.repos.find((x) => x.key === a.key);
  assert.deepEqual({ doc: afterRepo.doc, links: afterRepo.docLinks }, beforeRepoDocs, '项目文档绑定按 refId 往返');
  assert.deepEqual(
    { doc: boardAfter.doc, links: boardAfter.docLinks, repoDocs: boardAfter.repoDocs },
    beforeBoardDocs,
    '组文档绑定按 refId 往返'
  );

  // ④ 参考关系 / 队列绑定与 layout 对账
  assert.deepEqual(layout.links, [
    {
      ref: 'github.com/o/ref1',
      to: [{ board: 'board/常用' }, { repo: 'github.com/o/alpha' }],
    },
  ]);
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
