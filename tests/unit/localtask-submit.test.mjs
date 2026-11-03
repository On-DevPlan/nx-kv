import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../../src/modules/localtask/frontmatter.js';

// env 先行（模块导入前钉住独立 store）——派任务编排 submitTask 会真的登记仓库/看板、
// 真的写任务队列，不能落到用户的真实 store 上。
const sb = mkdtempSync(join(tmpdir(), 'nx-kv-submit-'));
process.env.NX_KV_REPOS_STORE = join(sb, 'repos.json');
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
process.env.NX_KV_DOCS_DIR = join(sb, 'docs');

const repos = await import('../../src/modules/repos/service.js');
const boards = await import('../../src/modules/repos/boards.js');
const { submitTask } = await import('../../src/modules/tasktool/add.js');
const mod = (await import('../../src/modules/localtask/index.js')).default;
const addAction = mod.actions.find((a) => a.id === 'localtask.add');

// 共享登记（顶层 setup，测试间不互相依赖）：一个项目 + 一个组
const repoPath = join(sb, 'real-proj');
mkdirSync(repoPath, { recursive: true });
const repo = await repos.addRepo({
  path: repoPath,
  name: 'fm-route',
  desc: '落点路由项目',
  remote: 'https://github.com/me/fmroute',
});
const strictPath = join(sb, 'strict-proj');
mkdirSync(strictPath, { recursive: true });
const strictRepo = await repos.addRepo({
  path: strictPath,
  name: 'strict-route',
  desc: '严格口径项目',
  remote: 'https://github.com/me/strictroute',
});
const board = await boards.createBoard({ name: '严格组', desc: '严格口径测试组' });
await boards.assignRepo({ key: strictRepo.key, board: board.id });

// Windows 稳健的全路径比较（samePlace 只比 basename 派生 key，同名目录会误判——这里更强）
const samePath = (a, b) => resolve(a).replace(/[\\/]+/g, '/').toLowerCase() === resolve(b).replace(/[\\/]+/g, '/').toLowerCase();

test('submitTask：正文自带 frontmatter（fail-open）→ 落点跟到项目登记路径', async () => {
  // 提交方没给 cwd → 归属决定落点：任务进项目登记路径的队列
  const r = await submitTask({ text: `---\nproject: ${repo.key}\n---\n# 路由任务\n正文` });
  assert.ok(samePath(r.cwd, repoPath), `落点应为项目登记路径（实际 ${r.cwd}）`);
  const fm = parseFrontmatter(r.task.text);
  assert.equal(fm.project, repo.key, 'frontmatter.project 归一为登记 key');
  assert.equal(fm.projectIntro, `repo/${repo.key}.md`, '补上项目介绍引用');
  assert.equal(fm.projectDesc, '落点路由项目');
});

test('submitTask：--global + 正文 frontmatter → 字段补齐，落点仍是全局池', async () => {
  const r = await submitTask({ text: `---\nproject: ${repo.key}\n---\n# 全局任务\n正文`, global: true });
  assert.equal(r.isGlobal, true, '落点不被 frontmatter 挪走（--global 优先）');
  const fm = parseFrontmatter(r.task.text);
  assert.equal(fm.projectIntro, `repo/${repo.key}.md`, 'fail-open 字段照常补齐');
});

test('submitTask：显式给过 cwd 时 fail-open 不挪窝（只补字段）', async () => {
  const elsewhere = join(sb, 'submit-here');
  mkdirSync(elsewhere, { recursive: true });
  const r = await submitTask({
    text: `---\nproject: ${repo.key}\n---\n# 停在原地\n正文`,
    cwd: elsewhere,
  });
  assert.ok(samePath(r.cwd, elsewhere), `显式 cwd 优先，落点不被 frontmatter 挪走（实际 ${r.cwd}）`);
  const fm = parseFrontmatter(r.task.text);
  assert.equal(fm.project, repo.key);
  assert.equal(fm.projectIntro, `repo/${repo.key}.md`, '字段仍补齐');
});

test('submitTask：认不出归属（项目未登记）→ 原样落调用方目录，不拦任务', async () => {
  const here = join(sb, 'unresolvable');
  mkdirSync(here, { recursive: true });
  const r = await submitTask({ text: '---\nproject: ghost/none\n---\n# 任务\n正文', cwd: here });
  assert.ok(samePath(r.cwd, here));
  assert.equal(parseFrontmatter(r.task.text).project, 'ghost/none', '正文原样保留（fail-open）');
});

test('submitTask：只给 project（面板项目口径）→ 严格校验 + 落点=项目路径', async () => {
  // 这正是面板「认不出组但认得出 project」分支发的 body：{text, project}
  const r = await submitTask({ text: `---\nboard: b_keep\n---\n# 项目口径\n正文`, project: strictRepo.key });
  assert.ok(samePath(r.cwd, strictPath), `落点应为项目登记路径（实际 ${r.cwd}）`);
  const fm = parseFrontmatter(r.task.text);
  assert.equal(fm.project, strictRepo.key);
  assert.equal(fm.board, 'b_keep', '正文原有的 board 字段保留（项目口径不标组）');
});

test('submitTask：显式 --board/--project（严格口径）→ 落点=项目路径 + frontmatter 落字段', async () => {
  const r = await submitTask({ text: '# 严格提交', board: board.id, project: strictRepo.key });
  assert.ok(samePath(r.cwd, strictPath), `落点应为项目登记路径（实际 ${r.cwd}）`);
  const fm = parseFrontmatter(r.task.text);
  assert.equal(fm.board, board.id);
  assert.equal(fm.project, strictRepo.key);
  assert.equal(fm.boardIntro, 'board/严格组.md');
});

test('submitTask：严格口径 --cwd 与 --project 冲突 → 报错（不静默取一个）', async () => {
  await assert.rejects(
    () => submitTask({ text: '# x', project: strictRepo.key, cwd: repoPath }),
    /不是同一个项目/
  );
});

test('submitTask：--global 与 --board 同给 → 报错（互斥不变）', async () => {
  await assert.rejects(
    () => submitTask({ text: '# x', global: true, board: 'b_x', project: 'local/x' }),
    /--global 不能与 --board/
  );
});

test('localtask.add action：一行委托 submitTask——CLI/HTTP/面板同走一条链路', async () => {
  // 经 action.run（HTTP body 同形状）走一遍 fail-open 路由，确认委托链路通、
  // frontmatter 补齐与落点跟到项目队列与直调 submitTask 一致。
  const r = await addAction.run({ text: `---\nproject: ${repo.key}\n---\n# 经 action 提交\n正文` });
  assert.ok(samePath(r.cwd, repoPath), `落点应跟到 fm-route 项目队列（实际 ${r.cwd}）`);
  assert.equal(parseFrontmatter(r.task.text).projectIntro, `repo/${repo.key}.md`);
});

test('localtask.add action：goalPrompt 驼峰写法（HTTP body）照常归一进 timegoal', async () => {
  const r = await addAction.run({
    text: '# 带时长',
    goalPrompt: '先看 tasktool/add.js 再动手',
    duration: '2h',
  });
  assert.equal(r.task.timegoal.duration, '2h');
  assert.equal(r.task.timegoal.prompt, '先看 tasktool/add.js 再动手');
});

test('清理', () => {
  rmSync(sb, { recursive: true, force: true });
});
