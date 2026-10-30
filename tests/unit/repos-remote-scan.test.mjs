// 批量 remote 扫描的单元测试：把「该不该动手」的判定钉死。
//
// 这组断言的动机：以前每个仓库行各挂一个 remote 按钮，要不要换、换成哪条全靠人
// 一个个点开看。判断依据其实都在数据里（git remote -v + 登记采纳值 + key 派生），
// 所以规则必须可测——否则「面板说可替换」和「实际能不能对齐」迟早对不上。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as service from '../../src/modules/repos/service.js';
import * as remote from '../../src/modules/repos/remote.js';

const gitOk = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const git = (args, cwd) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-scan-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_CONFIG = join(dir, 'config.json');
});

/** 建一个带 remote 的真 git 目录（只 init + remote add，不需要提交） */
function makeRepo(name, remotes = []) {
  const p = join(dir, name);
  mkdirSync(p, { recursive: true });
  if (remotes.length || remotes.length === 0) {
    git(['init'], p);
    for (const [rn, url] of remotes) git(['remote', 'add', rn, url], p);
  }
  return p;
}

const find = (scan, name) => scan.repos.find((r) => r.name === name);

test('scanRemotes：https 已采纳 + 另有 ssh 同名 → 建议换 ssh（可替换）', { skip: !gitOk }, async () => {
  const p = makeRepo('multi', [
    ['origin', 'https://github.com/a/b.git'],
    ['origin-ssh', 'git@github.com:a/b.git'],
  ]);
  await service.addRepo({ path: p, name: 'multi', remote: 'https://github.com/a/b.git' });

  const scan = await remote.scanRemotes();
  const row = find(scan, 'multi');
  assert.equal(row.status, 'replaceable');
  assert.equal(row.candidates.length, 2);
  assert.equal(row.suggest.kind, 'ssh');
  assert.equal(row.suggest.url, 'git@github.com:a/b.git');
  // key 是按当前 https 地址派生的，两条地址派生出同一个 key → 不算 key 不一致
  assert.equal(row.key, 'github.com/a/b');
});

test('scanRemotes：只有一条且等于当前 → ok，无建议', { skip: !gitOk }, async () => {
  const p = makeRepo('solo', [['origin', 'https://github.com/a/solo.git']]);
  await service.addRepo({ path: p, name: 'solo', remote: 'https://github.com/a/solo.git' });

  const row = find(await remote.scanRemotes(), 'solo');
  assert.equal(row.status, 'ok');
  assert.equal(row.suggest, null);
});

test('scanRemotes：git 里没有 remote → empty，不硬给建议', { skip: !gitOk }, async () => {
  const p = makeRepo('bare');
  await service.addRepo({ path: p, name: 'bare' });

  const row = find(await remote.scanRemotes(), 'bare');
  assert.equal(row.status, 'empty');
  assert.equal(row.suggest, null);
  assert.equal(row.candidates.length, 0);
});

test('scanRemotes：登记的地址已不在 git 里 → ghost（登记悬空）', { skip: !gitOk }, async () => {
  const p = makeRepo('ghosted', [['upstream', 'https://github.com/a/other.git']]);
  await service.addRepo({ path: p, name: 'ghosted', remote: 'https://github.com/a/gone.git' });

  const row = find(await remote.scanRemotes(), 'ghosted');
  assert.equal(row.status, 'ghost');
  // 悬空不等于没候选：仍然能把 upstream 那条对齐过来
  assert.equal(row.suggest.url, 'https://github.com/a/other.git');
});

test('scanRemotes：目录不再是 git 仓库 → offline', { skip: !gitOk }, async () => {
  const p = join(dir, 'plain');
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'a.txt'), 'x');
  await service.addRepo({ path: p, name: 'plain', remote: 'https://github.com/a/plain.git' });

  const row = find(await remote.scanRemotes(), 'plain');
  assert.equal(row.status, 'offline');
});

test('scanRemotes：缺省只扫开发仓库，参考仓库要显式 --type ref / all', { skip: !gitOk }, async () => {
  const d = makeRepo('dev-one', [['origin', 'https://github.com/a/d1.git']]);
  const r = makeRepo('ref-one', [['origin', 'https://github.com/a/r1.git']]);
  await service.addRepo({ path: d, name: 'dev-one', remote: 'https://github.com/a/d1.git', type: 'dev' });
  await service.addRepo({ path: r, name: 'ref-one', remote: 'https://github.com/a/r1.git', type: 'ref' });

  // 缺省 = dev：参考仓库的 remote 是它 clone 的来源兼 key，没有「换一条」的余地
  const byDefault = await remote.scanRemotes();
  assert.deepEqual(byDefault.repos.map((x) => x.name), ['dev-one']);
  assert.equal(byDefault.type, 'dev');

  const onlyRef = await remote.scanRemotes({ type: 'ref' });
  assert.deepEqual(onlyRef.repos.map((x) => x.name), ['ref-one']);
  assert.equal(onlyRef.type, 'ref');

  const all = await remote.scanRemotes({ type: 'all' });
  assert.equal(all.total, 2);
});

test('alignRemotes：批量落盘，key 跟着新地址重算', { skip: !gitOk }, async () => {
  const p = makeRepo('alignme', [
    ['origin', 'https://github.com/a/alignme.git'],
    ['upstream', 'git@github.com:a/alignme.git'],
  ]);
  await service.addRepo({ path: p, name: 'alignme', remote: 'https://github.com/a/alignme.git' });

  const before = (await service.listRepos())[0];
  assert.equal(before.remote, 'https://github.com/a/alignme.git');

  const out = await remote.alignRemotes({
    items: [{ id: before.key, url: 'git@github.com:a/alignme.git' }],
  });
  assert.equal(out.aligned, 1);
  assert.equal(out.failed.length, 0);

  const after = (await service.listRepos())[0];
  assert.equal(after.remote, 'git@github.com:a/alignme.git');
  assert.equal(after.key, 'github.com/a/alignme'); // SSH / HTTPS 归一成同一个 key
});

test('alignRemotes：坏条目落在 failed 里，不炸整批', { skip: !gitOk }, async () => {
  const p = makeRepo('good', [['origin', 'https://github.com/a/good.git']]);
  await service.addRepo({ path: p, name: 'good', remote: 'https://github.com/a/good.git' });
  const key = (await service.listRepos())[0].key;

  const out = await remote.alignRemotes({
    items: [
      { id: key, url: 'https://github.com/a/good.git' },
      { id: 'nope', url: '' },
    ],
  });
  assert.equal(out.aligned, 1);
  assert.equal(out.failed.length, 1);
});

test('alignRemotes：空清单直接报输入错误', async () => {
  await assert.rejects(() => remote.alignRemotes({ items: [] }), /没有要对齐的条目/);
});

test('scanRemotes 汇总：counts 与 rows 一致', { skip: !gitOk }, async () => {
  const a = makeRepo('ok-one', [['origin', 'https://github.com/a/ok.git']]);
  const b = makeRepo('multi-one', [
    ['origin', 'https://github.com/a/m.git'],
    ['nas', 'git@github.com:a/m.git'],
  ]);
  await service.addRepo({ path: a, name: 'ok-one', remote: 'https://github.com/a/ok.git' });
  await service.addRepo({ path: b, name: 'multi-one', remote: 'https://github.com/a/m.git' });

  const scan = await remote.scanRemotes();
  assert.equal(scan.counts.total, 2);
  assert.equal(scan.counts.ok, 1);
  assert.equal(scan.counts.replaceable, 1);
  const sum = Object.entries(scan.counts).filter(([k]) => k !== 'total')
    .reduce((n, [, v]) => n + v, 0);
  assert.equal(sum, scan.total);
  rmSync(dir, { recursive: true, force: true });
});
