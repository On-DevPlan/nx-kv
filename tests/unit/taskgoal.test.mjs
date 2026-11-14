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
  // #90：拦截文案走可配置的 doneguard 模板（默认文案含门禁标题、剩余时间与下一步指令）
  assert.match(done.guard, /完成门禁/);
  assert.match(done.guard, /剩余/);
  assert.match(done.guard, /timegoal check --task task:/);
  assert.doesNotMatch(done.guard, /\{\{/, '渲染后不应残留占位符');

  // timegoal check --task：任务维度 check 可用（日志落 timegoal 存储）
  const tg = await import('../../src/modules/tasktool/timegoal.js');
  // T03：key 由完整 cwd 派生（topicKeyOf），与领取时 ensureTaskGoal 的 key 同源
  const key = tg.taskGoalKey(localtask.normalizeCwd(cwd).key, 1);
  const chk = await tg.checkGoalByKey(key, { summary: '推进中' });
  assert.equal(chk.hasGoal, true);
  assert.equal(chk.reached, false);
  // #87：check 返回对象带任务实时原文，prompt 按当下 ctx 同源渲染（占位符不残留）
  assert.equal(chk.task.id, 1);
  assert.match(chk.task.text, /改登录页/);
  assert.match(chk.promptRendered, /本任务带时间目标/);
  assert.match(chk.promptRendered, /重点看表单/, '附加要求参与每轮渲染');
  assert.doesNotMatch(chk.promptRendered, /\{\{/, '渲染后不应残留占位符');
  assert.ok(Number.isFinite(chk.goal.remainingSec), 'goal.remainingSec 是渲染期实时值');

  // 到点（拨回过去）→ done 放行 + 最终 check 记录 + completedAt
  await retime();
  const done2 = await localtask.completeTask({ cwd, id: 1, summary: '真的完成了' });
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
  assert.match(r.instruction, /每次最多阻塞 1 分钟/, '阻塞窗口分钟数要传给 getloop 模板');

  // 阻塞形态：队列空 + 持续 get 开 → 阻塞到窗口上限（这里 1s 显式缩短验证 timeout 出口）
  const t0 = Date.now();
  const r2 = await getTask({ cwd, summary: '再领', timeoutSec: 1 });
  assert.equal(r2.status, 'timeout');
  assert.ok(Date.now() - t0 >= 900, '开启持续 get 后确实阻塞了窗口');
});

test('HTTP 领取：claim 路由存在，且 instant 强制立即返回（持续 get 也不挂住请求）', async () => {
  const { ACTIONS } = await import('../../src/runtime/registry.js');
  const claim = ACTIONS.find((a) => a.id === 'localtask.claim');
  assert.deepEqual(claim.http, ['POST', '/api/localtasks/claim'], '领取补上了 POST 路由');

  const repos = await import('../../src/modules/repos/service.js');
  const { getTask } = await import('../../src/modules/tasktool/get.js');
  const cwd = join(dir, 'claim-http');
  const repo = await repos.addRepo({ path: cwd, name: 'claim-http', remote: 'https://github.com/me/ch' });
  await repos.updateRepo(repo.id, { getLoop: { enabled: true, waitMinutes: 5 } });

  // 队列空 + 持续 get 开：HTTP 侧必须立即 timeout（不阻塞）
  const t0 = Date.now();
  const r = await getTask({ cwd, instant: true, open: false });
  assert.equal(r.status, 'timeout');
  assert.ok(Date.now() - t0 < 1000, 'instant 覆盖持续 get 的阻塞窗口');
});

test('repo getLoop 落库：部分更新与已有字段合并（#182 起只有开关 + 分钟）', async () => {
  const repos = await import('../../src/modules/repos/service.js');
  const cwd = join(dir, 'gl');
  const repo = await repos.addRepo({ path: cwd, name: 'gl', remote: 'https://github.com/me/gl' });
  await repos.updateRepo(repo.id, { getLoop: { enabled: true, waitMinutes: 5 } });
  // 只传分钟：开关不被抹掉（合并语义）
  await repos.updateRepo(repo.id, { getLoop: { waitMinutes: 6 } });
  const detail = await repos.getRepo(repo.id);
  assert.equal(detail.getLoop.enabled, true);
  assert.equal(detail.getLoop.waitMinutes, 6);
  // 历史 template 字段已不在契约里：传了被忽略，老数据顺势剥掉
  await repos.updateRepo(repo.id, { getLoop: { template: '继续干' } });
  assert.equal((await repos.getRepo(repo.id)).getLoop.template, undefined, '仓库级文案已下线');
  await repos.updateRepo(repo.id, { getLoop: null });
  const after = await repos.getRepo(repo.id);
  assert.equal(after.getLoop, undefined);
});

test('HTTP 线缆口径：repo.update 只认 kebab 键（camelCase getLoop 被 zod 剥掉）', async () => {
  // #182 探针抓到的暗病：弹窗 PATCH { getLoop: {...} } → zod 静默剥键（契约里只有
  // `get-loop` / `get-loop-minutes`）→ 「保存成功」但落库纹丝不动。这里把线段钉住。
  const { ACTIONS } = await import('../../src/runtime/registry.js');
  const { parseZodInput } = await import('../../src/runtime/zod-bridge.js');
  const repos = await import('../../src/modules/repos/service.js');
  const act = ACTIONS.find((a) => a.id === 'repo.update');
  assert.ok(act, 'repo.update 已注册');

  const cwd = join(dir, 'gl-wire');
  const repo = await repos.addRepo({ path: cwd, name: 'gl-wire', remote: 'https://github.com/me/gw' });

  // kebab（面板与生成客户端都这么发）→ 真的落库
  await act.run(parseZodInput(act.input, { id: repo.id, 'get-loop': 'on', 'get-loop-minutes': 3 }, 'usage'), { transport: 'http' });
  const after = (await repos.getRepo(repo.id)).getLoop;
  assert.equal(after.enabled, true);
  assert.equal(after.waitMinutes, 3);

  // camelCase → 被剥成只剩 id（这正是当年弹窗的写法）
  const stripped = parseZodInput(act.input, { id: repo.id, getLoop: { enabled: false } }, 'usage');
  assert.deepEqual(stripped, { id: repo.id }, '未声明键被 zod 丢弃，所以弹窗必须发 kebab');
});

test('get：#182 起仓库传 template 不再影响交付（文案归全局 getloop 区块）', async () => {
  const localtask = await import('../../src/modules/localtask/service.js');
  const repos = await import('../../src/modules/repos/service.js');
  const { getTask } = await import('../../src/modules/tasktool/get.js');
  const cwd = join(dir, 'loop-multi');
  const repo = await repos.addRepo({ path: cwd, name: 'loop-multi', remote: 'https://github.com/me/lm' });
  await repos.updateRepo(repo.id, { getLoop: { enabled: true, waitMinutes: 1, template: ['GO_ON_1', '等{{getloop.waitMinutes}}分'] } });
  await localtask.addTask({ text: '多模板任务', cwd });
  const r = await getTask({ cwd, summary: '领活' });
  assert.equal(r.status, 'ok');
  assert.equal(r.getLoop, true);
  assert.doesNotMatch(String(r.instruction || ''), /GO_ON_1/, '仓库级自定义文案不再进入交付');
  assert.match(r.instruction, /每次最多阻塞 1 分钟/, '交付文案来自全局区块（分钟槽位仍生效）');
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

// #112：「持续 get」的阻塞窗口允许配 0（用户口径：这是 **get 命令自己**没任务时阻塞
// 多久，不是让 agent 睡）。0 = 不阻塞、没活立即 timeout；提示词里那句「最多阻塞 N 分钟」
// 在 0 时整句不出现（不给 0 另造说法）。
test('#112 阻塞窗口 0：契约接受并落库，不再被归一成默认 10 分钟', async () => {
  const { sanitizeGetLoop } = await import('../../src/modules/tasktool/plugins/waitgoal-config.js');
  const decl = sanitizeGetLoop({ enabled: true, waitMinutes: 0 });
  assert.equal(decl.waitMinutes, 0, '0 必须原样保留');
  const on = sanitizeGetLoop({ enabled: true });
  assert.equal(on.waitMinutes, undefined, '没给分钟数 → 不写字段（读时回落默认）');
  const neg = sanitizeGetLoop({ enabled: true, waitMinutes: -3 });
  assert.equal(neg.waitMinutes, undefined, '负数不是合法窗口');
});

test('#112 getloop 模板：窗口 0 时整句不出现；>0 才报分钟数', async () => {
  const { renderInstruction } = await import('../../src/core/instruction-template.js');
  const { DEFAULT_GETLOOP_TEMPLATE } = await import('../../src/shared/prompt-blocks.js');

  const zero = renderInstruction(DEFAULT_GETLOOP_TEMPLATE, { task: { id: 7 }, getloop: { text: '', waitMinutes: 0 } });
  assert.match(zero, /继续调用 nx-kv localtask get/, '「完成后再 get」这层意思保留');
  assert.doesNotMatch(zero, /最多阻塞/, '0 时不能出现阻塞时长那句');
  assert.doesNotMatch(zero, /0 分钟/, '更不能渲染成「最多阻塞 0 分钟」');

  const five = renderInstruction(DEFAULT_GETLOOP_TEMPLATE, { task: { id: 7 }, getloop: { text: '', waitMinutes: 5 } });
  assert.match(five, /最多阻塞 5 分钟/);
});

test('#112 窗口 0：get 不阻塞，没任务立刻 timeout（不等默认超时）', async () => {
  const repos = await import('../../src/modules/repos/service.js');
  const { getTask } = await import('../../src/modules/tasktool/get.js');
  const cwd = join(dir, 'loop-zero');
  const repo = await repos.addRepo({ path: cwd, name: 'loop-zero', remote: 'https://github.com/me/loop-zero' });
  await repos.updateRepo(repo.id, { getLoop: { enabled: true, waitMinutes: 0 } });

  const t0 = Date.now();
  const r = await getTask({ cwd, summary: '领活' });
  assert.equal(r.status, 'timeout');
  assert.ok(Date.now() - t0 < 2000, '窗口 0 = 不阻塞（不是睡一觉再返回）');
});

// #123：阻塞等待只剩一条路——get 加 --timeout。显式给上限时，即使项目没开「持续 get」
// 也要真的阻塞（旧 localtask wait 的能力并入 get）；不给参数则维持「立即返回 timeout」。
test('#123 get --timeout 在未开启持续 get 时也阻塞（wait 能力并入 get）', async () => {
  const { getTask } = await import('../../src/modules/tasktool/get.js');
  const cwd = join(dir, 'wait-by-timeout');
  const t0 = Date.now();
  const r = await getTask({ cwd, timeoutSec: 1 });
  assert.equal(r.status, 'timeout');
  assert.ok(Date.now() - t0 >= 900, '显式 timeout 必须真的阻塞到这个上限');

  const t1 = Date.now();
  const r2 = await getTask({ cwd });
  assert.equal(r2.status, 'timeout');
  assert.ok(Date.now() - t1 < 2000, '不给参数仍是立即返回（默认直接领）');
});
