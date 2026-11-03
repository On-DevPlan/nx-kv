// **项目组上下文封装**（交付层）的端到端测试：
// agent 领到「组内某个仓库」的任务时，交付文本里必须带组概念、组介绍、
// 本项目在组里的位置、兄弟成员的组内描述、组绑定参考文件的可读路径——
// 而 task.text 保持库存原文。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-groupctx-'));
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_TIMEGOAL_STORE = join(dir, 'timegoals.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

async function buildGroup() {
  const repos = await import('../../src/modules/repos/service.js');
  const boards = await import('../../src/modules/repos/boards.js');
  const store = await import('../../src/modules/docs/store.js');
  const paths = await import('../../src/modules/docs/paths.js');

  const cwd = join(dir, 'grp-alpha');
  const betaDir = join(dir, 'grp-beta');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(betaDir, { recursive: true });

  const alpha = await repos.addRepo({ path: cwd, name: 'alpha', desc: '管清单的', remote: 'https://github.com/me/alpha' });
  const beta = await repos.addRepo({ path: betaDir, name: 'beta', desc: '仓库登记', remote: 'https://github.com/me/beta' });
  const b = await boards.createBoard({ name: 'nx系列', desc: 'nx 工具链组合' });
  await boards.assignRepo({ key: alpha.key, board: b.id });
  await boards.assignRepo({ key: beta.key, board: b.id });
  await boards.setBoardRepoNote({ key: alpha.key, board: b.id, note: '组里的任务出入口' });
  await boards.setBoardRepoNote({ key: beta.key, board: b.id, note: '仓库与技能登记' });
  await store.writeOwnDoc(paths.boardDocRel('nx系列'), '# nx系列\n\n本机 nx- 前缀工具链的组合：仓库、知识、技能各占一层。');
  await store.writeOwnDoc('notes/waitgoal-设计.md', '# waitgoal 设计\n\n阻塞窗口与收尾指令。');
  await repos.mutateStore((s) => {
    const bb = s.boards.find((x) => x.id === b.id);
    bb.docLinks = [{ rel: 'notes/waitgoal-设计.md', note: '阻塞窗口' }];
  });
  return { cwd, alpha, beta, b };
}

test('组上下文封装：交付文本带组概念/组介绍/组内位置/兄弟成员/参考文件路径', async () => {
  const { cwd } = await buildGroup();
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');

  await localtask.addTask({ text: '改登录页', cwd });
  const r = await waitForTask({ cwd, summary: '开干', timeoutSec: 1, open: false });
  assert.equal(r.status, 'ok');
  const ins = String(r.instruction || '');
  assert.match(ins, /项目组上下文/);
  assert.match(ins, /nx系列/);
  assert.match(ins, /nx 工具链组合/, '组描述');
  assert.match(ins, /本机 nx- 前缀工具链的组合/, '组介绍正文');
  assert.match(ins, /组里的任务出入口/, '本项目在组里的位置');
  assert.match(ins, /仓库与技能登记/, '兄弟成员的组内描述');
  assert.match(ins, /waitgoal-设计\.md/, '组绑定参考文件地址');
  // 上下文只进 instruction：task.text 保持库存原文
  assert.equal(String(r.task.text || '').trim(), '改登录页');
});

test('不在项目组里的目录：不拼组上下文段', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');
  const lonely = join(dir, 'lonely');
  mkdirSync(lonely, { recursive: true });
  await localtask.addTask({ text: '独立任务', cwd: lonely });
  const r = await waitForTask({ cwd: lonely, summary: '开干', timeoutSec: 1, open: false });
  assert.equal(r.status, 'ok');
  assert.doesNotMatch(String(r.instruction || ''), /项目组上下文/);
});

test('交付带项目介绍：已登记的项目即使不在任何组里也知道自己是谁', async () => {
  const repos = await import('../../src/modules/repos/service.js');
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');
  const solo = join(dir, 'solo-proj');
  mkdirSync(solo, { recursive: true });
  await repos.addRepo({ path: solo, name: 'solo', desc: '独自负责的那个项目', remote: 'https://github.com/me/solo' });

  await localtask.addTask({ text: '独立项目任务', cwd: solo });
  const r = await waitForTask({ cwd: solo, summary: '开干', timeoutSec: 1, open: false });
  const ins = String(r.instruction || '');
  assert.match(ins, /项目介绍/, '交付带项目介绍段');
  assert.match(ins, /独自负责的那个项目/, '项目介绍正文');
  assert.doesNotMatch(ins, /项目组上下文/, '没组就不拼组上下文段');
});

test('交付带项目介绍 + 组介绍：组内项目的介绍两样都在', async () => {
  const { cwd } = await buildGroup();
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');

  await localtask.addTask({ text: '组内任务', cwd });
  const r = await waitForTask({ cwd, summary: '开干', timeoutSec: 1, open: false });
  const ins = String(r.instruction || '');
  assert.match(ins, /项目介绍 · alpha/, '项目介绍段带项目名');
  assert.match(ins, /管清单的/, '项目介绍正文');
  assert.match(ins, /项目组上下文 · nx系列/, '组上下文段照旧');
});
