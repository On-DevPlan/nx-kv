// 任务级 timegoal + 完成门禁 + get 语义（tasktool）的单元测试。
//
// 全链路：add 带 --duration → 领取（waitForTask 快路径）交付带 check 指令 →
// done 未到点 blocked → 到点后 done 放行并记录最终 check。get 的两种形态
// （默认直接领 / 项目开启持续 get 后阻塞）也在这里钉住。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-tasktool-'));
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  // T06：timegoal 落库（goals/goal_checks 表），与 localtask 同一份 nxkv.db，
  // 不再有独立的 NX_KV_TIMEGOAL_STORE —— 隔离由上述两个 env 的目录决定。
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(async () => {
  try {
    const { closeDb } = await import('../../src/core/db/index.js');
    closeDb();
  } catch {
    /* 尚未打开 */
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

const retime = async (pastMin = 5) => {
  // 把唯一的任务级 goal 拨回到过去（deadline 已过）——模拟「时间已到点」。
  // T06：goal 在 goals 表（epoch ms），直接 UPDATE（JSON 时代是改文件）。
  // goals 表有 CHECK (deadline > started_at)，所以 deadline 取起点 +1s（仍在过去）。
  const { getDb } = await import('../../src/core/db/index.js');
  const past = Date.now() - pastMin * 60000;
  getDb().run('UPDATE goals SET started_at = :s, deadline = :d WHERE deleted_at IS NULL', {
    s: past,
    d: past + 1000,
  });
};

test('add --duration：任务记录带 timegoal 声明；领取交付带 check 指令', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');
  const cwd = join(dir, 'proj');
  const added = await localtask.addTask({ text: '改登录页', cwd, timegoal: { duration: '1m', prompt: '重点看表单' } });
  assert.ok(added.task.timegoal, '任务记录带 timegoal 声明');
  assert.equal(added.task.timegoal.duration, '1m');

  const r = await waitForTask({ cwd, summary: '开干', timeoutSec: 1, open: false });
  assert.equal(r.status, 'ok');
  assert.match(r.instruction, /timegoal check --task task:/, '交付文本带任务级 check 指令');
  assert.match(r.instruction, /localtask done --id 1/, '交付文本带完成指令');
  assert.match(r.instruction, /重点看表单/, '发布方附加要求随指令固化');

  // done 门禁：未到点 → blocked（业务结果，不是抛错）
  const done = await localtask.completeTask({ cwd, id: 1, summary: '提前收工' });
  assert.equal(done.status, 'blocked');
  assert.equal(done.reason, 'goal_not_reached');
  assert.ok(done.remainingSec > 0);
  assert.match(done.hint, /sub agent/);

  // timegoal check --task：任务维度 check 可用（日志落 timegoal 存储）
  const tg = await import('../../src/modules/tasktool/timegoal.js');
  // T03：key 由完整 cwd 派生（topicKeyOf），与领取时 ensureTaskGoal 的 key 同源
  const key = tg.taskGoalKey(localtask.normalizeCwd(cwd).key, 1);
  const chk = await tg.checkGoalByKey(key, { summary: '推进中', progress: '50%' });
  assert.equal(chk.hasGoal, true);
  assert.equal(chk.reached, false);

  // 到点（拨回过去）→ done 放行 + 最终 check 记录 + completedAt
  await retime();
  const done2 = await localtask.completeTask({ cwd, id: 1, summary: '真的完成了', progress: '100%' });
  assert.equal(done2.status, 'ok');
  assert.ok(done2.task.completedAt);
  assert.equal(done2.goal.recorded, true);
  // 最终 check 落在了任务级 goal 的流水里（goal_checks 表，T06）
  const { getDb } = await import('../../src/core/db/index.js');
  const summaries = getDb()
    .all(
      `SELECT gc.summary FROM goal_checks gc JOIN goals g ON g.id = gc.goal_id WHERE g.deleted_at IS NULL`
    )
    .map((r) => {
      try {
        return JSON.parse(r.summary).summary;
      } catch {
        return r.summary;
      }
    });
  assert.ok(summaries.length >= 2, '推进中 + 最终 check 两条流水都在');
  assert.ok(summaries.includes('真的完成了'), 'done 自动记录最终 check');
});

test('done：未领取 blocked；无 timegoal 直接放行；重复 done 幂等', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');
  const cwd = join(dir, 'proj2');
  const plain = await localtask.addTask({ text: '普通任务', cwd });
  const notClaimed = await localtask.completeTask({ cwd, id: plain.task.id, summary: 'x' });
  assert.equal(notClaimed.status, 'blocked');
  assert.equal(notClaimed.reason, 'not_claimed');

  await waitForTask({ cwd, summary: '领取', timeoutSec: 1, open: false });
  const ok = await localtask.completeTask({ cwd, id: plain.task.id, summary: '完成' });
  assert.equal(ok.status, 'ok');
  assert.ok(ok.task.completedAt);

  const again = await localtask.completeTask({ cwd, id: plain.task.id, summary: '重复' });
  assert.equal(again.status, 'ok');
  assert.equal(again.already, true);
});

test('get：默认直接领（无任务立即 instant timeout，不阻塞）', async () => {
  const { getTask } = await import('../../src/modules/tasktool/get.js');
  const cwd = join(dir, 'empty-proj');
  const t0 = Date.now();
  const r = await getTask({ cwd, summary: '领活' });
  assert.equal(r.status, 'timeout');
  assert.equal(r.instant, true);
  assert.ok(Date.now() - t0 < 2000, '未开启持续 get 时不阻塞');
});

test('get：项目开启持续 get → 交付文本带「继续 get」模板；done 指令不变', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const repos = await import('../../src/modules/repos/service.js');
  const { getTask } = await import('../../src/modules/tasktool/get.js');
  const cwd = join(dir, 'loop-proj');
  const repo = await repos.addRepo({ path: cwd, name: 'loop-proj', remote: 'https://github.com/me/loop' });
  await repos.updateRepo(repo.id, { getLoop: { enabled: true, waitMinutes: 1 } });

  await localtask.addTask({ text: '被领取的任务', cwd });
  const r = await getTask({ cwd, summary: '领活' });
  assert.equal(r.status, 'ok');
  assert.equal(r.getLoop, true);
  assert.match(r.instruction, /localtask get/, '交付文本带继续 get 模板');

  // 阻塞形态：队列空 + 持续 get 开 → 阻塞到窗口上限（这里 1s 显式缩短验证 timeout 出口）
  const t0 = Date.now();
  const r2 = await getTask({ cwd, summary: '再领', timeoutSec: 1 });
  assert.equal(r2.status, 'timeout');
  assert.ok(Date.now() - t0 >= 900, '开启持续 get 后确实阻塞了窗口');
});

test('repo getLoop 落库：部分更新与已有字段合并', async () => {
  const repos = await import('../../src/modules/repos/service.js');
  const cwd = join(dir, 'gl');
  const repo = await repos.addRepo({ path: cwd, name: 'gl', remote: 'https://github.com/me/gl' });
  await repos.updateRepo(repo.id, { getLoop: { enabled: true, waitMinutes: 5 } });
  await repos.updateRepo(repo.id, { getLoop: { template: '继续干' } });
  const detail = await repos.getRepo(repo.id);
  assert.equal(detail.getLoop.enabled, true);
  assert.equal(detail.getLoop.waitMinutes, 5);
  assert.deepEqual(detail.getLoop.template, ['继续干'], '模板落库为列表（v0.14 多条；旧 string 迁入）');
  // 多条 + 空条丢弃 + 旧 string 整体算一条
  await repos.updateRepo(repo.id, { getLoop: { template: ['A', '', '  B  '] } });
  assert.deepEqual((await repos.getRepo(repo.id)).getLoop.template, ['A', 'B']);
  await repos.updateRepo(repo.id, { getLoop: null });
  const after = await repos.getRepo(repo.id);
  assert.equal(after.getLoop, undefined);
});

test('get：多条持续 get 模板按空行拼接后统一渲染', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const repos = await import('../../src/modules/repos/service.js');
  const { getTask } = await import('../../src/modules/tasktool/get.js');
  const cwd = join(dir, 'loop-multi');
  const repo = await repos.addRepo({ path: cwd, name: 'loop-multi', remote: 'https://github.com/me/lm' });
  await repos.updateRepo(repo.id, { getLoop: { enabled: true, waitMinutes: 1, template: ['GO_ON_1', '{{task.text}}||GO_ON_2'] } });
  await localtask.addTask({ text: '多模板任务', cwd });
  const r = await getTask({ cwd, summary: '领活' });
  assert.equal(r.status, 'ok');
  assert.equal(r.getLoop, true);
  assert.match(r.instruction, /GO_ON_1\n\n[\s\S]*多模板任务\|\|GO_ON_2/, '多条模板拼接成单段统一渲染');
});

test('修改反馈 → 重开：派生新任务，旧任务 done 定格（#74 派生口径）', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const { waitForTask } = await import('../../src/modules/tasktool/wait.js');
  const cwd = join(dir, 'reopen-proj');
  await localtask.addTask({ text: '改登录页', cwd });

  const first = await waitForTask({ cwd, summary: '开干', timeoutSec: 1, open: false });
  assert.equal(first.status, 'ok');
  const id = first.task.id;

  const done = await localtask.completeTask({ cwd, id, summary: '第一轮完成' });
  assert.equal(done.status, 'ok');
  assert.ok(done.task.completedAt);

  const re = await localtask.reopenTask({ cwd, id, text: '改登录页（不对，要加暗色模式）' });
  assert.equal(re.status, 'ok');
  assert.notEqual(re.id, id, '派生新编号（R2）');
  assert.equal(re.parentId, id);
  assert.equal(re.forked, false);
  assert.equal(re.task.status, 'pending');
  assert.equal(re.task.consumedAt, '', '新任务未领取');
  assert.equal(re.task.completedAt, '');
  assert.match(re.task.text, /暗色模式/);
  // 父任务 done 定格：R1 的交付事实原样保留
  const parent = await localtask.getTask({ cwd, id });
  assert.equal(parent.status, 'done');
  assert.ok(parent.completedAt);

  const again = await waitForTask({ cwd, summary: '再来一轮', timeoutSec: 1, open: false });
  assert.equal(again.status, 'ok');
  assert.equal(again.task.id, re.id, '领到的是派生出的 R2');
  assert.match(again.task.text, /暗色模式/);
});

test('项目图标：写入后读回（≤8 字）', async () => {
  const repos = await import('../../src/modules/repos/service.js');
  const cwd = join(dir, 'icon-proj');
  const r = await repos.addRepo({ path: cwd, name: 'icon-proj', remote: 'https://github.com/me/icon' });
  await repos.updateRepo(r.id, { icon: '🧭' });
  const detail = await repos.getRepo(r.id);
  assert.equal(detail.icon, '🧭');
  await repos.updateRepo(r.id, { icon: 'abcdefghijk' });
  assert.equal((await repos.getRepo(r.id)).icon.length, 8);
  await repos.updateRepo(r.id, { icon: '' });
  assert.equal((await repos.getRepo(r.id)).icon, '');
});

test('get：未开启持续 get → 交付**不带**「继续 get」指令（默认就是直接领）', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const repos = await import('../../src/modules/repos/service.js');
  const { getTask } = await import('../../src/modules/tasktool/get.js');
  const cwd = join(dir, 'plain-proj');
  await repos.addRepo({ path: cwd, name: 'plain-proj', remote: 'https://github.com/me/plain' });

  await localtask.addTask({ text: '普通任务', cwd });
  const r = await getTask({ cwd, summary: '领活' });
  assert.equal(r.status, 'ok');
  assert.equal(r.getLoop, undefined, '没有持续 get 就不该标记');
  assert.doesNotMatch(String(r.instruction || ''), /继续调用 nx-kv localtask get/, '默认形态不带循环指令');
});

test('修改反馈 / 编辑任务：换正文不丢 frontmatter（归组信息保住）', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const cwd = join(dir, 'fm-proj');
  const text = '---\nboard: b_1\nproject: local/x\n---\n# 旧标题\n旧正文';
  await localtask.addTask({ text, cwd });

  const up = await localtask.updateTask({ cwd, id: 1, text: '# 新标题\n新正文' });
  assert.match(up.task.text, /board: b_1/, 'update 保住 frontmatter');
  assert.match(up.task.text, /project: local\/x/);
  assert.match(up.task.text, /新正文/);

  const re = await localtask.reopenTask({ cwd, id: 1, text: '# 再改\n再改的正文' });
  assert.match(re.task.text, /board: b_1/, 'reopen 保住 frontmatter');
  assert.match(re.task.text, /project: local\/x/);
  assert.match(re.task.text, /再改的正文/);
});
