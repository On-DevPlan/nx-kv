// #105 / #109：文档列表面板「跟随左侧打开的目录」的路由解析（纯函数，三态）。
//
// 口径：
//   dir   视图 → host（按主题 repo.key / cwd 归一化对仓库）或 none（目录没登记）；
//   group 视图 → host（看板 id / key / 名字 → 冻结组 key）；
//   doc   视图 → host（文档页自带 repo / board 参数，是同一宿主的延续，#109）；
//   其他视图   → idle（面板保持不动，不刷新列表）。
//
// #109 的回归点：点开列表里的一行会进 #/doc?…，以前这里返回 null 让面板回落到
// config，列表被刷回最先打开时的项目（用户看到「莫名回到 flutter」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFollowedHost } from '../../src/web/frontend/refs/follow.js';

const repos = [
  { key: 'github.com/me/alpha', name: 'alpha', path: 'D:\\work\\alpha' },
  { key: 'github.com/me/beta', name: 'beta', path: 'D:/work/beta' },
];
const rows = [
  { key: 'tk-alpha', name: 'alpha', cwd: 'D:\\work\\alpha' },
  { key: 'tk-beta', name: 'beta', cwd: 'd:/work/beta/' },
  { key: 'tk-plain', name: 'plain', cwd: 'D:/work/plain' },
  { key: 'tk-tagged', name: 'tagged', cwd: 'D:/elsewhere', repo: { key: 'github.com/me/alpha' } },
];
const boards = [
  { id: 'b_1', key: 'group/nx', name: 'nx' },
  { id: 'b_2', key: 'board/远程控制', name: '远程控制' },
];

test('dir 视图：按主题 cwd 对到已登记仓库（大小写 / 斜杠 / 尾斜杠都归一）', () => {
  assert.deepEqual(resolveFollowedHost({ view: 'dir', key: 'tk-alpha' }, rows, repos, boards), {
    kind: 'host',
    repoKey: 'github.com/me/alpha',
    name: 'alpha',
  });
  assert.equal(
    resolveFollowedHost({ view: 'dir', key: 'tk-beta' }, rows, repos, boards).repoKey,
    'github.com/me/beta'
  );
});

test('dir 视图：主题自带 repo.key 时优先（cwd 对不上也认）', () => {
  assert.equal(
    resolveFollowedHost({ view: 'dir', key: 'tk-tagged' }, rows, repos, boards).repoKey,
    'github.com/me/alpha'
  );
});

test('dir 视图：目录没登记 → none（显示未登记提示，不拿旧宿主冒充）', () => {
  assert.deepEqual(resolveFollowedHost({ view: 'dir', key: 'tk-plain' }, rows, repos, boards), { kind: 'none' });
  assert.deepEqual(resolveFollowedHost({ view: 'dir', key: '不存在' }, rows, repos, boards), { kind: 'none' });
});

test('group 视图：id / key / 名字都能收成冻结组 key', () => {
  assert.equal(resolveFollowedHost({ view: 'group', key: 'b_1' }, rows, repos, boards).groupKey, 'group/nx');
  assert.equal(resolveFollowedHost({ view: 'group', key: 'group/nx' }, rows, repos, boards).groupKey, 'group/nx');
  assert.equal(
    resolveFollowedHost({ view: 'group', key: '远程控制' }, rows, repos, boards).groupKey,
    'board/远程控制'
  );
  // 看板清单里还没有（比如刚建/没加载）→ 原样当 key 用，不吞
  const fresh = resolveFollowedHost({ view: 'group', key: 'group/新组' }, rows, repos, boards);
  assert.equal(fresh.kind, 'host');
  assert.equal(fresh.groupKey, 'group/新组');
});

test('#109 doc 视图：按 doc 路由自带的 repo / board 认宿主（点一行不跳回别处）', () => {
  assert.deepEqual(
    resolveFollowedHost({ view: 'doc', key: 'ref:r1', repoKey: 'github.com/me/beta' }, rows, repos, boards),
    { kind: 'host', repoKey: 'github.com/me/beta', name: 'beta' }
  );
  assert.deepEqual(
    resolveFollowedHost({ view: 'doc', key: 'ref:r1', boardKey: 'group/nx', boardName: 'nx' }, rows, repos, boards),
    { kind: 'host', groupKey: 'group/nx', name: 'nx' }
  );
  // 没带宿主参数的文档页（比如从搜索进来）→ idle，面板保持原样
  assert.deepEqual(resolveFollowedHost({ view: 'doc', key: 'ref:r1' }, rows, repos, boards), { kind: 'idle' });
});

test('其他视图 → idle（总览 / 仓库页 / 模板页都不动列表）', () => {
  assert.deepEqual(resolveFollowedHost({ view: 'overview', key: '' }, rows, repos, boards), { kind: 'idle' });
  assert.deepEqual(resolveFollowedHost({ view: 'repos' }, rows, repos, boards), { kind: 'idle' });
  assert.deepEqual(resolveFollowedHost({ view: 'templates', key: '' }, rows, repos, boards), { kind: 'idle' });
  assert.deepEqual(resolveFollowedHost(null, rows, repos, boards), { kind: 'idle' });
});
