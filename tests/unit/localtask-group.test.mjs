import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  stripFrontmatter,
  withFrontmatter,
  applyGroupFields,
  preserveFrontmatter,
} from '../../src/modules/localtask/frontmatter.js';
import {
  resolveGroupTarget,
  findBoard,
  findRepo,
  memberKeysOf,
} from '../../src/modules/localtask/board-target.js';

// ─── frontmatter ────────────────────────────────────────────────

test('parseFrontmatter：读出 board / project', () => {
  const fm = parseFrontmatter('---\nboard: b_1\nproject: local/x\n---\n# 标题\n正文');
  assert.equal(fm.board, 'b_1');
  assert.equal(fm.project, 'local/x');
});

test('parseFrontmatter：不是 frontmatter（开头是分割线）时返回空对象', () => {
  assert.deepEqual(parseFrontmatter('---\n\n正文\n---\n'), {});
  assert.deepEqual(parseFrontmatter('# 标题\n正文'), {});
});

test('stripFrontmatter / withFrontmatter：剥与写', () => {
  const src = '---\nboard: b_1\n---\n# 标题\n正文';
  assert.equal(stripFrontmatter(src), '# 标题\n正文');
  assert.equal(withFrontmatter('# 标题', { board: 'b_1' }), '---\nboard: b_1\n---\n# 标题');
});

test('applyGroupFields：flag 覆盖正文同名字段，正文的其它字段保留', () => {
  const src = '---\nboard: b_keep\nnote: 手工写的\n---\n正文';
  const out = applyGroupFields(src, { board: 'b_flag', project: 'local/p' });
  const fm = parseFrontmatter(out);
  assert.equal(fm.board, 'b_flag'); // flag 是显式意图，覆盖正文
  assert.equal(fm.project, 'local/p'); // flag 补缺项
  assert.equal(fm.note, '手工写的'); // 正文其它字段保留
  assert.ok(out.endsWith('正文'));
});

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
    },
    { id: 'b_todo', name: 'todo', key: 'board/todo', desc: '任务池组', memberKeys: ['local/sedoc'] },
  ],
  repos: [
    { key: 'local/nx-kv', name: 'nx-kv', path: 'D:\\Dev\\nx-kv', desc: 'KV 清单管理中枢' },
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

test('resolveGroupTarget：组 + 项目 → frontmatter 字段 + 项目落点目录', () => {
  const t = resolveGroupTarget({ board: 'nx', project: 'nx-kv' }, STORE);
  assert.equal(t.fields.board, 'b_nx');
  assert.equal(t.fields.project, 'local/nx-kv');
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
  assert.equal(t.fields.board, 'b_nx');
  assert.equal(t.fields.project, 'local/nx-kv');
  assert.equal(t.cwd, 'D:\\Dev\\nx-kv');
});

test('resolveGroupTarget：只给项目不标组', () => {
  const onlyProject = resolveGroupTarget({ project: 'nx-kv' }, STORE);
  assert.equal(onlyProject.fields.project, 'local/nx-kv');
  assert.equal(onlyProject.fields.board, undefined);
  assert.equal(onlyProject.cwd, 'D:\\Dev\\nx-kv');
});

test('resolveGroupTarget：都不给 → 空目标（原样提交）', () => {
  const t = resolveGroupTarget({}, STORE);
  assert.deepEqual(t.fields, {});
  assert.equal(t.cwd, '');
});

// ─── 介绍引用（frontmatter 携带「介绍」）────────────────────────────

test('resolveGroupTarget：frontmatter 带介绍引用（约定路径 + 一行摘要）', () => {
  const t = resolveGroupTarget({ board: 'nx', project: 'nx-kv' }, STORE);
  assert.equal(t.fields.boardIntro, 'board/nx.md', '组介绍 = 约定路径');
  assert.equal(t.fields.boardDesc, 'nx 工具链组合', '组的一句话摘要');
  assert.equal(t.fields.projectIntro, 'repo/local/nx-kv.md', '项目介绍 = 约定路径');
  assert.equal(t.fields.projectDesc, 'KV 清单管理中枢', '项目的一句话摘要');
});

test('resolveGroupTarget：介绍绑定优先于约定路径（外部 / 自有 rel 都认）', () => {
  const ext = { ...STORE, boards: [{ ...STORE.boards[0], doc: { path: 'D:\\vault\\nx.md' } }] };
  assert.equal(resolveGroupTarget({ board: 'nx', project: 'nx-kv' }, ext).fields.boardIntro, 'D:\\vault\\nx.md');

  const own = { ...STORE, repos: [{ ...STORE.repos[0], doc: { rel: 'notes/nx-kv.md' } }] };
  assert.equal(resolveGroupTarget({ board: 'nx', project: 'nx-kv' }, own).fields.projectIntro, 'notes/nx-kv.md');
});

test('resolveGroupTarget：只给项目 → 也带项目介绍引用（不标组）', () => {
  const t = resolveGroupTarget({ project: 'nx-kv' }, STORE);
  assert.equal(t.fields.projectIntro, 'repo/local/nx-kv.md');
  assert.equal(t.fields.projectDesc, 'KV 清单管理中枢');
  assert.equal(t.fields.boardIntro, undefined, '没给组就不标组介绍');
});

// ─── 换正文保住 frontmatter ────────────────────────────────────────

test('preserveFrontmatter：换正文保住旧的归组字段', () => {
  const oldText = '---\nboard: b_1\nproject: local/x\n---\n# 旧标题';
  const out = preserveFrontmatter(oldText, '# 新标题');
  const fm = parseFrontmatter(out);
  assert.equal(fm.board, 'b_1');
  assert.equal(fm.project, 'local/x');
  assert.match(out, /# 新标题/);
  assert.match(out, /^---\n/, 'frontmatter 还在头部');
});

test('preserveFrontmatter：新正文自带的 frontmatter 优先，旧值只补缺', () => {
  const oldText = '---\nboard: b_1\nproject: local/x\n---\n# 旧标题';
  const fm = parseFrontmatter(preserveFrontmatter(oldText, '---\nboard: b_2\n---\n# 新标题'));
  assert.equal(fm.board, 'b_2', '新正文说了算');
  assert.equal(fm.project, 'local/x', '旧值补缺');
});

test('preserveFrontmatter：旧正文没有 frontmatter → 原样返回', () => {
  assert.equal(preserveFrontmatter('# 旧', '# 新'), '# 新');
});

// ─── 面板口径：正文自带 frontmatter → 服务端补介绍引用 ──────────────

test('localtask.add：正文自带 frontmatter（面板草稿口径）→ 补上介绍引用', async () => {
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

  const r = await action.run({
    text: `---\nboard: ${b.id}\nproject: ${repo.key}\n---\n# 面板草稿\n正文`,
    cwd,
    summary: '面板路径',
  });
  const fm = parseFrontmatter(r.task.text);
  assert.equal(fm.board, b.id, '原 frontmatter 保留');
  assert.equal(fm.project, repo.key);
  assert.equal(fm.projectIntro, `repo/${repo.key}.md`, '服务端补上项目介绍引用');
  assert.equal(fm.projectDesc, '面板口径项目');
  assert.equal(fm.boardIntro, 'board/fm组.md', '服务端补上组介绍引用');

  rmSync(sb, { recursive: true, force: true });
});
