// 「时间目标到点 → 本轮自动收尾」测试。
//
// 语义：wait 阻塞等的是"下一条任务"。如果这个目录挂着**时间目标**（这一局的
// 预算），预算到点这一局就结束了 —— agent 不该在预算外继续空等（它等的正是
// 下一条任务，而预算已经用完）。到点即收尾，走与超时同一条出口：
// status:"timeout" + cancelled:true + reason:"goal_expired"。
//
// 覆盖四件事：
//   1. 目标到点后，阻塞中的 wait **立即**返回（远快于自己的超时）；
//   2. 目标**没**到点 → wait 照常阻塞到超时（不能被误杀）；
//   3. 这个目录**没有**目标 → wait 照常阻塞（探针 fail-open，绝不能把 wait 卡死）；
//   4. 队列里**还有**任务时照常领走（目标到点不该把已经排好的任务扣住）。
//
// 存储一律指向临时文件（NX_KV_LOCALTASK_STORE / NX_KV_TIMEGOAL_STORE），
// 绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';
import * as tgsvc from '../../src/modules/timegoal/service.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-goalexp-'));
const storeFile = join(tmp, 'localtasks.json');
const goalFile = join(tmp, 'timegoals.json');
const dir = join(tmp, 'projG');
mkdirSync(dir, { recursive: true });
process.env.NX_KV_LOCALTASK_STORE = storeFile;
process.env.NX_KV_TIMEGOAL_STORE = goalFile;
// 隔离登录态：指向不存在的配置，保证远程发现稳定走「未登录」分支（不触网）
process.env.NX_KV_CONFIG = join(tmp, 'config.json');

process.on('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结果 */
  }
});

const key = svc.normalizeCwd(dir).key;
const PROMPT = '把 nx-kv 面板的视觉再收一遍';

async function reset() {
  rmSync(storeFile, { force: true });
  rmSync(goalFile, { force: true });
}

// 把 store 里某个 goal 的 deadline 挪到过去（模拟"已经到点"）
function expireGoal(k, agoSec = 3600) {
  const raw = JSON.parse(readFileSync(goalFile, 'utf8'));
  const past = new Date(Date.now() - agoSec * 1000);
  raw.goals[k].startedAt = tgsvc.stampNow(past);
  raw.goals[k].deadline = tgsvc.stampNow(new Date(past.getTime() - 60 * 1000));
  writeFileSync(goalFile, JSON.stringify(raw, null, 2), 'utf8');
}

// 把 deadline 挪到 inSec 秒后（模拟"再等一会儿就到点"）
function setDeadlineIn(k, inSec) {
  const raw = JSON.parse(readFileSync(goalFile, 'utf8'));
  raw.goals[k].deadline = tgsvc.stampNow(new Date(Date.now() + inSec * 1000));
  writeFileSync(goalFile, JSON.stringify(raw, null, 2), 'utf8');
}

test('目标在等待期间到点：wait 立刻收尾（cancelled + reason=goal_expired）', async () => {
  await reset();
  await tgsvc.setTimegoal({ cwd: dir, durationSec: 3600, prompt: PROMPT });
  setDeadlineIn(key, 2); // 等待开始时还在跑，2 秒后到点

  const t0 = Date.now();
  const r = await svc.waitForTask({
    cwd: dir,
    summary: '预算用完了',
    timeoutSec: 60, // 远大于实际耗时：能证明是"到点收尾"而不是"等到超时"
    open: false,
  });
  const cost = Date.now() - t0;

  assert.equal(r.status, 'timeout', '与超时同一条出口，agent 侧不必认识新状态');
  assert.equal(r.cancelled, true);
  assert.equal(r.reason, 'goal_expired');
  assert.ok(cost < 8000, `到点应立即收尾，实际 ${cost}ms`);

  // 等待态复位（到点立即收尾时主题可能还没建出来）
  const d = await svc.listTasks();
  assert.equal(d.waiting, 0, '等待态应已复位');
  for (const t of d.topics) {
    assert.equal(t.waiting, false, '不能留下"等待中"的残影');
  }
});

test('目标早就过期（等待开始前就到点）：wait 照常阻塞，不把这个目录焊死', async () => {
  await reset();
  await tgsvc.setTimegoal({ cwd: dir, durationSec: 3600, prompt: PROMPT });
  expireGoal(key); // 早就到点了

  const t0 = Date.now();
  const r = await svc.waitForTask({ cwd: dir, summary: '老目标', timeoutSec: 1, open: false });
  const cost = Date.now() - t0;

  assert.equal(r.status, 'timeout');
  assert.notEqual(r.cancelled, true, '早就过期的目标不该每次 wait 都秒回');
  assert.ok(cost >= 900, `应当正常等到超时，实际 ${cost}ms`);
});

test('目标没到点：wait 照常阻塞到超时（不能被误杀）', async () => {
  await reset();
  await tgsvc.setTimegoal({ cwd: dir, durationSec: 3600, prompt: PROMPT }); // 1 小时后才到点

  const t0 = Date.now();
  const r = await svc.waitForTask({ cwd: dir, summary: '还在预算内', timeoutSec: 1, open: false });
  const cost = Date.now() - t0;

  assert.equal(r.status, 'timeout');
  assert.notEqual(r.cancelled, true, '没到点不该被取消');
  assert.ok(cost >= 900, `应当正常等到超时，实际 ${cost}ms`);
  // timeout 返回形状是钉死的契约：字段集合固定，instruction 绝不出现在超时返回里
  assert.deepEqual(
    Object.keys(r).sort(),
    ['cwd', 'key', 'status', 'summary', 'timeoutMs'],
    'timeout 返回只含这五个字段（新增字段不许混进来）'
  );
});

test('这个目录没有时间目标：wait 照常阻塞（探针 fail-open，不能把 wait 卡死）', async () => {
  await reset();

  const t0 = Date.now();
  const r = await svc.waitForTask({ cwd: dir, summary: '没有目标', timeoutSec: 1, open: false });
  const cost = Date.now() - t0;

  assert.equal(r.status, 'timeout');
  assert.notEqual(r.cancelled, true);
  assert.ok(cost >= 900, `应当正常等到超时，实际 ${cost}ms`);
});

test('目标到点但队列里还有任务：照常领走（到点不该把已排好的任务扣住）', async () => {
  await reset();
  await tgsvc.setTimegoal({ cwd: dir, durationSec: 3600, prompt: PROMPT });
  setDeadlineIn(key, 2);
  await svc.addTask({ cwd: dir, text: '队列里排着的任务' });

  const r = await svc.waitForTask({ cwd: dir, summary: '有活先干', timeoutSec: 1, open: false });

  assert.equal(r.status, 'ok', '队列里有活就先领走');
  // 默认后缀已升级为模板：task.text 保持库存原文（精确相等），收尾指令在 instruction 字段
  assert.equal(r.task.text, '队列里排着的任务', '模板模式下 task.text 不再追加');
  assert.ok(r.instruction.includes('规划计划'), 'instruction 含默认模板的收尾指令');
});

test('goal 存活时 wait 的 instruction 携带目标状态（默认模板），且只读不落盘', async () => {
  await reset();
  await tgsvc.setTimegoal({ cwd: dir, durationSec: 3600, prompt: PROMPT });
  await svc.addTask({ cwd: dir, text: 'BODY' });

  const before = readFileSync(goalFile, 'utf8');
  const r = await svc.waitForTask({ cwd: dir, summary: 's', timeoutSec: 5, open: false });
  const after = readFileSync(goalFile, 'utf8');

  assert.equal(r.status, 'ok');
  assert.equal(r.task.text, 'BODY', 'task.text 保持库存原文');
  assert.ok(
    r.instruction.includes(`〔时间目标「projG」剩余`),
    `instruction 含默认模板 goal 段：${JSON.stringify(r.instruction)}`
  );
  assert.ok(r.instruction.includes('规划计划'), '收尾指令在 goal 段之后');
  assert.ok(!r.instruction.includes(PROMPT), '默认模板不携带 prompt 原文（投递保持轻量；prompt 走 check 回显）');
  assert.equal(after, before, 'wait 渲染不许写 timegoal store（showTimegoal 只读契约）');
});

test('自定义模板含 {{goal.prompt}}：prompt 原文逐字嵌入（防漂移契约的字符串学保证）', async () => {
  await reset();
  await tgsvc.setTimegoal({ cwd: dir, durationSec: 3600, prompt: '根指令：含 {{字面}} 与 {{#goal}} 的原文' });
  await svc.updateSettings({ taskSuffix: '{{#goal}}PROMPT>>{{goal.prompt}}<<{{/goal}}' });
  await svc.addTask({ cwd: dir, text: 'BODY' });

  const r = await svc.waitForTask({ cwd: dir, summary: 's', timeoutSec: 5, open: false });

  assert.equal(
    r.instruction,
    'PROMPT>>根指令：含 {{字面}} 与 {{#goal}} 的原文<<',
    '单遍渲染：prompt 里的 {{...}} 与段落标记逐字原样，不再展开'
  );
});

test('goal 已到点：instruction 显示已到点（信息性），领取不受影响', async () => {
  await reset();
  await tgsvc.setTimegoal({ cwd: dir, durationSec: 3600, prompt: PROMPT });
  expireGoal(key); // 等待开始前就到点了
  await svc.addTask({ cwd: dir, text: '到期后的活' });

  const r = await svc.waitForTask({ cwd: dir, summary: 's', timeoutSec: 5, open: false });

  assert.equal(r.status, 'ok', '早就过期的目标不扣任务');
  assert.ok(r.instruction.includes('已到点'), `渲染出已到点状态：${JSON.stringify(r.instruction)}`);
  assert.ok(!r.instruction.includes('剩余'), '到点后不再是「剩余」措辞');
});

test('全局池投递也渲染等待方目录的 goal（goal 属于等待中的 agent 目录）', async () => {
  await reset();
  await tgsvc.setTimegoal({ cwd: dir, durationSec: 3600, prompt: PROMPT });
  await svc.addTask({ text: '池子里的活', global: true });

  const r = await svc.waitForTask({ cwd: dir, summary: 's', timeoutSec: 5, open: false });

  assert.equal(r.status, 'ok');
  assert.equal(r.source, 'global', '从全局池领到');
  assert.ok(
    r.instruction.includes('〔时间目标「projG」剩余'),
    `全局任务也带等待目录的 goal 段：${JSON.stringify(r.instruction)}`
  );
});

test('probeGoalExpiry：只读、不改状态（探针不写盘、不归档）', async () => {
  await reset();
  await tgsvc.setTimegoal({ cwd: dir, durationSec: 3600, prompt: PROMPT });

  const before = readFileSync(goalFile, 'utf8');
  const live = await tgsvc.probeGoalExpiry(key);
  assert.equal(live.reached, false);
  assert.equal(live.key, key);
  assert.equal(live.name, 'projG');
  assert.ok(live.deadlineMs > Date.now() - 1000, '探针给出可比较的截止时刻');
  assert.equal(readFileSync(goalFile, 'utf8'), before, '探针不许写盘');

  expireGoal(key);
  const dead = await tgsvc.probeGoalExpiry(key);
  assert.equal(dead.reached, true, '过了 deadline 就算到点');
  assert.equal(await tgsvc.probeGoalExpiry('no-such-key'), null, '没有目标 → null');
});

test('导入的 ref / refs 两个键都认——只认一个会让面板那次静默导 0 条', () => {
  // 回归：action 曾经只读 ctx.ref（CLI 的 flag 名），而面板 body 发的是 refs，
  // 于是面板点「导入」什么也没发生（后端报"要导入的远程任务不能为空"）。
  assert.deepEqual(svc.mergeImportRefs(['面板那条'], undefined), ['面板那条']);
  assert.deepEqual(svc.mergeImportRefs(undefined, ['CLI 那条']), ['CLI 那条']);
  assert.deepEqual(svc.mergeImportRefs(['a'], ['b']), ['a', 'b'], '两个键都在时合并');
  assert.deepEqual(svc.mergeImportRefs(['  a  ', '', null], undefined), ['a'], '去空白与空值');
  assert.deepEqual(svc.mergeImportRefs(undefined, undefined), []);
  // 传进来是字符串（不是数组）时也不能炸
  assert.deepEqual(svc.mergeImportRefs('不是数组', undefined), []);
});
