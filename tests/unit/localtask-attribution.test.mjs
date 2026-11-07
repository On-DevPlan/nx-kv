// 归属变更 → 搬家（任务 #43）：正文 effective project 变了，任务必须迁到新项目的
// 登记路径队列——否则旧项目的 agent 照旧领走、新项目的 agent 永远看不见，
// 「改归属」就是空改。守卫口径：依赖/闸门是队列内语义，搬不动就如实拒绝。
//
// 存储一律指向临时文件（NX_KV_LOCALTASK_STORE / NX_KV_REPOS_STORE），绝不写脏用户目录。
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../../src/shared/frontmatter.js';

const sb = mkdtempSync(join(tmpdir(), 'nx-kv-attrib-'));
process.env.NX_KV_REPOS_STORE = join(sb, 'repos.json');
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
process.env.NX_KV_DOCS_DIR = join(sb, 'docs');
// dag sync（updateTask 设 blockBy 后的 Mutator 投影）也必须隔离——缺省会写进真实
// ~/.nx-kv/workflows/，既污染用户目录，也让本套件的结果取决于宿主机的残留状态。
process.env.NX_KV_WORKFLOW_STORE = join(sb, 'workflows');

const repos = await import('../../src/modules/repos/service.js');
const boards = await import('../../src/modules/repos/boards.js');
const svc = await import('../../src/modules/localtask/service.js');
const mod = (await import('../../src/modules/localtask/index.js')).default;
const updateAction = mod.actions.find((a) => a.id === 'localtask.update');
const reopenAction = mod.actions.find((a) => a.id === 'localtask.reopen');
const { submitTask } = await import('../../src/modules/tasktool/add.js');

// 两个项目 + 一个组（顶层 setup，测试间共用登记）
const dirA = join(sb, 'proj-a');
const dirB = join(sb, 'proj-b');
mkdirSync(dirA, { recursive: true });
mkdirSync(dirB, { recursive: true });
const repoA = await repos.addRepo({
  path: dirA, name: 'proj-a', desc: 'A 项目', remote: 'https://github.com/me/proja',
});
const repoB = await repos.addRepo({
  path: dirB, name: 'proj-b', desc: 'B 项目', remote: 'https://github.com/me/projb',
});
const board = await boards.createBoard({ name: '归属组', desc: '归属变更测试组' });
await boards.assignRepo({ key: repoA.key, board: board.id });
await boards.assignRepo({ key: repoB.key, board: board.id });

const aKey = svc.normalizeCwd(dirA).key;
const bKey = svc.normalizeCwd(dirB).key;
const samePath = (a, b) =>
  resolve(a).replace(/[\\/]+/g, '/').toLowerCase() === resolve(b).replace(/[\\/]+/g, '/').toLowerCase();

/** 把正文 frontmatter 的 project 从 A 改成 B（其余不动） */
const swapProject = (text) => text.replace(`project: ${repoA.key}`, `project: ${repoB.key}`);

test('归属改了 → 任务迁到新项目队列，旧队列不再有它，介绍引用刷新', async () => {
  const r = await submitTask({ text: '# A 任务\n正文', board: board.id, project: repoA.key });
  assert.ok(samePath(r.cwd, dirA), '提交时落在 A 的队列');

  const upd = await updateAction.run({
    id: r.task.id, cwd: dirA, text: swapProject(r.task.text),
  });
  assert.equal(upd.moved, true, '归属变了必须搬家');
  assert.ok(samePath(upd.cwd, dirB), `落点应为 B 的登记路径（实际 ${upd.cwd}）`);
  assert.equal(upd.movedFrom.key, aKey);
  assert.equal(upd.movedFrom.id, r.task.id);
  // T04 派生模型：搬队列 = 旧任务软删 + cancelled，新任务落 B
  // （目标队列空 → seq 保留同号；有占用 → 换号。两种都合法，不变式是"搬走了"）
  assert.equal(upd.movedFrom.id, r.task.id, '返回值带旧号（movedFrom.id）');
  // A 队列里它变成 tombstone（cancelled + deletedAt），不再是可领任务
  const tombstone = await svc.getTask({ cwd: dirA, id: r.task.id });
  assert.equal(tombstone.status, 'cancelled', '旧任务 cancelled');
  assert.ok(tombstone.deletedAt, '旧任务软删');
  // B 队列里有它，frontmatter 归属与介绍引用都是 B 的
  const inB = await svc.getTask({ cwd: dirB, id: upd.task.id });
  const fm = parseFrontmatter(inB.text);
  assert.equal(fm.project, repoB.key);
  assert.equal(fm.projectIntro, `repo/${repoB.key}.md`, 'projectIntro 必须跟着换');
  assert.equal(fm.board, board.id, '组归属不变');
});

test('归属没改 → 原地不动（moved:false）', async () => {
  const r = await submitTask({ text: '# A 任务\n正文', board: board.id, project: repoA.key });
  const upd = await updateAction.run({ id: r.task.id, cwd: dirA, text: `${r.task.text}\n补充说明` });
  assert.equal(upd.moved, false);
  assert.ok(samePath(upd.cwd, dirA));
  const back = await svc.getTask({ cwd: dirA, id: r.task.id });
  assert.ok(back.text.includes('补充说明'), '纯文案编辑照常生效');
});

test('目标队列已有同号任务 → 重新编号，不撞号', async () => {
  // A 里提交两条，B 里先放一条，再往 B 直插一条与 A#1 同号的任务（制造确定性撞号）
  const t1 = await submitTask({ text: '# 一号\nx', board: board.id, project: repoA.key });
  await submitTask({ text: '# 二号\nx', board: board.id, project: repoA.key });
  await submitTask({ text: '# B 占位\nx', board: board.id, project: repoB.key });
  svc.repo.tasks.insertTask(svc.repo.topics.getTopic(bKey).id, {
    id: t1.task.id, text: '同号占位', status: 'pending',
  });
  const upd = await updateAction.run({ id: t1.task.id, cwd: dirA, text: swapProject(t1.task.text) });
  assert.equal(upd.moved, true);
  assert.notEqual(upd.task.id, t1.task.id, '目标队列已有同号 → 换号');
  const inB = await svc.getTask({ cwd: dirB, id: upd.task.id });
  assert.ok(inB.text.includes('一号'));
  // 同号让位后目标队列序号不重复
  const b = await svc.loadStore();
  const ids = (b.topics[bKey].tasks || []).map((x) => Number(x.id));
  assert.equal(new Set(ids).size, ids.length, 'B 队列内 id 不重复');
});

test('跨队列依赖改写：指向它的 "A:id" 引用搬后跟着改到新地址', async () => {
  // 清场：A/B 各自从空开始（软删前面测试的任务不影响——按 id 断言会混，这里独立提交）
  const x = await submitTask({ text: '# 被依赖的 X\nx', board: board.id, project: repoA.key });
  const y = await submitTask({ text: '# B 的 Y\nx', board: board.id, project: repoB.key });
  // Y（在 B 队列）依赖 X（在 A 队列）——跨队列引用
  await svc.updateTask({ cwd: dirB, id: y.task.id, blockBy: [`${aKey}:${x.task.id}`] });
  const upd = await updateAction.run({ id: x.task.id, cwd: dirA, text: swapProject(x.task.text) });
  assert.equal(upd.moved, true);
  const yNow = await svc.getTask({ cwd: dirB, id: y.task.id });
  assert.deepEqual(
    yNow.blockBy,
    [`${bKey}:${upd.task.id}`],
    '指向它的跨队列引用必须改写到新地址',
  );
});

test('有上游依赖（本地 id）→ 拒绝搬家，错误说清楚', async () => {
  const dep = await submitTask({ text: '# 依赖源\nx', board: board.id, project: repoA.key });
  const t = await submitTask({ text: '# 带依赖\nx', board: board.id, project: repoA.key });
  await svc.updateTask({ cwd: dirA, id: t.task.id, blockBy: [dep.task.id] });
  await assert.rejects(
    () => updateAction.run({ id: t.task.id, cwd: dirA, text: swapProject(t.task.text) }),
    /上游依赖 #\d+.*队列内语义/,
    '本地依赖是队列内语义，搬走会断链',
  );
});

test('被本队列其他任务依赖 → 拒绝搬家', async () => {
  const t = await submitTask({ text: '# 被依赖\nx', board: board.id, project: repoA.key });
  await submitTask({ text: '# 依赖方\nx', board: board.id, project: repoA.key });
  // 后一条依赖前一条（T04：外部直写走 repo；按文本找「依赖方」——前面测试的
  // tombstone 会让"队尾"不再是本测试刚提交的那条）
  const list = (await svc.loadStore()).topics[aKey].tasks.filter((x) => !x.deletedAt);
  const dependent = list.find((x) => x.text.includes('依赖方'));
  svc.repo.tasks.updateTaskByKey(aKey, dependent.id, { blockBy: [t.task.id] });
  await assert.rejects(
    () => updateAction.run({ id: t.task.id, cwd: dirA, text: swapProject(t.task.text) }),
    /被 #\d+ 依赖/,
  );
});

test('闸门 → 拒绝搬家', async () => {
  const t = await submitTask({ text: '# 闸门任务\nx', board: board.id, project: repoA.key });
  await svc.updateTask({ cwd: dirA, id: t.task.id, blocksFollowing: true });
  await assert.rejects(
    () => updateAction.run({ id: t.task.id, cwd: dirA, text: swapProject(t.task.text) }),
    /闸门/,
  );
  // 收尾清掉闸门：别挡住后面测试在同一队列里的领取
  await svc.updateTask({ cwd: dirA, id: t.task.id, blocksFollowing: false });
});

/** 队列里积了前面测试的任务，逐条领到目标那条为止（被挡的会被 findFirstReadyPending 跳过） */
async function claimUntil(key, taskId) {
  for (let i = 0; i < 50; i++) {
    const got = await svc.consumeFirstPending(key, '测试领取');
    if (!got) break;
    if (Number(got.id) === Number(taskId)) return got;
  }
  throw new Error(`没能领到 #${taskId}`);
}

test('已领取的任务 → 拒绝改归属', async () => {
  const r = await submitTask({ text: '# 已领\nx', board: board.id, project: repoA.key });
  const key = svc.normalizeCwd(dirA).key;
  await claimUntil(key, r.task.id);
  await assert.rejects(
    () => updateAction.run({ id: r.task.id, cwd: dirA, text: swapProject(r.task.text) }),
    /已领取.*不能改归属/,
  );
});

test('归属改成未登记的项目 → 明确报错（不静默吞掉）', async () => {
  const r = await submitTask({ text: '# 正常任务\nx', board: board.id, project: repoA.key });
  await assert.rejects(
    () =>
      updateAction.run({
        id: r.task.id,
        cwd: dirA,
        text: r.task.text.replace(`project: ${repoA.key}`, 'project: ghost/none'),
      }),
    /改归属失败.*找不到项目/,
  );
});

test('跨队列引用（"key:id"）指向别的队列 → 搬家不受影响', async () => {
  const here = await submitTask({ text: '# 本地任务\nx', board: board.id, project: repoA.key });
  await svc.updateTask({ cwd: dirA, id: here.task.id, blockBy: [`${bKey}:99`] });
  const upd = await updateAction.run({ id: here.task.id, cwd: dirA, text: swapProject(here.task.text) });
  assert.equal(upd.moved, true, '外来引用是绝对地址，搬家不断链');
  assert.deepEqual(upd.task.blockBy, [`${bKey}:99`], '跨队列引用原样保留');
});

test('reopen 带着改过的归属 → 同样搬家', async () => {
  const r = await submitTask({ text: '# 待重开\nx', board: board.id, project: repoA.key });
  const key = svc.normalizeCwd(dirA).key;
  await claimUntil(key, r.task.id);
  const re = await reopenAction.run({ id: r.task.id, cwd: dirA, text: swapProject(r.task.text) });
  assert.equal(re.moved, true);
  assert.equal(re.key, bKey, '落到 B 的队列');
  assert.equal(re.task.status, 'pending', '重开语义不变：回到待领取');
  const inB = await svc.getTask({ cwd: dirB, id: re.id });
  assert.equal(parseFrontmatter(inB.text).project, repoB.key);
});

test('历史脏数据自愈：归属字段与所在队列对不上 → 保存时搬过去', async () => {
  // #43 现场形态：上一轮把 project 改成了 B 但队列还在 A——字段没变，怎么改都「没有变化」。
  // 判据是不变式（队列 == 归属项目的队列），不是字段 diff。
  const r = await svc.addTask({
    cwd: dirA,
    text: `---\nboard: ${board.id}\nproject: ${repoB.key}\n---\n# 脏数据任务\nx`,
  });
  assert.ok(samePath(r.cwd, dirA), '脏数据：任务在 A 队列，fm.project 却指着 B');
  const upd = await updateAction.run({ id: r.task.id, cwd: dirA, text: `${r.task.text}\n补充` });
  assert.equal(upd.moved, true, '队列与归属对不上 → 保存时自愈搬家');
  assert.ok(samePath(upd.cwd, dirB));
  const inB = await svc.getTask({ cwd: dirB, id: upd.task.id });
  const fm = parseFrontmatter(inB.text);
  assert.equal(fm.project, repoB.key);
  assert.equal(fm.projectIntro, `repo/${repoB.key}.md`, '补齐介绍引用');
});

test('历史脏数据但已领取 → 不搬也不拦普通编辑', async () => {
  const r = await svc.addTask({
    cwd: dirA,
    text: `---\nboard: ${board.id}\nproject: ${repoB.key}\n---\n# 已领的脏数据\nx`,
  });
  const key = svc.normalizeCwd(dirA).key;
  await claimUntil(key, r.task.id);
  const upd = await updateAction.run({ id: r.task.id, cwd: dirA, text: `${r.task.text}\n补充` });
  assert.equal(upd.moved, false, '已领取不搬（历史绑在原队列）');
  assert.ok(samePath(upd.cwd, dirA));
  const back = await svc.getTask({ cwd: dirA, id: r.task.id });
  assert.ok(back.text.includes('补充'), '普通编辑照常生效');
});

test('历史脏数据但带本地依赖 → 不搬也不拦普通编辑', async () => {
  await svc.addTask({ cwd: dirA, text: '# 依赖源\nx' });
  const r = await svc.addTask({
    cwd: dirA,
    text: `---\nboard: ${board.id}\nproject: ${repoB.key}\n---\n# 带依赖的脏数据\nx`,
  });
  await svc.updateTask({ cwd: dirA, id: r.task.id, blockBy: [r.task.id - 1] });
  const upd = await updateAction.run({ id: r.task.id, cwd: dirA, text: `${r.task.text}\n补充` });
  assert.equal(upd.moved, false, '有队列内依赖不搬');
  assert.ok(samePath(upd.cwd, dirA));
  const back = await svc.getTask({ cwd: dirA, id: r.task.id });
  assert.ok(back.text.includes('补充'), '普通编辑照常生效');
});

test('清理', () => {
  try { svc.closeDb(); } catch { /* ignore */ }
  rmSync(sb, { recursive: true, force: true, maxRetries: 3 });
});
