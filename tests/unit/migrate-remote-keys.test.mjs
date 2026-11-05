// scripts/migrate-remote-keys.mjs 的回归测试（任务 #63 验收反馈）：
// **只挂 upstream、没有 origin 的仓库也必须迁到远程 key**。
//
// 背景：上一版脚本自己写了一个 gitOrigin()（只读 remote.get-url origin），
// GitHub fork 工作流的仓库（br_tb / fr / sl）因此被判成「没有远程」而留在 local/ key；
// 而运行时（repo key refresh）用的是 git.js 的 pickRemote，它本来就会回落到 upstream。
// 两边口径不一致才有这次返工 —— 现在脚本直接复用 pickRemote，本用例锁死这个行为。
//
// 全程在临时目录里跑：NX_KV_HOME 指到 tmp，绝不碰真实的 ~/.nx-kv。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', '..', 'scripts', 'migrate-remote-keys.mjs');

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

let home = '';
let env = {};

function seedRepo(dir, remotes) {
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '--initial-branch=main'], dir);
  writeFileSync(join(dir, 'f.txt'), 'x');
  git(['add', '.'], dir);
  git(['commit', '-qm', 'init'], dir);
  for (const [name, url] of remotes) git(['remote', 'add', name, url], dir);
}

function runScript(...args) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'nx-kv-migrate-'));
  env = {
    NX_KV_HOME: home,
    NX_KV_REPOS_STORE: join(home, 'repos.json'),
    NX_KV_LOCALTASK_STORE: join(home, 'localtasks.json'),
    NX_KV_DOCS_DIR: join(home, 'docs'),
  };
});

test.after?.(() => {
  try { rmSync(home, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

if (hasGit) {
  test('没有 origin、只有 upstream → 照样迁到远程 key（并搬文档树、改写任务 frontmatter）', () => {
    const proj = join(home, 'br_tb');
    seedRepo(proj, [['upstream', 'git@github.com:ZHLX2005/br_tb.git']]);

    const docsDir = env.NX_KV_DOCS_DIR;
    mkdirSync(join(docsDir, 'repo', 'local'), { recursive: true });
    writeFileSync(join(docsDir, 'repo', 'local', 'br_tb.md'), '# br_tb\n\n见 repo/local/br_tb.md\n');

    writeFileSync(env.NX_KV_REPOS_STORE, JSON.stringify({
      version: 1,
      repos: [{
        id: 'r1', name: 'br_tb', path: proj, desc: '', notes: '',
        type: 'dev', remote: '', key: 'local/br_tb', keyCustom: false,
        linked: [], addedAt: '2026-01-01', updatedAt: '2026-01-01',
      }],
      boards: [{
        id: 'b1', name: 'nx', desc: '', key: 'board/nx',
        repoKeys: ['local/br_tb'], repoNotes: { 'local/br_tb': '组内描述' }, repoDocs: {},
      }],
    }, null, 2));

    writeFileSync(env.NX_KV_LOCALTASK_STORE, JSON.stringify({
      topics: {
        k1: {
          key: 'k1', name: 'br_tb', tasks: [{
            id: 1,
            text: '---\nproject: local/br_tb\nprojectIntro: repo/local/br_tb.md\n---\n# 任务\n',
          }],
        },
      },
    }, null, 2));

    const out = runScript('--all', '--apply');
    assert.match(out, /br_tb: local\/br_tb → github\.com\/zhlx2005\/br_tb/);

    const reg = readJson(env.NX_KV_REPOS_STORE);
    const r = reg.repos[0];
    assert.equal(r.key, 'github.com/zhlx2005/br_tb', 'key 必须来自 upstream');
    assert.equal(r.remote, 'git@github.com:ZHLX2005/br_tb.git', 'remote 字段跟着登记');
    assert.deepEqual(reg.boards[0].repoKeys, ['github.com/zhlx2005/br_tb']);
    assert.equal(reg.boards[0].repoNotes['github.com/zhlx2005/br_tb'], '组内描述');

    // 文档树搬家（文件 + 正文里的旧路径引用）
    assert.ok(!existsSync(join(docsDir, 'repo', 'local', 'br_tb.md')), '旧路径应已搬走');
    const movedBody = readFileSync(join(docsDir, 'repo', 'github.com', 'zhlx2005', 'br_tb.md'), 'utf8');
    assert.ok(!movedBody.includes('repo/local/br_tb.md'), '正文引用也要改写');

    // 任务 frontmatter
    const t = readJson(env.NX_KV_LOCALTASK_STORE).topics.k1.tasks[0];
    assert.ok(t.text.includes('project: github.com/zhlx2005/br_tb'), t.text);
    assert.ok(t.text.includes('projectIntro: repo/github.com/zhlx2005/br_tb.md'), t.text);

    // 幂等：再跑一次没有可迁的
    assert.match(runScript('--all'), /没有需要迁移的仓库/);
  });

  test('一条 remote 都没有 → 保持 local/ 兜底 key（不猜、不报错）', () => {
    const proj = join(home, 'wb');
    mkdirSync(proj, { recursive: true });
    git(['init', '-q', '--initial-branch=main'], proj);
    // 只有 pushdefault 配置，没有任何 remote.*.url —— 与真实仓库 wb 一致
    git(['config', 'remote.pushdefault', 'upstream'], proj);

    writeFileSync(env.NX_KV_REPOS_STORE, JSON.stringify({
      version: 1,
      repos: [{
        id: 'r2', name: 'wb', path: proj, desc: '', notes: '',
        type: 'dev', remote: '', key: 'local/wb', keyCustom: false,
        linked: [], addedAt: '2026-01-01', updatedAt: '2026-01-01',
      }],
      boards: [],
    }, null, 2));

    runScript('--all', '--apply');
    const r = readJson(env.NX_KV_REPOS_STORE).repos[0];
    assert.equal(r.key, 'local/wb', '没有远程地址就保持本地 key');
  });

  test('key 替换有右边界：local/fr 不能吃掉 local/frontend', () => {
    const proj = join(home, 'fr');
    seedRepo(proj, [['upstream', 'https://github.com/ZHLX2005/fr.git']]);

    const docsDir = env.NX_KV_DOCS_DIR;
    mkdirSync(join(docsDir, 'repo', 'local'), { recursive: true });
    // 同目录下另一份文档的 key 以 local/fr 为前缀 —— 不该被改
    writeFileSync(join(docsDir, 'repo', 'local', 'fr.md'), 'A: local/fr\nB: local/frontend\n');

    writeFileSync(env.NX_KV_REPOS_STORE, JSON.stringify({
      version: 1,
      repos: [{
        id: 'r3', name: 'fr', path: proj, desc: '', notes: '',
        type: 'dev', remote: '', key: 'local/fr', keyCustom: false,
        linked: [], addedAt: '2026-01-01', updatedAt: '2026-01-01',
      }],
      boards: [],
    }, null, 2));

    runScript('--all', '--apply');
    const body = readFileSync(join(docsDir, 'repo', 'github.com', 'zhlx2005', 'fr.md'), 'utf8');
    assert.ok(body.includes('A: github.com/zhlx2005/fr'), body);
    assert.ok(body.includes('B: local/frontend'), '前缀相同的其它 key 不能被误改：' + body);
  });
}
