import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import {
  resolveGroupTarget,
  findBoard,
  findRepo,
  memberKeysOf,
} from '../../src/modules/localtask/ops/board-target.js';
import * as svc from '../../src/modules/localtask/service.js';

// ─── 目标解析 ───────────────────────────────────────────────────

const STORE = {
  // 归一化后的形状（调用方用 boardRepoKeys/deriveKey 归一后喂进来）
  boards: [
    {
      id: 'b_nx',
      name: 'nx',
      key: 'board/nx',
      desc: 'nx 工具链组合',
      memberKeys: ['local/nx-kv', 'local/nx-rh'],
      doc: { ref: 'ref_aaaaaaaaaaaaaaa1' },
    },
    { id: 'b_todo', name: 'todo', key: 'board/todo', desc: '任务池组', memberKeys: ['local/sedoc'] },
  ],
  repos: [
    { key: 'local/nx-kv', name: 'nx-kv', path: 'D:\\Dev\\nx-kv', desc: 'KV 清单管理中枢', doc: { ref: 'ref_bbbbbbbbbbbbbbb2' } },
    { key: 'local/nx-rh', name: 'nx-rh', path: 'D:\\Dev\\nx-rh', desc: '仓库登记与技能管理' },
    { key: 'local/sedoc', name: 'sedoc-fe-8.60', path: 'D:\\Dev\\sedoc', desc: '社保云柜前端' },
  ],
};

test('memberKeysOf：兼容 repoKeys / repos 两种旧形态', () => {
  assert.deepEqual([...memberKeysOf({ memberKeys: ['a'] })], ['a']);
  assert.deepEqual([...memberKeysOf({ repoKeys: ['b'] })], ['b']);
  assert.deepEqual([...memberKeysOf({ repos: [{ key: 'c' }] })], ['c']);
});

test('findBoard：id / key / 名称都认', () => {
  assert.equal(findBoard(STORE.boards, 'b_nx').name, 'nx');
  assert.equal(findBoard(STORE.boards, 'board/nx').id, 'b_nx');
  assert.equal(findBoard(STORE.boards, 'NX').id, 'b_nx');
  assert.equal(findBoard(STORE.boards, 'nope'), null);
});

test('findRepo：key / 名称 / 路径都认', () => {
  assert.equal(findRepo(STORE.repos, 'local/nx-kv').name, 'nx-kv');
  assert.equal(findRepo(STORE.repos, 'nx-rh').key, 'local/nx-rh');
  assert.equal(findRepo(STORE.repos, 'd:/dev/sedoc').key, 'local/sedoc');
});

test('resolveGroupTarget：组 + 项目 → 结构化归属 + 项目落点目录（#197 无 frontmatter 字段）', () => {
  const t = resolveGroupTarget({ board: 'nx', project: 'nx-kv' }, STORE);
  assert.equal(t.boardId, 'b_nx');
  assert.equal(t.boardKey, 'board/nx');
  assert.equal(t.projectKey, 'local/nx-kv');
  assert.equal(t.cwd, 'D:\\Dev\\nx-kv'); // 落进该项目的队列
});

test('resolveGroupTarget：项目不是该组成员 → 报错（不静默放行）', () => {
  assert.throws(
    () => resolveGroupTarget({ board: 'nx', project: 'sedoc-fe-8.60' }, STORE),
    /不是项目组「nx」的成员/
  );
});

test('resolveGroupTarget：找不到组 / 找不到项目 → 报错', () => {
  assert.throws(() => resolveGroupTarget({ board: 'nope' }, STORE), /找不到项目组/);
  assert.throws(() => resolveGroupTarget({ project: 'nope' }, STORE), /找不到项目/);
});

test('resolveGroupTarget：只给组 → 必须显式指明归属项目（不从 cwd 反推）', () => {
  assert.throws(() => resolveGroupTarget({ board: 'nx' }, STORE), /要指明归属项目/);
  // cwd 不参与归属推断：给了组+目录但没给项目，照样报错
  assert.throws(
    () => resolveGroupTarget({ board: 'nx', cwd: 'D:\\Dev\\nx-kv' }, STORE),
    /要指明归属项目/
  );
  // 报错里列的是**成员名字**（用户真会敲进 --project 的值），不是 key
  assert.throws(
    () => resolveGroupTarget({ board: 'nx' }, STORE),
    /本组成员：nx-kv \/ nx-rh/
  );
});

test('resolveGroupTarget：--project 与 --cwd 指向不同项目 → 报错（不静默取一个）', () => {
  assert.throws(
    () => resolveGroupTarget({ board: 'nx', project: 'nx-kv', cwd: 'D:\\Dev\\nx-rh' }, STORE),
    /不是同一个项目/
  );
});

test('resolveGroupTarget：--project 与 --cwd 指向同一项目 → 正常', () => {
  const t = resolveGroupTarget({ board: 'nx', project: 'nx-kv', cwd: 'D:\\Dev\\nx-kv' }, STORE);
  assert.equal(t.boardId, 'b_nx');
  assert.equal(t.projectKey, 'local/nx-kv');
  assert.equal(t.cwd, 'D:\\Dev\\nx-kv');
});

test('resolveGroupTarget：只给项目不标组', () => {
  const onlyProject = resolveGroupTarget({ project: 'nx-kv' }, STORE);
  assert.equal(onlyProject.projectKey, 'local/nx-kv');
  assert.equal(onlyProject.boardId, '');
  assert.equal(onlyProject.cwd, 'D:\\Dev\\nx-kv');
});

test('resolveGroupTarget：都不给 → 空目标（原样提交）', () => {
  const t = resolveGroupTarget({}, STORE);
  assert.equal(t.boardId, '');
  assert.equal(t.cwd, '');
});

// ─── 介绍引用（#197：不再进正文 frontmatter——挂在组/仓库的文档列表）──────

test('resolveGroupTarget：没有介绍绑定也不产出 fm 字段（介绍走 docs ref，不进正文）', () => {
  const bare = { ...STORE, boards: [{ ...STORE.boards[0], doc: undefined }] };
  const t = resolveGroupTarget({ board: 'nx', project: 'nx-kv' }, bare);
  assert.equal(t.boardId, 'b_nx', '组解析照常');
  assert.equal(t.fields, undefined, 'frontmatter 字段已整体删除');
});

test('resolveGroupTarget：只给项目 → 结构化归属，无 fm 字段（#197 介绍走文档列表）', () => {
  const t = resolveGroupTarget({ project: 'nx-kv' }, STORE);
  assert.equal(t.projectKey, 'local/nx-kv');
  assert.equal(t.projectName, 'nx-kv');
  assert.equal(t.fields, undefined);
});

// ─── 面板口径：显式 board/project → 落两条 topic 关联（#197 不再有 frontmatter）───

test('localtask.add：面板传显式 board/project → 归属落两条关联、正文无 frontmatter', async () => {
  // 独立 store：这条会真的登记仓库与看板，不能落到用户的真实 store 上
  const sb = mkdtempSync(join(tmpdir(), 'nx-kv-fmpan-'));
  process.env.NX_KV_REPOS_STORE = join(sb, 'repos.json');
  process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
  process.env.NX_KV_DOCS_DIR = join(sb, 'docs');

  const repos = await import('../../src/modules/repos/service.js');
  const boards = await import('../../src/modules/repos/boards.js');
  const mod = (await import('../../src/modules/localtask/index.js')).default;
  const action = mod.actions.find((a) => a.id === 'localtask.add');

  const cwd = join(sb, 'fm-pan');
  mkdirSync(cwd, { recursive: true });
  const repo = await repos.addRepo({ path: cwd, name: 'fm-pan', desc: '面板口径项目', remote: 'https://github.com/me/fmpan' });
  const b = await boards.createBoard({ name: 'fm组', desc: '面板组' });
  await boards.assignRepo({ key: repo.key, board: b.id });
  // v8：项目介绍是显式 ref（createBoard 的组描述已写成组介绍主篇）
  await repos.writeRepoDocContent({ key: repo.key, name: repo.name }, '面板口径项目');

  const r = await action.run({
    text: '# 面板草稿\n正文',
    board: b.id,
    project: repo.key,
    cwd,
    summary: '面板路径',
  });
  // #197：归属落关联（组队列 + 仓库队列），正文不再有 frontmatter
  assert.equal(r.task.boardKey, b.key, '组归属来自 group topic 关联');
  assert.equal(r.task.repoKey, repo.key, '归属仓库来自 repo topic 关联');
  assert.ok(r.task.groupTopicId, '组队列关联已建立');
  assert.ok(!r.task.text.includes('---'), '正文不含 frontmatter');

  // T03：先关库连接再删临时目录（Windows 连接开着必 EBUSY）
  try { svc.closeDb(); } catch { /* ignore */ }
  rmSync(sb, { recursive: true, force: true, maxRetries: 3 });
});
