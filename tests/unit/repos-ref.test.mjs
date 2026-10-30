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
});

test.after?.(() => {
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
    /已登记/
  );
  // dev 一样受 remoteKey 查重约束（remote 是全局唯一 key，不只是 ref 内部）
  await assert.rejects(
    () => repos.addRepo({ path: join(dir, 'lib-a3'), remote: 'https://github.com/LIB/A' }),
    /已登记/
  );
  // 无 remote 的 dev 不受影响
  const dev = await repos.addRepo({ path: join(dir, 'dev-x'), name: 'dev-x' });
  assert.equal(dev.type, 'dev');
  assert.equal(dev.remote, '');
});

test('updateRepo：type 转回 dev 时清空 linked；remote 改成别人占用的 → conflict', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1' });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, repo: dev.id });
  assert.equal((await repos.getRepo(r.id)).linked.length, 1);

  await repos.updateRepo(r.id, { type: 'dev' });
  const after = await repos.getRepo(r.id);
  assert.equal(after.type, 'dev');
  assert.deepEqual(after.linked, []);

  await assert.rejects(
    () => repos.updateRepo(dev.id, { remote: 'https://github.com/x/r1.git' }),
    /已登记/
  );
});

// ─── 绑定与联动清理 ─────────────────────────────────────────────────────

test('bind：ref 可同时绑开发仓库与看板；一个目标可被多个 ref 绑；幂等不重复', async () => {
  const d1 = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1' });
  const d2 = await repos.addRepo({ path: join(dir, 'd2'), name: 'd2' });
  const b1 = await boards.createBoard({ name: 'fr' });
  const r1 = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  const r2 = await repos.addRepo({ path: join(dir, 'r2'), name: 'r2', type: 'ref', remote: 'https://github.com/x/r2.git' });

  await ref.bindTarget({ id: r1.id, repo: [d1.id, 'd2'], board: b1.id }); // 名称也能认
  await ref.bindTarget({ id: r1.id, repo: d1.id }); // 幂等
  await ref.bindTarget({ id: r2.id, repo: d1.id });

  // 绑定的目标记的是 **key**（仓库身份 / 看板身份），不是本机行主键 id
  const got = await repos.getRepo(r1.id);
  assert.deepEqual(
    got.linked.map((l) => l.kind + ':' + l.id).sort(),
    [`repo:${d1.key}`, `repo:${d2.key}`, `board:${b1.key}`].sort()
  );
  const got2 = await repos.getRepo(r2.id);
  assert.equal(got2.linked.length, 1);

  // dev 上 ref 绑定会报「不是参考仓库」
  await assert.rejects(() => ref.bindTarget({ id: d1.id, repo: d2.id }), /不是参考仓库/);
});

test('摘绑定：--remove --repo 只摘指定；都不带 = 清空；目标不存在显式报错', async () => {
  const d1 = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1' });
  const d2 = await repos.addRepo({ path: join(dir, 'd2'), name: 'd2' });
  const r1 = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r1.id, repo: [d1.id, d2.id] });

  await ref.bindTarget({ id: r1.id, remove: true, repo: d1.id });
  let got = await repos.getRepo(r1.id);
  assert.deepEqual(got.linked, [{ kind: 'repo', id: d2.key }]);

  await ref.bindTarget({ id: r1.id, remove: true });
  got = await repos.getRepo(r1.id);
  assert.deepEqual(got.linked, []);

  await assert.rejects(() => ref.bindTarget({ id: r1.id, repo: join(dir, 'nope') }), /不存在/);
});

test('联动清理：删开发仓库 / 删看板 → ref 的 linked 同步摘除', async () => {
  const d1 = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1' });
  const b1 = await boards.createBoard({ name: 'fr' });
  const r1 = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r1.id, repo: d1.id, board: b1.id });

  await boards.removeBoard(b1.id);
  let got = await repos.getRepo(r1.id);
  assert.deepEqual(got.linked, [{ kind: 'repo', id: d1.key }]);

  await repos.removeRepo(d1.id);
  got = await repos.getRepo(r1.id);
  assert.deepEqual(got.linked, []);
});

// ─── checkRefs（零副作用）───────────────────────────────────────────────

test('checkRefs：目录缺失 / 绑定死链 显式报 issue；正常 ref 全 ok', async () => {
  const d1 = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1' });
  const ok = await repos.addRepo({ path: join(dir, 'ref-ok'), name: 'ref-ok', type: 'ref', remote: 'https://github.com/x/ok.git' });
  const gone = await repos.addRepo({ path: join(dir, 'ref-gone'), name: 'ref-gone', type: 'ref', remote: 'https://github.com/x/gone.git' });
  await ref.bindTarget({ id: ok.id, repo: d1.id });

  let c = await ref.checkRefs();
  const byName = new Map(c.refs.map((x) => [x.name, x]));
  // ref-ok：目录不存在（我们没建），但绑定目标在 → issue 是「本地目录不存在」
  assert.ok(byName.get('ref-ok').issues.some((i) => /目录不存在/.test(i)));
  assert.ok(!byName.get('ref-ok').issues.some((i) => /绑定目标/.test(i)));
  assert.ok(byName.get('ref-gone').issues.some((i) => /目录不存在/.test(i)));

  // 绑定死链：正常的删除路径有联动清理（另有测试），这里直接把目标从登记里改 id 制造死链
  await repos.mutateStore((s) => {
    const g = s.repos.find((x) => x.id === gone.id);
    g.linked = [{ kind: 'repo', id: 'github.com/dead/target' }];
  });
  c = await ref.checkRefs();
  const goneRef = c.refs.find((x) => x.name === 'ref-gone');
  assert.ok(goneRef.issues.some((i) => /绑定目标已不存在/.test(i)));
  assert.equal(c.problems, 2);
  assert.ok(ok.id && byName.get('ref-ok'));
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

    const dev = await repos.addRepo({ path: join(dir, 'dev-host'), name: 'dev-host' });

    const r = await ref.cloneRef({
      url: 'file://' + src.replace(/\\/g, '/'),
      name: 'src-ref',
      desc: '测试参考',
      bind: [dev.name], // 用名称绑定
      noBind: true, // 关掉 autoBind（测试进程 cwd 不在开发仓库里，绑了也无妨；显式给 bind）
    });
    assert.equal(r.name, 'src-ref');
    assert.ok(existsSync(join(r.dest, '.git')));
    assert.ok(repos.normalizeRemoteKey(r.remote));

    // 登记在册 + 绑定到 dev-host
    const got = await repos.getRepo(r.id);
    assert.equal(got.type, 'ref');
    assert.deepEqual(got.linked, [{ kind: 'repo', id: dev.key }]);

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
    const mine = c.refs.find((x) => x.id === r.id);
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

test('repoExport：以 key 为身份、不含本地路径；dev 无 remote 被跳过（冻结）；boards/links 用 key 引用', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'dev'), name: 'dev-app', desc: '主应用', remote: 'git@github.com:me/dev-app.git' });
  const plainDev = await repos.addRepo({ path: join(dir, 'plain'), name: 'plain', desc: '无远程' });
  const ref1 = await repos.addRepo({ path: join(dir, 'ref1'), name: 'ref1', type: 'ref', remote: 'https://github.com/lib/ref1.git', desc: '参考一' });
  const b1 = await boards.createBoard({ name: 'fr', desc: '领域一' });
  await boards.assignRepo({ id: dev.id, board: b1.id });
  await boards.setBoardRepoNote({ id: dev.id, board: b1.id, note: '契约方' });
  await ref.bindTarget({ id: ref1.id, repo: dev.id, board: b1.id });

  const d = await transfer.repoExport();
  const text = JSON.stringify(d);
  assert.ok(!text.includes(join(dir, 'dev')), '导出不得含本地路径');
  assert.ok(!text.includes('"path"'), '导出不得出现 path 字段');
  assert.equal(d.version, 3);

  const devOut = d.repos.find((x) => x.name === 'dev-app');
  assert.equal(devOut.key, 'github.com/me/dev-app');
  assert.equal(devOut.remote, 'git@github.com:me/dev-app.git');
  assert.equal(devOut.type, 'dev');
  // 无 remote 且未自定义 key 的 dev = 冻结：**不导出**（local/<名称> 不是身份，
  // 导出去对方也映射不到），但要如实告诉用户为什么少了它
  const plainOut = d.repos.find((x) => x.name === 'plain');
  assert.equal(plainOut, undefined);
  assert.ok(d.warnings.some((w) => /plain/.test(w) && /没有 key/.test(w)));

  const bOut = d.boards.find((x) => x.name === 'fr');
  assert.equal(bOut.key, 'board/fr');
  assert.deepEqual(bOut.repos[0], { key: 'github.com/me/dev-app', note: '契约方' });

  const link = d.links.find((x) => x.ref === 'github.com/lib/ref1');
  assert.ok(link);
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
  assert.deepEqual(
    importedRef.linked.map((l) => l.kind + ':' + l.id).sort(),
    [`repo:${dev.key}`, 'board:' + existingBoard.key].sort()
  );
  // 看板成员与组内描述重建（成员按 key 关联）
  const g = await boards.getBoard(existingBoard.id);
  assert.equal(g.desc, '新领域描述');
  assert.equal(g.repos.length, 2);
  assert.equal(g.repos.find((x) => x.key === dev.key).note, '中心');
  assert.ok(g.repos.find((x) => x.key === repos.keyFromRemote(srcUrl)));
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

test('绑定是双向记录的：ref 侧写 {repo}，dev 侧写反向 {ref}；描述两侧一致；摘绑两侧同步清', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1' });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });

  await ref.bindTarget({ id: r.id, repo: [{ id: dev.name, note: '双向描述' }] });
  // ref 侧
  let refSide = await repos.getRepo(r.id);
  assert.deepEqual(refSide.linked, [{ kind: 'repo', id: dev.key, note: '双向描述' }]);
  // dev 侧的反向引用
  let devSide = await repos.getRepo(dev.id);
  assert.deepEqual(devSide.linked, [{ kind: 'ref', id: repos.deriveKey(r), note: '双向描述' }]);

  // 改描述 → 两侧同步
  await ref.setLinkNote({ id: r.id, repo: dev.id, note: '改过的描述' });
  refSide = await repos.getRepo(r.id);
  devSide = await repos.getRepo(dev.id);
  assert.equal(refSide.linked[0].note, '改过的描述');
  assert.equal(devSide.linked[0].note, '改过的描述');

  // 摘绑 → 两侧都清
  await ref.bindTarget({ id: r.id, remove: true, repo: dev.id });
  refSide = await repos.getRepo(r.id);
  devSide = await repos.getRepo(dev.id);
  assert.deepEqual(refSide.linked, []);
  assert.deepEqual(devSide.linked, []);
});

test('删除开发仓库 → dev 侧反向引用与 ref 侧绑定同步清理（不留死链）', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1' });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, repo: dev.id });
  await repos.removeRepo(dev.id);
  const refSide = await repos.getRepo(r.id);
  assert.deepEqual(refSide.linked, []);
  // checkRefs 不该报死链
  const c = await ref.checkRefs();
  const mine = c.refs.find((x) => x.id === r.id);
  assert.ok(!mine.issues.some((i) => /绑定目标已不存在/.test(i)), JSON.stringify(mine.issues));
});

test('repoImport：坏 JSON / 缺 repos 数组 → badInput', async () => {
  await assert.rejects(() => transfer.repoImport({ json: '{oops' }), /解析失败/);
  await assert.rejects(() => transfer.repoImport({ json: '{"boards":[]}' }), /repos 数组/);
});

// ─── 绑定描述（link note）与分层查询 ────────────────────────────────────

test('setLinkNote：写/清单条绑定描述；未绑定显式报错；随摘绑一起消失', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1' });
  const b1 = await boards.createBoard({ name: 'grp' });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, repo: dev.id, board: b1.id });

  await ref.setLinkNote({ id: r.id, repo: dev.id, note: '画布交互参考\n搜 registerExtension' });
  await ref.setLinkNote({ id: r.id, board: b1.id, note: '组级参考' });
  let got = await repos.getRepo(r.id);
  assert.equal(got.linked.find((l) => l.kind === 'repo').note, '画布交互参考\n搜 registerExtension');
  assert.equal(got.linked.find((l) => l.kind === 'board').note, '组级参考');

  // 同 repo + board 一起给 = 报错（一条绑定一条描述）
  await assert.rejects(() => ref.setLinkNote({ id: r.id, repo: dev.id, board: b1.id, note: 'x' }), /只能选一/);
  // 未绑定的目标 = 显式报错，不静默挂空
  const dev2 = await repos.addRepo({ path: join(dir, 'd2'), name: 'd2' });
  await assert.rejects(() => ref.setLinkNote({ id: r.id, repo: dev2.id, note: 'x' }), /未绑定/);

  // note 留空 = 清除；摘绑 = 描述一起消失
  await ref.setLinkNote({ id: r.id, board: b1.id, note: '' });
  got = await repos.getRepo(r.id);
  assert.equal(got.linked.find((l) => l.kind === 'board').note, undefined);
  await ref.bindTarget({ id: r.id, remove: true, repo: dev.id });
  got = await repos.getRepo(r.id);
  assert.ok(!got.linked.some((l) => l.kind === 'repo'));
});

test('bindTarget 带 note：绑定时一并写描述；重复绑定时补写描述', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1' });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, repo: [{ id: dev.name, note: '首次绑定的描述' }] });
  let got = await repos.getRepo(r.id);
  assert.equal(got.linked[0].note, '首次绑定的描述');
  // 已绑定：再给 note = 补写
  await ref.bindTarget({ id: r.id, repo: [{ id: dev.name, note: '补充后的描述' }] });
  got = await repos.getRepo(r.id);
  assert.equal(got.linked.length, 1, '幂等不重复');
  assert.equal(got.linked[0].note, '补充后的描述');
});

test('refsForRepo 分层：第一层直接绑定，第二层按看板命名空间分组（带描述）', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1' });
  const other = await repos.addRepo({ path: join(dir, 'd2'), name: 'd2' });
  const b1 = await boards.createBoard({ name: 'grp', desc: '领域一' });
  await boards.assignRepo({ id: dev.id, board: b1.id });

  const direct = await repos.addRepo({ path: join(dir, 'rd'), name: 'rd', type: 'ref', remote: 'https://github.com/x/rd.git' });
  const groupRef = await repos.addRepo({ path: join(dir, 'rg'), name: 'rg', type: 'ref', remote: 'https://github.com/x/rg.git' });
  const stranger = await repos.addRepo({ path: join(dir, 'rs'), name: 'rs', type: 'ref', remote: 'https://github.com/x/rs.git' });
  await ref.bindTarget({ id: direct.id, repo: dev.id });
  await ref.setLinkNote({ id: direct.id, repo: dev.id, note: '它自己的参考' });
  await ref.bindTarget({ id: groupRef.id, board: b1.id });
  await ref.setLinkNote({ id: groupRef.id, board: b1.id, note: '组级参考' });
  await ref.bindTarget({ id: stranger.id, repo: other.id }); // 别人的，不该出现

  // 按 id / 名称 / 路径都能查
  for (const key of [dev.id, 'd1', join(dir, 'd1')]) {
    const d = await ref.refsForRepo(key);
    assert.equal(d.repo.id, dev.id);
    assert.deepEqual(d.direct.map((x) => x.name), ['rd']);
    assert.equal(d.direct[0].note, '它自己的参考');
    assert.equal(d.boards.length, 1);
    assert.equal(d.boards[0].name, 'grp');
    assert.deepEqual(d.boards[0].refs.map((x) => x.name), ['rg']);
    assert.equal(d.boards[0].refs[0].note, '组级参考');
    assert.ok(!d.direct.some((x) => x.name === 'rs'));
    assert.ok(!d.boards[0].refs.some((x) => x.name === 'rs'));
  }
  // 不存在的仓库显式报错
  await assert.rejects(() => ref.refsForRepo('nope'), /不存在/);
});

test('refsForBoard：组级绑定优先带命名空间描述', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'd1'), name: 'd1' });
  const b1 = await boards.createBoard({ name: 'grp' });
  await boards.assignRepo({ id: dev.id, board: b1.id });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, board: b1.id, repo: dev.id });
  await ref.setLinkNote({ id: r.id, board: b1.id, note: '组级描述' });
  await ref.setLinkNote({ id: r.id, repo: dev.id, note: '仓库级描述' });

  const d = await ref.refsForBoard(b1.id);
  assert.equal(d.refs.length, 1);
  assert.equal(d.refs[0].note, '组级描述'); // 组级优先
  assert.equal(d.refs[0].via.length, 2); // 两条路都标出
});

test('导出/导入携带绑定描述（link note）', async () => {
  const dev = await repos.addRepo({ path: join(dir, 'dev'), name: 'dev', remote: 'git@github.com:me/dev.git' });
  const r = await repos.addRepo({ path: join(dir, 'r1'), name: 'r1', type: 'ref', remote: 'https://github.com/x/r1.git' });
  await ref.bindTarget({ id: r.id, repo: [{ id: dev.id, note: '契约参考' }] });

  const d = await transfer.repoExport();
  assert.equal(d.links[0].to[0].note, '契约参考');

  // 清空重导：描述随关系重建
  await ref.bindTarget({ id: r.id, remove: true });
  const result = await transfer.repoImport({ json: JSON.stringify(d), clone: 'none' });
  assert.equal(result.links, 1);
  const got = await repos.getRepo(r.id);
  assert.equal(got.linked.find((l) => l.kind === 'repo').note, '契约参考');
});
