// **项目组上下文封装**（交付层）的端到端测试：
// agent 领到「组内某个仓库」的任务时，交付文本里必须带组概念、组介绍、
// 本项目在组里的位置、兄弟成员的组内描述、组绑定参考文件的可读路径——
// 而 task.text 保持库存原文。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb } from '../../src/core/db/index.js';  // T05：库化后测试清理要先关连接（Windows rmSync 否则 EBUSY）

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-groupctx-'));
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

async function buildGroup() {
  const repos = await import('../../src/modules/repos/service.js');
  const boards = await import('../../src/modules/repos/boards.js');
  const docs = await import('../../src/modules/docs/service.js');

  const cwd = join(dir, 'grp-alpha');
  const betaDir = join(dir, 'grp-beta');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(betaDir, { recursive: true });

  const alpha = await repos.addRepo({ path: cwd, name: 'alpha', desc: '管清单的', remote: 'https://github.com/me/alpha' });
  const beta = await repos.addRepo({ path: betaDir, name: 'beta', desc: '仓库登记', remote: 'https://github.com/me/beta' });
  // 组介绍主篇由 createBoard 的 desc 写成文档（v8：描述即文档）
  const b = await boards.createBoard({ name: 'nx系列', desc: 'nx 工具链组合' });
  await boards.assignRepo({ key: alpha.key, board: b.id });
  await boards.assignRepo({ key: beta.key, board: b.id });
  await boards.setBoardRepoNote({ key: alpha.key, board: b.id, note: '组里的任务出入口' });
  await boards.setBoardRepoNote({ key: beta.key, board: b.id, note: '仓库与技能登记' });

  // 项目介绍主篇：只通过 refId 绑定（没有约定路径）
  const alphaIntro = await docs.createRef({ owner: 'repo', repo: alpha.key });
  await docs.updateDoc({ ref: 'ref:' + alphaIntro.refId, body: '# alpha\n\n管清单的：这是 alpha 的项目介绍。' });

  // 组级补充文档（走 docLinks），note 是列表注解
  const extra = await docs.createRef({ owner: 'group', group: b.id });
  await docs.updateDoc({ ref: 'ref:' + extra.refId, body: '# waitgoal 设计\n\n阻塞窗口与收尾指令。' });
  await repos.mutateStore((s) => {
    const bb = s.boards.find((x) => x.id === b.id);
    const link = (bb.docLinks || []).find((x) => x.ref === extra.refId);
    if (link) link.note = '阻塞窗口';
  });
  return { cwd, alpha, beta, b };
}

test('组上下文封装：交付文本带组概念/组介绍引导/组内位置/兄弟成员/组文档 refId', async () => {
  const { cwd, b } = await buildGroup();
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');

  // #64 作用域：组任务 = 正文 frontmatter 带 board（组面板/CLI --board 提交的形态）
  await localtask.addTask({ text: `---\nboard: ${b.id}\n---\n\n改登录页`, cwd });
  const r = await waitForTask({ cwd, summary: '开干', timeoutSec: 1, open: false });
  assert.equal(r.status, 'ok');
  const ins = String(r.instruction || '');
  assert.match(ins, /项目组上下文/);
  assert.match(ins, /nx系列/);
  assert.match(ins, /nx 工具链组合/, '组描述');
  // v8：组介绍按 refId 定位（取用指令），组级补充文档按 desc + refId 取用
  assert.match(ins, /组介绍：nx系列/, '组介绍引导行');
  assert.match(ins, /nx 工具链组合/, '组定位');
  assert.match(ins, /nx-kv docs get --ref ref_/, '组介绍 / 组文档按 refId 取用');
  assert.match(ins, /组里的任务出入口/, '本项目在组里的位置');
  assert.match(ins, /仓库与技能登记/, '兄弟成员的组内描述');
  assert.match(ins, /阻塞窗口/, '组文档按 desc 展示');
  // 上下文只进 instruction：task.text 保持库存原文（含归属 frontmatter）
  assert.match(String(r.task.text || ''), /改登录页/);
});

test('单 repo 主题：成员仓库的纯项目任务不挂组上下文（#64）', async () => {
  const { cwd } = await buildGroup();
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');

  // 没有 board frontmatter = 仓库自己的活：成员身份不等于这条任务属于组
  await localtask.addTask({ text: '仓库自己的活', cwd });
  const r = await waitForTask({ cwd, summary: '开干', timeoutSec: 1, open: false });
  const ins = String(r.instruction || '');
  assert.doesNotMatch(ins, /项目组上下文/, '纯项目任务不挂组材料');
  assert.match(ins, /项目介绍 · alpha/, '项目介绍照给');
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
  const added = await repos.addRepo({ path: solo, name: 'solo', desc: '独自负责的那个项目', remote: 'https://github.com/me/solo' });
  // v8：项目介绍是显式 ref（没有约定路径/播种）
  await repos.writeRepoDocContent({ key: added.key, name: added.name }, '独自负责的那个项目');

  await localtask.addTask({ text: '独立项目任务', cwd: solo });
  const r = await waitForTask({ cwd: solo, summary: '开干', timeoutSec: 1, open: false });
  const ins = String(r.instruction || '');
  assert.match(ins, /项目介绍/, '交付带项目介绍段');
  assert.match(ins, /独自负责的那个项目/, '项目介绍正文');
  assert.doesNotMatch(ins, /项目组上下文/, '没组就不拼组上下文段');
});

test('交付带项目介绍 + 组介绍：组内项目的介绍两样都在', async () => {
  const { cwd, b } = await buildGroup();
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');

  await localtask.addTask({ text: `---\nboard: ${b.id}\n---\n\n组内任务`, cwd });
  const r = await waitForTask({ cwd, summary: '开干', timeoutSec: 1, open: false });
  const ins = String(r.instruction || '');
  assert.match(ins, /项目介绍 · alpha/, '项目介绍段带项目名');
  assert.match(ins, /管清单的/, '项目介绍正文');
  assert.match(ins, /项目组上下文 · nx系列/, '组上下文段照旧');
});

test('组任务只挂它归属的那个组：同仓库多组时不串组', async () => {
  const { cwd, alpha, b } = await buildGroup();
  const boards = await import('../../src/modules/repos/boards.js');
  const other = await boards.createBoard({ name: '别的组', desc: '与本任务无关' });
  await boards.assignRepo({ key: alpha.key, board: other.id });
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');

  await localtask.addTask({ text: `---\nboard: ${b.id}\n---\n\n归属 nx系列`, cwd });
  const r = await waitForTask({ cwd, summary: '开干', timeoutSec: 1, open: false });
  const ins = String(r.instruction || '');
  assert.match(ins, /项目组上下文 · nx系列/, '归属组照给');
  assert.doesNotMatch(ins, /别的组/, '同仓库的其他组不串进来');
});
