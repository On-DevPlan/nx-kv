// 参考仓库（type=ref）的单元测试：
// remote key 归一 / type 双态登记与查重 / 绑定与联动清理 / 同步与检查 / 布局导入导出。
// 存储走 NX_KV_REPOS_STORE 指到的临时文件；git 集成点用本地裸仓库（无网络依赖）。
//
// config（gitRepoRoot / gitDevRoot）走 NX_KV_CONFIG 指到的临时文件。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as ref from '../../src/modules/repos/ref.js';
import * as transfer from '../../src/modules/repos/transfer.js';
import { closeDb } from '../../src/core/db/index.js';  // T05：库化后测试清理要先关连接（Windows rmSync 否则 EBUSY）

let dir = '';
let cfgDir = '';

// 本机有 git 才跑 git 集成点（CI 裸环境不至于红一片）
const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// git 命令的免配置包装（不依赖全局 user.email/user.name）
const git = (args, cwd) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-ref-'));
  cfgDir = mkdtempSync(join(tmpdir(), 'nx-kv-refcfg-'));
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

// ─── normalizeRemoteKey ─────────────────────────────────────────────────

test('normalizeRemoteKey：SSH/HTTPS/带尾.git/大小写 归一成同一个 key', () => {
  const k = repos.normalizeRemoteKey('git@github.com:Me/My-Repo.git');
  assert.equal(k, repos.normalizeRemoteKey('https://github.com/me/my-repo'));
  assert.equal(k, repos.normalizeRemoteKey('https://github.com/me/my-repo.git'));
  assert.equal(k, repos.normalizeRemoteKey('https://github.com/Me/MY-REPO/'));
  assert.notEqual(k, repos.normalizeRemoteKey('https://github.com/other/my-repo.git'));
  assert.equal(repos.normalizeRemoteKey(''), '');
});

test('dirnameFromRemote：取末段剥 .git', () => {
  assert.equal(repos.dirnameFromRemote('git@github.com:me/my-repo.git'), 'my-repo');
  assert.equal(repos.dirnameFromRemote('https://github.com/me/x/'), 'x');
});

// ─── type 双态与 remote 查重 ────────────────────────────────────────────

test('登记 ref：type/remote 落库；同 remoteKey 重复登记 → conflict（SSH/HTTPS 写法不同也算同源）', async () => {
  const a = await repos.addRepo({
    path: join(dir, 'lib-a'),
    name: 'lib-a',
    type: 'ref',
    remote: 'git@github.com:lib/a.git',
  });
  assert.equal(a.type, 'ref');
  assert.equal(a.remote, 'git@github.com:lib/a.git');

  await assert.rejects(
    () => repos.addRepo({ path: join(dir, 'lib-a2'), type: 'ref', remote: 'https://github.com/lib/a.git' }),
    /已被仓库/
  );
  // dev 一样受 remoteKey 查重约束（remote 是全局唯一 key，不只是 ref 内部）
  await assert.rejects(
    () => repos.addRepo({ path: join(dir, 'lib-a3'), remote: 'https://github.com/LIB/A' }),
    /已被仓库/
  );
  // 无 remote 的 dev 不受影响
  const dev = await repos.addRepo({ path: join(dir, 'dev-x'), name: 'dev-x', key: 'local/dev-x' });
  assert.equal(dev.type, 'dev');
  assert.equal(dev.remote, '');
});

test('updateRepo：type 转回 dev 时清空 linked 与所有组级绑定；remote 改成别人占用的 → conflict', async () => {
  // 非自定义 key（由 remote 派生）才会跟随 remote 重算——这正是会撞车的场景。
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', remote: 'https://github.com/x/d1.git' });
  const b = await boards.createBoard({ name: 'g1' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, repo: dev.id, board: b.id });
  assert.equal((await boards.getBoard(b.id)).refs.length, 1);
  assert.equal((await repos.getRepo(dev.id)).linked.length, 1);

  await repos.updateRepo(r.id, { type: 'dev' });
  const after = await repos.getRepo(r.id);
  assert.equal(after.type, 'dev');
  assert.deepEqual(after.linked, []);
  assert.deepEqual((await boards.getBoard(b.id)).refs, []);
  assert.deepEqual((await repos.getRepo(dev.id)).linked, [], '指向它的仓库级绑定也要摘掉');

  await assert.rejects(
    () => repos.updateRepo(dev.id, { remote: 'https://github.com/x/r1.git' }),
    /已被仓库/
  );
});

// ─── 绑定与联动清理 ─────────────────────────────────────────────────────

test('bind：--board 写组级、--repo 写仓库级；两类并存、幂等不重复', async () => {
  const d1 = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const d2 = await repos.addRepo({ path: join(dir, 'd2'), name: 'd2', key: 'local/d2' });
  const b1 = await boards.createBoard({ name: 'fr' });
  await boards.assignRepo({ id: d1.id, board: b1.id });
  await boards.assignRepo({ id: d2.id, board: b1.id });
  const r1 = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  const r2 = await repos.addRepo({ path: join(dir, 'r2'), name: 'r2', type: 'ref', remote: 'https://github.com/x/r2.git' });
  const r1Key = repos.deriveKey(r1);
  const r2Key = repos.deriveKey(r2);

  await ref.bindTarget({ id: r1.id, repo: [d1.id, 'd2'], board: b1.id }); // 名称也能认
  await ref.bindTarget({ id: r1.id, repo: d1.id }); // 幂等（同一仓库）
  await ref.bindTarget({ id: r2.id, repo: d1.id });

  // 组级只落 group_refs（--repo 不折算成组）
  const got = await boards.getBoard(b1.id);
  assert.deepEqual(got.refs.map((x) => x.id), [r1Key]);
  // 仓库级只落各仓库自己的 linked
  assert.deepEqual((await repos.getRepo(d1.id)).linked.map((x) => x.id).sort(), [r1Key, r2Key].sort());
  assert.deepEqual((await repos.getRepo(d2.id)).linked.map((x) => x.id), [r1Key]);

  // dev 上 ref 绑定会报「不是参考仓库」
  await assert.rejects(() => ref.bindTarget({ id: d1.id, repo: d2.id }), /不是参考仓库/);
  // 仓库级绑定不需要组：不属于任何组的仓库也能直接绑
  const orphan = await repos.addRepo({ path: join(dir, 'orphan'), name: 'orphan', key: 'local/orphan' });
  await ref.bindTarget({ id: r1.id, repo: orphan.id });
  assert.deepEqual((await repos.getRepo(orphan.id)).linked.map((x) => x.id), [r1Key]);
});

test('摘绑定：--remove 按维度摘（仓库/组），都不带 = 两类全清；目标不存在显式报错', async () => {
  const d1 = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const d2 = await repos.addRepo({ path: join(dir, 'd2'), name: 'd2', key: 'local/d2' });
  const b1 = await boards.createBoard({ name: 'g1' });
  const b2 = await boards.createBoard({ name: 'g2' });
  await boards.assignRepo({ id: d1.id, board: b1.id });
  await boards.assignRepo({ id: d2.id, board: b2.id });
  const r1 = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r1.id, repo: [d1.id, d2.id], board: [b1.id, b2.id] });
  assert.equal((await boards.getBoard(b1.id)).refs.length, 1);
  assert.equal((await boards.getBoard(b2.id)).refs.length, 1);
  assert.equal((await repos.getRepo(d1.id)).linked.length, 1);
  assert.equal((await repos.getRepo(d2.id)).linked.length, 1);

  // 只摘仓库维度：组级不受影响
  await ref.bindTarget({ id: r1.id, remove: true, repo: d1.id });
  assert.deepEqual((await repos.getRepo(d1.id)).linked, []);
  assert.equal((await boards.getBoard(b1.id)).refs.length, 1);

  // 只摘组维度：仓库级不受影响
  await ref.bindTarget({ id: r1.id, remove: true, board: b2.id });
  assert.deepEqual((await boards.getBoard(b2.id)).refs, []);
  assert.equal((await repos.getRepo(d2.id)).linked.length, 1);

  // 都不带 = 两类全清
  await ref.bindTarget({ id: r1.id, remove: true });
  assert.deepEqual((await boards.getBoard(b1.id)).refs, []);
  assert.deepEqual((await repos.getRepo(d2.id)).linked, []);

  await assert.rejects(() => ref.bindTarget({ id: r1.id, repo: join(dir, 'nope') }), /不存在/);
});

test('联动清理：删看板 → 组级绑定清；参考仓库转 dev → 从各组摘除', async () => {
  const d1 = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b1 = await boards.createBoard({ name: 'fr' });
  await boards.assignRepo({ id: d1.id, board: b1.id });
  const r1 = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r1.id, board: b1.id });

  await boards.removeBoard(b1.id);
  const c = await ref.checkRefs();
  assert.ok(!c.extraIssues.some((i) => /board\/fr/.test(i)), c.extraIssues);

  const b2 = await boards.createBoard({ name: 'fr2' });
  await boards.assignRepo({ id: d1.id, board: b2.id });
  await ref.bindTarget({ id: r1.id, board: b2.id });
  assert.equal((await boards.getBoard(b2.id)).refs.length, 1);
  await repos.updateRepo(r1.id, { type: 'dev' });
  assert.deepEqual((await boards.getBoard(b2.id)).refs, []);
});

// ─── checkRefs（零副作用）───────────────────────────────────────────────

test('checkRefs：目录缺失 显式报 issue；组级与仓库级绑定分别列出', async () => {
  const d1 = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b1 = await boards.createBoard({ name: 'g1' });
  await boards.assignRepo({ id: d1.id, board: b1.id });
  const ok = await repos.addRepo({ path: join(dir, 'ref-ok'), name: 'ref-ok', type: 'ref', remote: 'https://github.com/x/ok.git' });
  await repos.addRepo({ path: join(dir, 'ref-gone'), name: 'ref-gone', type: 'ref', remote: 'https://github.com/x/gone.git' });
  await ref.bindTarget({ id: ok.id, repo: d1.id, board: b1.id });

  const c = await ref.checkRefs();
  const byName = new Map(c.refRepos.map((x) => [x.name, x]));
  assert.ok(byName.get('ref-ok').issues.some((i) => /目录不存在/.test(i)));
  assert.ok(byName.get('ref-gone').issues.some((i) => /目录不存在/.test(i)));
  assert.deepEqual(byName.get('ref-ok').groups.map((g) => g.name), ['g1']);
  assert.deepEqual(byName.get('ref-ok').repos.map((x) => x.name), ['d1']);
  assert.deepEqual(byName.get('ref-gone').repos, []);
  assert.deepEqual(c.extraIssues, []);
  assert.equal(c.problems, 2);
});

// ─── git 集成点：本地裸仓库 clone / sync / check ───────────────────────

if (hasGit) {
  test('cloneRef（本地 file 源）：clone 落到 gitRepoRoot、登记带 remote、绑定生效', async () => {
    // 造一个本地源仓库（带一次提交）
    const src = join(dir, 'src-origin');
    mkdirSync(src);
    git(['init', '-q', '--initial-branch=main'], src);
    writeFileSync(join(src, 'README.md'), '# src\n');
    git(['add', '.'], src);
    git(['commit', '-qm', 'init'], src);

    // 设置 gitRepoRoot
    const root = join(dir, 'refroot');
    const { saveConfig } = await import('../../src/core/config.js');
    await saveConfig({ gitRepoRoot: root });

    const dev = await repos.addRepo({ path: join(dir, 'dev-host'), name: 'dev-host', key: 'local/dev-host' });
    const g = await boards.createBoard({ name: 'g-clone' });
    await boards.assignRepo({ id: dev.id, board: g.id });

    const r = await ref.cloneRef({
      url: 'file://' + src.replace(/\\/g, '/'),
      name: 'src-ref',
      desc: '测试参考',
      bind: [dev.name], // 用名称绑定 → 仓库级直接绑定（不折算成组）
      noBind: true, // 关掉 autoBind（测试进程 cwd 不在开发仓库里，绑了也无妨；显式给 bind）
    });
    assert.equal(r.name, 'src-ref');
    assert.ok(existsSync(join(r.dest, '.git')));
    assert.ok(repos.normalizeRemoteKey(r.remote));

    // 登记在册 + 绑定落到仓库级（组上没有，因为没给 --board）
    const got = await repos.getRepo(r.id);
    assert.equal(got.type, 'ref');
    assert.deepEqual((await boards.getBoard(g.id)).refs, []);
    assert.deepEqual((await repos.getRepo(dev.id)).linked.map((x) => x.id), [repos.deriveKey(got)]);
    assert.deepEqual(r.groups, []);
    assert.deepEqual(r.repos, [dev.name]);

    // 同源重复 clone → conflict 提示已登记
    await assert.rejects(
      () => ref.cloneRef({ url: 'file://' + src.replace(/\\/g, '/'), noBind: true }),
      /已登记/
    );

    // sync：刚 clone 的 upToDate（或 updated，取决于 git 版本文案）
    const s = await ref.syncRef(r.id);
    assert.ok(['updated', 'upToDate'].includes(s.status), 'sync status: ' + s.status);

    // check：目录在、.git 在、origin key 与登记一致 → ok
    const c = await ref.checkRefs();
    const mine = c.refRepos.find((x) => x.id === r.id);
    assert.equal(mine.ok, true, JSON.stringify(mine.issues));
  });

  test('gitClone：坏 URL 走 external（EXIT 错误码 EXTERNAL），SSH/HTTPS 都失败时带双通道输出', async () => {
    const root = join(dir, 'refroot2');
    const { saveConfig } = await import('../../src/core/config.js');
    await saveConfig({ gitRepoRoot: root });
    await assert.rejects(
      () => ref.cloneRef({ url: 'file://' + join(dir, 'definitely-not-exist').replace(/\\/g, '/'), noBind: true }),
      (err) => {
        assert.ok(/克隆失败/.test(err.message));
        return true;
      }
    );
  });

  test('registerRef：登记已存在的 checkout；origin 缺失且无 --remote → 显式报错', async () => {
    const src = join(dir, 'src-origin2');
    mkdirSync(src);
    git(['init', '-q', '--initial-branch=main'], src);
    writeFileSync(join(src, 'f.txt'), 'x');
    git(['add', '.'], src);
    git(['commit', '-qm', 'init'], src);

    // 无 origin、无 --remote → 报错（目录是 git 仓库但 origin 没配）
    await assert.rejects(() => ref.registerRef({ path: src }), /origin/);

    // 给 --remote 就能登记
    const r = await ref.registerRef({ path: src, remote: 'https://github.com/me/src-origin2.git', name: 'src2' });
    assert.equal(r.type, 'ref');
    assert.equal(r.remote, 'https://github.com/me/src-origin2.git');
  });
}

// ─── 布局导入导出 ───────────────────────────────────────────────────────

test('repoExport：以 key 为身份、不含本地路径；dev 无 remote 进 warnings；boards/links 用 key 引用', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'dev'), name: 'dev-app', desc: '主应用', remote: 'git@github.com:me/dev-app.git' });
  const plainDev = await repos.addRepo({ path: join(dir, 'plain'), name: 'plain', key: 'local/plain', desc: '无远程' });
  const ref1 = await repos.addRepo({ path: join(dir, 'ref1'), name: 'ref1', type: 'ref', remote: 'https://github.com/lib/ref1.git', desc: '参考一' });
  const b1 = await boards.createBoard({ name: 'fr', desc: '领域一' });
  await boards.assignRepo({ id: dev.id, board: b1.id });
  await boards.setBoardRepoNote({ id: dev.id, board: b1.id, note: '契约方' });
  await ref.bindTarget({ id: ref1.id, repo: dev.id, board: b1.id });

  const d = await transfer.repoExport();
  const text = JSON.stringify(d);
  assert.ok(!text.includes(join(dir, 'dev')), '导出不得含本地路径');
  assert.ok(!text.includes('"path"'), '导出不得出现 path 字段');
  assert.equal(d.version, 4); // v4：zip 纳入自有文档树，layout 带 DocRef 绑定

  const devOut = d.repos.find((x) => x.name === 'dev-app');
  assert.equal(devOut.key, 'github.com/me/dev-app');
  assert.equal(devOut.remote, 'git@github.com:me/dev-app.git');
  assert.equal(devOut.type, 'dev');
  // 无 remote 的 dev：key 走 local/ 兜底，且进 warnings
  const plainOut = d.repos.find((x) => x.name === 'plain');
  assert.equal(plainOut.key, 'local/plain');
  assert.ok(!plainOut.remote);
  assert.ok(d.warnings.some((w) => /plain/.test(w)));

  const bOut = d.boards.find((x) => x.name === 'fr');
  assert.equal(bOut.key, 'board/fr');
  assert.deepEqual(bOut.repos[0], { key: 'github.com/me/dev-app', note: '契约方' });

  const link = d.links.find((x) => x.ref === 'github.com/lib/ref1');
  assert.ok(link);
  // 组级与仓库级并列导出（同一个 ref 一条 link，两类目标都在 to 里）
  assert.deepEqual(link.to.map((t) => t.repo || t.board).sort(), ['board/fr', 'github.com/me/dev-app'].sort());
  assert.ok(ref1.id && plainDev.id);
});

test('repoImport：diff 零副作用；执行后登记/克隆/看板/关系按 key 重建', async () => {
  if (!hasGit) return;
  // 源仓库
  const src = join(dir, 'imp-origin');
  mkdirSync(src);
  git(['init', '-q', '--initial-branch=main'], src);
  writeFileSync(join(src, 'a.md'), 'a');
  git(['add', '.'], src);
  git(['commit', '-qm', 'init'], src);
  const srcUrl = 'file://' + src.replace(/\\/g, '/');

  // 已存在一个开发仓库 + 看板（导入时应识别为「一致/合并」）
  const dev = await repos.addRepo({ path: join(dir, 'my-dev'), name: 'my-dev', remote: 'git@github.com:me/my-dev.git' });
  const existingBoard = await boards.createBoard({ name: 'grp', desc: '新领域描述' });

  const layout = {
    version: 3,
    repos: [
      { key: 'github.com/me/my-dev', name: 'my-dev', type: 'dev', remote: 'git@github.com:me/my-dev.git' },
      { key: repos.keyFromRemote(srcUrl), name: 'imp-ref', desc: '导入的参考', type: 'ref', remote: srcUrl },
      { key: 'local/orphan-dev', name: 'orphan-dev', desc: '无远程地址的', type: 'dev' },
    ],
    boards: [{
      key: 'board/grp',
      name: 'grp',
      desc: '新领域描述',
      repos: [{ key: 'github.com/me/my-dev', note: '中心' }, { key: repos.keyFromRemote(srcUrl) }],
    }],
    links: [{ ref: repos.keyFromRemote(srcUrl), to: [{ repo: 'github.com/me/my-dev' }, { board: 'board/grp' }] }],
  };
  const json = JSON.stringify(layout);

  // gitRepoRoot 先设好（克隆要落点）
  const root = join(dir, 'imp-root');
  const { saveConfig } = await import('../../src/core/config.js');
  await saveConfig({ gitRepoRoot: root });

  // diff：零副作用
  const d = await transfer.diffImport(json);
  assert.equal(d.repos.find((x) => x.key === 'github.com/me/my-dev').status, 'same');
  const pRef = d.repos.find((x) => x.key === repos.keyFromRemote(srcUrl));
  assert.equal(pRef.status, 'new');
  assert.equal(pRef.canClone, true);
  assert.equal(d.repos.find((x) => x.key === 'local/orphan-dev').status, 'new');
  assert.equal(d.boards.find((b) => b.key === 'board/grp').status, 'same');
  // store 未动
  assert.equal((await repos.listRepos()).length, 1);

  // 执行：clone ref（gitRepoRoot 已设），dev 不克隆（clone=ref），orphan 只登记
  const result = await transfer.repoImport({ json, clone: 'ref' });
  // 失败时把 warnings/skipped 一起带出来 —— 导入的失败都落在这两个数组里，
  // 光看「created=0」看不出是哪一步炸的。
  assert.deepEqual(result.warnings, [], '导入不该有告警');
  assert.equal(result.created.length, 2, `imp-ref + orphan-dev（skipped=${JSON.stringify(result.skipped)}）`);
  assert.equal(result.boardsMerged, 1);   // grp 合并
  assert.equal(result.cloned.length, 1);
  assert.equal(result.links, 2);
  // 登记齐了，关系重建了
  const all = await repos.listRepos();
  assert.equal(all.length, 3);
  const importedRef = all.find((x) => x.name === 'imp-ref');
  assert.equal(importedRef.type, 'ref');
  assert.ok(existsSync(join(importedRef.path, '.git')));
  // 看板成员与组内描述重建（成员按 key 关联）
  const g = await boards.getBoard(existingBoard.id);
  assert.equal(g.desc, '新领域描述');
  assert.equal(g.repos.length, 2);
  assert.equal(g.repos.find((x) => x.key === dev.key).note, '中心');
  assert.ok(g.repos.find((x) => x.key === repos.keyFromRemote(srcUrl)));
  // 关系重建：to.board → 组级；to.repo → 该仓库的仓库级直接绑定（两类并存）
  assert.deepEqual(g.refs.map((x) => x.id), [repos.keyFromRemote(srcUrl)]);
  assert.deepEqual(
    (await repos.getRepo(dev.id)).linked.filter((l) => l.kind === 'ref').map((x) => x.id),
    [repos.keyFromRemote(srcUrl)]
  );
});

test('repoImport：--select 白名单只处理指定 key', async () => {
  const layout = {
    version: 3,
    repos: [
      { key: 'github.com/a/one', name: 'one', type: 'ref', remote: 'https://github.com/a/one.git' },
      { key: 'github.com/a/two', name: 'two', type: 'ref', remote: 'https://github.com/a/two.git' },
    ],
    boards: [],
    links: [],
  };
  const root = join(dir, 'only-root');
  const { saveConfig } = await import('../../src/core/config.js');
  await saveConfig({ gitRepoRoot: root });
  const result = await transfer.repoImport({ json: JSON.stringify(layout), selection: ['github.com/a/two'], clone: 'none' });
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].key, 'github.com/a/two');
  const all = await repos.listRepos();
  assert.ok(!all.some((r) => r.key === 'github.com/a/one'));
});

test('绑定两类互不覆盖：--repo 只写仓库级、--board 只写组级；描述与摘绑按维度', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b = await boards.createBoard({ name: 'g1' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  const refKey = repos.deriveKey(r);

  await ref.bindTarget({ id: r.id, repo: [{ id: dev.name, note: '仓库级描述' }] });
  assert.deepEqual((await repos.getRepo(dev.id)).linked, [{ kind: 'ref', id: refKey, note: '仓库级描述' }]);
  assert.deepEqual((await boards.getBoard(b.id)).refs, [], '仓库级绑定不写组');
  assert.deepEqual((await repos.getRepo(r.id)).linked, [], '参考仓库自身不写 linked');

  await ref.bindTarget({ id: r.id, board: [{ id: b.name, note: '组级描述' }] });
  assert.deepEqual((await boards.getBoard(b.id)).refs, [{ id: refKey, note: '组级描述' }]);
  assert.equal((await repos.getRepo(dev.id)).linked.length, 1, '组级绑定不动仓库级');

  await ref.setLinkNote({ id: r.id, board: b.id, note: '改过的组级描述' });
  await ref.setLinkNote({ id: r.id, repo: dev.id, note: '改过的仓库级描述' });
  assert.equal((await boards.getBoard(b.id)).refs[0].note, '改过的组级描述');
  assert.equal((await repos.getRepo(dev.id)).linked[0].note, '改过的仓库级描述');

  await ref.bindTarget({ id: r.id, remove: true, repo: dev.id });
  assert.deepEqual((await repos.getRepo(dev.id)).linked, []);
  assert.equal((await boards.getBoard(b.id)).refs.length, 1, '摘仓库级不影响组级');
});

test('删除开发仓库不影响组级参考；删除参考仓库 → 从所有组与仓库级绑定摘除（不留死链）', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const other = await repos.addRepo({ path: join(dir, 'd2'), name: 'd2', key: 'local/d2' });
  const b = await boards.createBoard({ name: 'g1' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, repo: [dev.id, other.id], board: b.id });

  await repos.removeRepo(dev.id);
  assert.equal((await boards.getBoard(b.id)).refs.length, 1, '组还在，参考绑定不受成员删除影响');
  assert.deepEqual((await repos.getRepo(other.id)).linked.map((x) => x.id), [repos.deriveKey(r)]);

  await repos.removeRepo(r.id);
  assert.deepEqual((await boards.getBoard(b.id)).refs, []);
  assert.deepEqual((await repos.getRepo(other.id)).linked, []);
  const c = await ref.checkRefs();
  assert.ok(!c.extraIssues.some((i) => /已不存在/.test(i)), JSON.stringify(c.extraIssues));
});

test('repoImport：坏 JSON / 缺 repos 数组 → badInput', async () => {
  await assert.rejects(() => transfer.repoImport({ json: '{oops' }), /解析失败/);
  await assert.rejects(() => transfer.repoImport({ json: '{"boards":[]}' }), /repos 数组/);
});

// ─── 绑定描述（link note）与分层查询 ────────────────────────────────────

test('setLinkNote：组级/仓库级描述各写各的；未绑定显式报错；随摘绑一起消失', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b1 = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.id, board: b1.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, repo: dev.id, board: b1.id });

  // 仓库级描述
  await ref.setLinkNote({ id: r.id, repo: dev.id, note: '画布交互参考\n搜 registerExtension' });
  assert.equal((await repos.getRepo(dev.id)).linked[0].note, '画布交互参考\n搜 registerExtension');
  // 组级描述
  await ref.setLinkNote({ id: r.id, board: b1.id, note: '组级契约' });
  assert.equal((await boards.getBoard(b1.id)).refs[0].note, '组级契约');

  // 同 repo + board 一起给 = 报错（一条绑定一条描述）
  await assert.rejects(() => ref.setLinkNote({ id: r.id, repo: dev.id, board: b1.id, note: 'x' }), /只能选一/);
  // 未绑定的组/仓库 = 显式报错，不静默挂空
  const b2 = await boards.createBoard({ name: 'grp2' });
  await assert.rejects(() => ref.setLinkNote({ id: r.id, board: b2.id, note: 'x' }), /未绑定/);
  const d2 = await repos.addRepo({ path: join(dir, 'd2'), name: 'd2', key: 'local/d2' });
  await assert.rejects(() => ref.setLinkNote({ id: r.id, repo: d2.id, note: 'x' }), /未直接绑定/);

  // note 留空 = 清除；摘绑 = 描述一起消失
  await ref.setLinkNote({ id: r.id, board: b1.id, note: '' });
  assert.equal((await boards.getBoard(b1.id)).refs[0].note, undefined);
  await ref.bindTarget({ id: r.id, remove: true, repo: dev.id });
  assert.deepEqual((await repos.getRepo(dev.id)).linked, []);
  assert.equal((await boards.getBoard(b1.id)).refs.length, 1, '组级那条还在');
});

test('bindTarget 带 note：绑定时一并写描述；重复绑定时补写描述', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b = await boards.createBoard({ name: 'g1' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, board: [{ id: b.name, note: '首次绑定的描述' }] });
  let got = await boards.getBoard(b.id);
  assert.equal(got.refs[0].note, '首次绑定的描述');
  // 已绑定：再给 note = 补写
  await ref.bindTarget({ id: r.id, board: [{ id: b.name, note: '补充后的描述' }] });
  got = await boards.getBoard(b.id);
  assert.equal(got.refs.length, 1, '幂等不重复');
  assert.equal(got.refs[0].note, '补充后的描述');
});

test('refReposOfRepo：仓库级直接绑定 + 所属组的组级绑定，两类并列', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const other = await repos.addRepo({ path: join(dir, 'd2'), name: 'd2', key: 'local/d2' });
  const b1 = await boards.createBoard({ name: 'grp', desc: '领域一' });
  const b2 = await boards.createBoard({ name: 'grp2' });
  await boards.assignRepo({ id: dev.id, board: b1.id });
  await boards.assignRepo({ id: dev.id, board: b2.id });
  await boards.assignRepo({ id: other.id, board: b2.id });

  const groupRef = await repos.addRepo({ path: join(dir, 'rg'), name: 'rg', type: 'ref', remote: 'https://github.com/x/rg.git' });
  const stranger = await repos.addRepo({ path: join(dir, 'rs'), name: 'rs', type: 'ref', remote: 'https://github.com/x/rs.git' });
  await ref.bindTarget({ id: groupRef.id, board: b1.id, repo: dev.id });
  await ref.setLinkNote({ id: groupRef.id, board: b1.id, note: '组级参考' });
  await ref.setLinkNote({ id: groupRef.id, repo: dev.id, note: '仓库级参考' });
  await ref.bindTarget({ id: stranger.id, board: b2.id });

  // 按 id / 名称 / 路径都能查
  for (const key of [dev.id, 'd1', join(dir, 'd1')]) {
    const d = await ref.refReposOfRepo(key);
    assert.equal(d.repo.id, dev.id);
    assert.deepEqual(d.direct.map((x) => x.name), ['rg']);
    assert.equal(d.direct[0].note, '仓库级参考');
    assert.deepEqual(d.boards.map((x) => x.name).sort(), ['grp', 'grp2']);
    const g1 = d.boards.find((x) => x.name === 'grp');
    assert.deepEqual(g1.refRepos.map((x) => x.name), ['rg']);
    assert.equal(g1.refRepos[0].note, '组级参考');
    const g2 = d.boards.find((x) => x.name === 'grp2');
    assert.deepEqual(g2.refRepos.map((x) => x.name), ['rs']);
  }

  // 无组仓库：仓库级直接绑定照样可见，组级为空
  const orphan = await repos.addRepo({ path: join(dir, 'orphan'), name: 'orphan', key: 'local/orphan' });
  await ref.bindTarget({ id: groupRef.id, repo: [{ id: 'local/orphan', note: '无组直绑' }] });
  const od = await ref.refReposOfRepo(orphan.id);
  assert.deepEqual(od.boards, []);
  assert.deepEqual(od.direct.map((x) => x.name), ['rg']);
  assert.equal(od.direct[0].note, '无组直绑');
  // checkRefs 把仓库级绑定归到对应 ref 的 repos
  const c = await ref.checkRefs();
  const rg = c.refRepos.find((x) => x.name === 'rg');
  assert.deepEqual(rg.repos.map((x) => x.name).sort(), ['d1', 'orphan']);

  // 不存在的仓库显式报错
  await assert.rejects(() => ref.refReposOfRepo('nope'), /不存在/);
});

test('refReposOfBoard：只读组上的绑定（带组级描述）', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1', key: 'local/d1' });
  const b1 = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.id, board: b1.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, board: b1.id });
  await ref.setLinkNote({ id: r.id, board: b1.id, note: '组级描述' });

  const d = await ref.refReposOfBoard(b1.id);
  assert.equal(d.refRepos.length, 1);
  assert.equal(d.refRepos[0].note, '组级描述');
  assert.equal(d.refRepos[0].via, undefined, '没有继承/多路径概念');
});

test('导出/导入携带绑定描述（link note）', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'dev'), name: 'dev', remote: 'git@github.com:me/dev.git' });
  const b = await boards.createBoard({ name: 'g1' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, board: [{ id: b.id, note: '契约参考' }] });

  const d = await transfer.repoExport();
  assert.equal(d.links[0].to[0].board, 'board/g1');
  assert.equal(d.links[0].to[0].note, '契约参考');

  // 清空重导：描述随组级关系重建
  await ref.bindTarget({ id: r.id, remove: true });
  const result = await transfer.repoImport({ json: JSON.stringify(d), clone: 'none' });
  assert.equal(result.links, 1);
  const got = await boards.getBoard(b.id);
  assert.equal(got.refs.find((x) => x.id === repos.deriveKey(r)).note, '契约参考');
});
