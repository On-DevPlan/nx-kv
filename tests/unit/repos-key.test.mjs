// 仓库全局唯一 key 的单元测试：
// 归一化（含 ssh://host:port 的既有 bug）/ 唯一性 / 自定义 key / 刷新建议与落盘 /
// 导入导出的三种冲突策略 / zip 打包。
//
// 存储走 NX_KV_REPOS_STORE 指到的临时文件；git 相关用本地仓库（无网络依赖）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as keys from '../../src/modules/repos/keys.js';
import * as transfer from '../../src/modules/repos/transfer.js';
import { makeZip } from '../../src/core/zip.js';

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
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-key-'));
  cfgDir = mkdtempSync(join(tmpdir(), 'nx-kv-keycfg-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_CONFIG = join(cfgDir, 'config.json');
});

test.after?.(() => {
  for (const d of [dir, cfgDir]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
});

// ─── 归一化 ─────────────────────────────────────────────────────────────

test('keyFromRemote：SSH / HTTPS / ssh-over-443 / 带端口 全部归一成同一个 key', () => {
  const want = 'github.com/on-devplan/nx-kv';
  for (const url of [
    'git@github.com:On-DevPlan/nx-kv.git',
    'https://github.com/On-DevPlan/nx-kv.git',
    'https://github.com/On-DevPlan/nx-kv',
    'ssh://git@ssh.github.com:443/On-DevPlan/nx-kv.git', // 修掉的既有 bug
    'git@ssh.github.com:On-DevPlan/nx-kv.git',
    'https://www.github.com/On-DevPlan/nx-kv/',
  ]) {
    assert.equal(repos.keyFromRemote(url), want, url);
  }
});

test('keyFromRemote：非 github 的自建 host 保留 host、丢端口', () => {
  assert.equal(repos.keyFromRemote('http://gitlab.local:8080/grp/proj.git'), 'gitlab.local/grp/proj');
  assert.equal(repos.keyFromRemote('https://user@gitlab.local/grp/proj'), 'gitlab.local/grp/proj');
  assert.equal(repos.keyFromRemote(''), '');
});

test('normalizeKey / localKeyOf / boardKeyOf：空白与非法字符压平，空 key 不合法', () => {
  assert.equal(repos.normalizeKey('  My Key  '), 'my-key');
  assert.equal(repos.normalizeKey('board/前端 组'), 'board/前端-组');
  assert.equal(repos.normalizeKey('/a//b/'), 'a/b');
  assert.equal(repos.localKeyOf('My Repo'), 'local/my-repo');
  assert.equal(repos.boardKeyOf('nx'), 'board/nx');
});

test('deriveKey：自定义优先 → remote 派生 → local 兜底', () => {
  assert.equal(repos.deriveKey({ name: 'x' }), 'local/x');
  assert.equal(repos.deriveKey({ name: 'x', remote: 'git@github.com:a/b.git' }), 'github.com/a/b');
  assert.equal(
    repos.deriveKey({ name: 'x', remote: 'git@github.com:a/b.git', keyCustom: true, key: 'My/Custom' }),
    'my/custom'
  );
});

// ─── 唯一性与自定义 ──────────────────────────────────────────────────────

test('key 全局唯一：同远程不同写法 / 自定义 key 撞车 都报冲突', async () => {
  await repos.addRepo({ path: join(dir, 'a'), name: 'a', remote: 'git@github.com:x/a.git' });
  await assert.rejects(
    () => repos.addRepo({ path: join(dir, 'b'), name: 'b', remote: 'https://github.com/x/a' }),
    /该 key 已登记/
  );
  await assert.rejects(
    () => repos.addRepo({ path: join(dir, 'c'), name: 'c', key: 'github.com/x/a', keyCustom: true }),
    /该 key 已登记/
  );
  // 不同仓库互不影响
  const ok = await repos.addRepo({ path: join(dir, 'd'), name: 'd', remote: 'https://github.com/x/d' });
  assert.equal(ok.key, 'github.com/x/d');
});

test('自定义 key：不跟随 remote 变化；--follow 后恢复派生', async () => {
  const r = await repos.addRepo({
    path: join(dir, 'a'), name: 'a',
    remote: 'git@github.com:x/a.git', key: 'My Team/Repo', keyCustom: true,
  });
  assert.equal(r.key, 'my-team/repo');
  assert.equal(r.keyCustom, true);

  // 改 remote：key 不变
  const u = await repos.updateRepo(r.id, { remote: 'https://github.com/x/renamed.git' });
  assert.equal(u.key, 'my-team/repo');
  assert.equal(u.remote, 'https://github.com/x/renamed.git');

  // 恢复跟随：key 变成 remote 派生的
  const f = await repos.updateRepo(r.id, { keyCustom: false, key: '' });
  assert.equal(f.key, 'github.com/x/renamed');
  assert.equal(f.keyCustom, false);
});

test('getRepo 支持 id / key / 路径 三种定位', async () => {
  const r = await repos.addRepo({ path: join(dir, 'a'), name: 'a', remote: 'git@github.com:x/a.git' });
  for (const loc of [r.id, r.key, join(dir, 'a')]) {
    const got = await repos.getRepo(loc);
    assert.equal(got.id, r.id, 'locator=' + loc);
  }
});

// ─── 刷新（git remote -v 探测）──────────────────────────────────────────

if (hasGit) {
  test('refreshKeys：扫描 git remote，SSH 优先；--apply 落盘', async () => {
    // 造一个只有 https remote 的仓库，再加一条 ssh remote（两条都指向同一仓库）
    const p = join(dir, 'proj');
    mkdirSync(p);
    git(['init', '-q', '--initial-branch=main'], p);
    writeFileSync(join(p, 'f.txt'), 'x');
    git(['add', '.'], p);
    git(['commit', '-qm', 'init'], p);
    git(['remote', 'add', 'origin', 'https://github.com/x/proj.git'], p);
    git(['remote', 'set-url', '--add', 'origin', 'git@github.com:x/proj.git'], p);

    // 先登记成 local 兜底 key（模拟"早期版本算的 key"）
    const r = await repos.addRepo({ path: p, name: 'proj' });
    assert.equal(r.key, 'local/proj');

    // 只看不落盘
    const dry = await keys.refreshKeys({ id: r.id, apply: false });
    assert.equal(dry.changed, 1);
    const item = dry.items[0];
    assert.equal(item.suggested.remote, 'git@github.com:x/proj.git', 'SSH 优先');
    assert.equal(item.suggested.key, 'github.com/x/proj');
    assert.equal((await repos.getRepo(r.id)).key, 'local/proj', '未 apply 不落盘');

    // apply 落盘
    const done = await keys.refreshKeys({ id: r.id, apply: true });
    assert.equal(done.items[0].applied, true);
    const after = await repos.getRepo(r.id);
    assert.equal(after.key, 'github.com/x/proj');
    assert.equal(after.remote, 'git@github.com:x/proj.git');
    assert.deepEqual(after.remotes.sort(), ['git@github.com:x/proj.git', 'https://github.com/x/proj.git'].sort());
  });

  test('refreshKeys：自定义 key 只更新 remote，不覆盖 key', async () => {
    const p = join(dir, 'proj2');
    mkdirSync(p);
    git(['init', '-q', '--initial-branch=main'], p);
    writeFileSync(join(p, 'f.txt'), 'x');
    git(['add', '.'], p);
    git(['commit', '-qm', 'init'], p);
    git(['remote', 'add', 'origin', 'git@github.com:x/proj2.git'], p);

    const r = await repos.addRepo({ path: p, name: 'proj2', key: 'my/custom-key', keyCustom: true });
    await keys.refreshKeys({ id: r.id, apply: true });
    const after = await repos.getRepo(r.id);
    assert.equal(after.key, 'my/custom-key', '自定义 key 不被覆盖');
    assert.equal(after.remote, 'git@github.com:x/proj2.git', 'remote 仍会更新');
  });

  test('refreshKeys：不是 git 仓库 → 如实标注，不报错', async () => {
    const r = await repos.addRepo({ path: join(dir, 'nongit'), name: 'nongit' });
    const d = await keys.refreshKeys({ id: r.id });
    assert.equal(d.items[0].suggested, null);
    assert.match(d.items[0].note, /不是 git 仓库/);
  });
}

// ─── 导出 / 差异 / 策略 ─────────────────────────────────────────────────

async function seed() {
  const dev = await repos.addRepo({ path: join(dir, 'dev'), name: 'dev', desc: '开发', remote: 'git@github.com:me/dev.git' });
  const ref = await repos.addRepo({ path: join(dir, 'ref'), name: 'ref', type: 'ref', desc: '参考', remote: 'https://github.com/lib/ref.git' });
  const b = await boards.createBoard({ name: 'grp', desc: '组' });
  await boards.assignRepo({ id: dev.id, board: b.id });
  await boards.setBoardRepoNote({ id: dev.id, board: b.id, note: '契约方' });
  return { dev, ref, b };
}

test('导出：key 为身份、看板有 key、不含 path 字段；选择导出只带选中的', async () => {
  const { dev, ref } = await seed();
  const all = await transfer.repoExport();
  assert.equal(all.version, 3);
  assert.ok(!JSON.stringify(all).includes('"path"'));
  assert.deepEqual(all.repos.map((r) => r.key).sort(), ['github.com/lib/ref', 'github.com/me/dev'].sort());
  assert.equal(all.boards[0].key, 'board/grp');

  // 只导出一个仓库
  const one = await transfer.repoExport({ repoKeys: [dev.key] });
  assert.deepEqual(one.repos.map((r) => r.key), [dev.key]);
  assert.ok(ref);
});

test('diffImport：逐条给出 新增/一致/有差异，零副作用', async () => {
  const { dev } = await seed();
  const layout = await transfer.repoExport();
  // 改字段 + 加一个新仓库
  layout.repos.find((r) => r.key === dev.key).desc = '改过的描述';
  layout.repos.push({ key: 'github.com/new/thing', name: 'thing', type: 'ref', remote: 'https://github.com/new/thing.git' });

  const before = JSON.stringify(await repos.loadStore());
  const d = await transfer.diffImport(JSON.stringify(layout));
  assert.equal(JSON.stringify(await repos.loadStore()), before, 'diff 必须零副作用');

  const devItem = d.repos.find((r) => r.key === dev.key);
  assert.equal(devItem.status, 'changed');
  assert.deepEqual(devItem.fields, [{ field: 'desc', local: '开发', incoming: '改过的描述' }]);
  assert.equal(d.repos.find((r) => r.key === 'github.com/new/thing').status, 'new');
  assert.equal(d.repos.find((r) => r.key === 'github.com/new/thing').canClone, true);
  assert.equal(d.summary.new, 1);
  assert.equal(d.summary.changed, 1);
});

test('导入策略 ours / overwrite：ours 不动，overwrite 覆盖字段（key 不变）', async () => {
  const { dev } = await seed();
  const layout = await transfer.repoExport();
  layout.repos.find((r) => r.key === dev.key).desc = '来自导入';
  const json = JSON.stringify(layout);

  // ours
  const a = await transfer.repoImport({ json, strategy: 'ours', selection: [dev.key] });
  assert.equal(a.updated.length, 0);
  assert.equal((await repos.getRepo(dev.id)).desc, '开发');

  // overwrite
  const b = await transfer.repoImport({ json, strategy: 'overwrite', selection: [dev.key] });
  assert.equal(b.updated.length, 1);
  assert.deepEqual(b.updated[0].fields, ['desc']);
  assert.equal((await repos.getRepo(dev.id)).desc, '来自导入');
  assert.equal((await repos.getRepo(dev.id)).key, dev.key, 'key 不变');
});

test('导入策略 duplicate：另存 key-import-N，两条并存', async () => {
  const { dev } = await seed();
  const layout = await transfer.repoExport();
  layout.repos.find((r) => r.key === dev.key).name = 'dev-copy';
  const json = JSON.stringify(layout);

  const d = await transfer.repoImport({ json, strategy: 'duplicate', selection: [dev.key] });
  assert.equal(d.duplicated.length, 1);
  assert.equal(d.duplicated[0].newKey, dev.key + '-import-1');

  const all = await repos.listRepos();
  assert.equal(all.length, 3); // dev + ref + 副本
  assert.ok(all.some((r) => r.key === dev.key));
  assert.ok(all.some((r) => r.key === dev.key + '-import-1'));

  // 再导一次：后缀递增
  const d2 = await transfer.repoImport({ json, strategy: 'duplicate', selection: [dev.key] });
  assert.equal(d2.duplicated[0].newKey, dev.key + '-import-2');
});

test('diffImport：老记录缺 type 字段时不应误报 type 差异', async () => {
  // 直接写一份没有 type 字段的老格式记录（模拟 v0.11 之前的数据）
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.NX_KV_REPOS_STORE, JSON.stringify({
    version: 1,
    repos: [{
      id: 'r_old', name: 'old', path: join(dir, 'old'), desc: '', notes: '',
      remote: 'git@github.com:x/old.git', key: 'github.com/x/old', keyCustom: false,
      linked: [], addedAt: '2026-01-01', updatedAt: '2026-01-01',
      // 刻意没有 type 字段
    }],
    boards: [],
  }), 'utf8');

  const layout = await transfer.repoExport();
  const d = await transfer.diffImport(JSON.stringify(layout));
  assert.equal(d.repos[0].status, 'same', '缺 type 应按 dev 比较，不该报差异');
  assert.deepEqual(d.repos[0].fields, []);
});

test('导入：本地未拥有的 key 进 unmatched（看板成员 / 关系），不静默丢', async () => {
  const layout = {
    version: 3,
    repos: [{ key: 'github.com/a/known', name: 'known', type: 'dev', remote: 'https://github.com/a/known.git' }],
    boards: [{ key: 'board/g', name: 'g', desc: '', repos: [{ key: 'github.com/a/known' }, { key: 'github.com/missing/x' }] }],
    links: [],
  };
  const d = await transfer.repoImport({ json: JSON.stringify(layout), clone: 'none' });
  assert.equal(d.boardsCreated, 1);
  assert.equal(d.unmatched.length, 1);
  assert.equal(d.unmatched[0].entry, 'github.com/missing/x');
  assert.match(d.unmatched[0].reason, /本地未拥有/);
});

test('兼容 v2 导出：没有 key 时用 remote/name 派生，照样能导入', async () => {
  const v2 = {
    version: 2,
    repos: [{ remote: 'https://github.com/old/thing.git', name: 'thing', desc: '老格式', type: 'ref' }],
    boards: [{ name: '组', desc: '', repos: [{ remote: 'https://github.com/old/thing.git', note: '组内' }] }],
    links: [],
  };
  const d = await transfer.diffImport(JSON.stringify(v2));
  assert.equal(d.repos[0].key, 'github.com/old/thing');
  assert.equal(d.repos[0].status, 'new');

  const r = await transfer.repoImport({ json: JSON.stringify(v2), clone: 'none' });
  assert.equal(r.created.length, 1);
  const all = await repos.listRepos();
  const thing = all.find((x) => x.name === 'thing');
  assert.equal(thing.key, 'github.com/old/thing');
  const g = all[0] ? (await boards.listBoards()).boards.find((b) => b.name === '组') : null;
  assert.ok(g);
  assert.equal(g.repos[0].note, '组内');
});

// ─── zip ────────────────────────────────────────────────────────────────

test('makeZip：能被标准 zip 解析（本地文件头 + 中央目录 + EOCD）', () => {
  const buf = makeZip([
    { name: 'layout.json', data: '{"version":3}' },
    { name: 'README.txt', data: 'hello' },
  ]);
  assert.equal(buf.readUInt32LE(0), 0x04034b50, '第一个本地文件头签名');
  // EOCD 在末尾 22 字节
  const eocdAt = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocdAt), 0x06054b50, 'EOCD 签名');
  assert.equal(buf.readUInt16LE(eocdAt + 8), 2, '条目数');
});

test('repoExportZip：包含 layout.json 与 README，layout 是 v3 且无本地路径', async () => {
  await seed();
  const buf = await transfer.repoExportZip();
  // 在 zip 原文里找文件名（中央目录是明文）
  const text = buf.toString('latin1');
  assert.ok(text.includes('layout.json'));
  assert.ok(text.includes('README.txt'));
  assert.ok(!text.includes('"path"'));
});
