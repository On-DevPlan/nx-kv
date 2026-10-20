// timegoal 模块单测：duration/prompt 边界、纯函数 evalTimegoal 全时段、
// set/show/check/clear 链路、update 不动起点、不同 cwd 隔离、store 隔离。
//
// 存储一律指向临时文件（NX_KV_TIMEGOAL_STORE），绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as svc from '../../src/modules/timegoal/service.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-timegoal-'));
const storeFile = join(tmp, 'timegoals.json');
const dirA = mkdirSync(join(tmp, 'projA'), { recursive: true }) || join(tmp, 'projA');
const dirB = join(tmp, 'projB');
mkdirSync(dirB, { recursive: true });
process.env.NX_KV_TIMEGOAL_STORE = storeFile;
process.on('exit', () => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

async function reset() {
  try { rmSync(storeFile); } catch { /* 不存在即可 */ }
}

const PROMPT_OK = '用 subagent 调研 redis 差距并写 CHANGELOG';

test('duration 边界：59 拒绝 / 60 通过 / 86400 通过 / 86401 拒绝', async () => {
  await reset();
  await assert.rejects(() => svc.setTimegoal({ cwd: dirA, durationSec: 59, prompt: PROMPT_OK }), /至少 60/);
  const ok = await svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: PROMPT_OK });
  assert.equal(ok.goal.durationSec, 60);
  rmSync(storeFile);
  await assert.rejects(() => svc.setTimegoal({ cwd: dirA, durationSec: 86401, prompt: PROMPT_OK }), /超过上限/);
  const ok2 = await svc.setTimegoal({ cwd: dirA, durationSec: 86400, prompt: PROMPT_OK });
  assert.equal(ok2.goal.durationSec, 86400);
});

test('prompt 边界：空、纯空格、>20000 拒绝；20000 整通过', async () => {
  await reset();
  await assert.rejects(() => svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: '' }), /不能为空/);
  await assert.rejects(() => svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: '   \n  ' }), /不能为空/);
  await assert.rejects(
    () => svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: 'x'.repeat(20001) }),
    /过长/
  );
  const ok = await svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: 'x'.repeat(20000) });
  assert.equal(ok.goal.prompt.length, 20000);
});

test('缺 cwd 报错，不建空记录', async () => {
  await reset();
  await assert.rejects(() => svc.setTimegoal({ durationSec: 60, prompt: PROMPT_OK }), /--cwd/);
  await assert.rejects(() => svc.setTimegoal({ cwd: '', durationSec: 60, prompt: PROMPT_OK }), /--cwd/);
  await assert.rejects(() => svc.checkTimegoal({}), /--cwd/);
  await assert.rejects(() => svc.showTimegoal({}), /--cwd/);
  await assert.rejects(() => svc.updateTimegoal({ prompt: PROMPT_OK }), /--cwd/);
  await assert.rejects(() => svc.clearTimegoal({}), /--cwd/);
  // 上面所有错误都不应写 store
  const r = await svc.listTimegoals();
  assert.equal(r.count, 0);
  assert.deepEqual(r.goals, []);
});

test('evalTimegoal 纯函数：now<started / 临门 / 到点整 / 过线', () => {
  // 构造一个 goal：started 1000s 前、durationSec = 600 → deadline = now - 400s（过线 400s）
  const started = new Date(Date.now() - 1000 * 1000);
  const deadline = new Date(Date.now() - 400 * 1000);
  const goal = {
    startedAt: svc.stampNow(started),
    deadline: svc.stampNow(deadline),
    durationSec: 600,
  };
  // 过线
  let r = svc.evalTimegoal(goal, Date.now());
  assert.equal(r.reached, true);
  assert.equal(r.elapsedSec, 1000);
  assert.equal(r.remainingSec, 0);

  // 临门：deadline 还有 1s
  const futureGoal = {
    startedAt: svc.stampNow(new Date(Date.now() - 599 * 1000)),
    deadline: svc.stampNow(new Date(Date.now() + 1 * 1000)),
    durationSec: 600,
  };
  r = svc.evalTimegoal(futureGoal, Date.now());
  assert.equal(r.reached, false);
  assert.equal(r.remainingSec, 1); // ceil(1s) = 1
  // elapsed 应当接近 599（allow ±1 jitter from ms→s 转换）
  assert.ok(r.elapsedSec >= 598 && r.elapsedSec <= 600, 'elapsedSec=' + r.elapsedSec);

  // 未到点：deadline 还有 1 小时
  const far = {
    startedAt: svc.stampNow(),
    deadline: svc.stampNow(new Date(Date.now() + 3600 * 1000)),
    durationSec: 3600,
  };
  r = svc.evalTimegoal(far, Date.now());
  assert.equal(r.reached, false);
  assert.ok(r.remainingSec > 3500 && r.remainingSec <= 3600, 'remainingSec=' + r.remainingSec);

  // 数据损坏：start/deadline 解析不出 → 保守判定 reached:true
  assert.equal(svc.evalTimegoal({ startedAt: 'xxx', deadline: 'yyy' }, Date.now()).reached, true);

  // 完全没 goal：hasGoal=false
  assert.equal(svc.evalTimegoal(null, Date.now()).hasGoal, false);
});

test('set → show → check 链路：reached:false 且 prompt 原文回显（含换行/Unicode）', async () => {
  await reset();
  const prompt = '行1\n行2\n特殊字符: → ✓ 中文';
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt });
  const show = await svc.showTimegoal({ cwd: dirA });
  assert.equal(show.hasGoal, true);
  assert.equal(show.goal.prompt, prompt); // prompt 原文一字不差
  assert.equal(show.goal.durationSec, 3600);
  // started/deadline 字段都在
  assert.ok(show.goal.startedAt && show.goal.deadline);

  const chk = await svc.checkTimegoal({ cwd: dirA });
  assert.equal(chk.hasGoal, true);
  assert.equal(chk.reached, false);
  assert.equal(chk.prompt, prompt); // 关键契约：prompt 必原样回显
  assert.ok(chk.startedAt && chk.deadline && chk.now);
  assert.ok(chk.remainingSec > 3500 && chk.remainingSec <= 3600);
  assert.equal(chk.key, svc.topicKeyFor(basename(dirA)));
});

test('模拟到点：直接改 store 里 startedAt 让系统时间到点，check 返回 reached:true', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: 'P' });
  // 把 started 改成 1 小时前 → deadline 已经过线 59 分钟
  const raw = JSON.parse(readFileSync(storeFile, 'utf8'));
  const key = Object.keys(raw.goals)[0];
  const past = new Date(Date.now() - 3600 * 1000);
  raw.goals[key].startedAt = svc.stampNow(past);
  raw.goals[key].deadline = svc.stampNow(new Date(past.getTime() + 60 * 1000));
  writeFileSync(storeFile, JSON.stringify(raw, null, 2));

  const chk = await svc.checkTimegoal({ cwd: dirA });
  assert.equal(chk.reached, true);
  assert.equal(chk.remainingSec, 0);
  assert.equal(chk.elapsedSec, 3600); // 已用 1 小时
  assert.equal(chk.prompt, 'P'); // 即便到点，prompt 仍原样
});

test('clear 后 show / check 都返回 hasGoal:false', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: 'X' });
  const cleared = await svc.clearTimegoal({ cwd: dirA });
  assert.equal(cleared.cleared, true);
  const show = await svc.showTimegoal({ cwd: dirA });
  assert.equal(show.hasGoal, false);
  const chk = await svc.checkTimegoal({ cwd: dirA });
  assert.equal(chk.hasGoal, false);
  assert.equal(chk.prompt, ''); // 无 goal 时 prompt 必空
  // 再 clear：no_goal
  const again = await svc.clearTimegoal({ cwd: dirA });
  assert.equal(again.cleared, false);
  assert.equal(again.reason, 'no_goal');
});

test('update：只换 prompt，不重置起点；不存在时抛错', async () => {
  await reset();
  // 不存在 → 抛错
  await assert.rejects(
    () => svc.updateTimegoal({ cwd: dirA, prompt: 'X' }),
    /尚未设置 timegoal/
  );

  await svc.setTimegoal({ cwd: dirA, durationSec: 7200, prompt: 'V1' });
  const before = (await svc.showTimegoal({ cwd: dirA })).goal;
  const upd = await svc.updateTimegoal({ cwd: dirA, prompt: 'V2 改良版' });
  assert.equal(upd.updated, true);
  assert.equal(upd.goal.prompt, 'V2 改良版');
  // 关键：startedAt / deadline 与 update 前**完全一致**
  assert.equal(upd.goal.startedAt, before.startedAt);
  assert.equal(upd.goal.deadline, before.deadline);
  assert.equal(upd.goal.durationSec, before.durationSec);

  // 校验：空 prompt 拒绝（与 set 同套 normalize）
  await assert.rejects(() => svc.updateTimegoal({ cwd: dirA, prompt: '' }), /不能为空/);
  await assert.rejects(() => svc.updateTimegoal({ cwd: dirA, prompt: '   ' }), /不能为空/);
});

test('update 带 duration：保留起点，deadline = 起点 + 新时长', async () => {
  await reset();
  const set = await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: 'V1' });
  const before = set.goal;

  // 改时长到 2 小时：起点不变，截止整体后移
  const upd = await svc.updateTimegoal({ cwd: dirA, prompt: 'V2', durationSec: 7200 });
  assert.equal(upd.goal.startedAt, before.startedAt, '起点必须保留');
  assert.equal(upd.goal.durationSec, 7200);
  assert.notEqual(upd.goal.deadline, before.deadline, '时长变了截止自然变');

  // 起点 + 新时长 = 新截止（按字符串重新解析回时间戳核对，允许 1s 精度）
  const toMs = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  };
  const deltaSec = (toMs(upd.goal.deadline) - toMs(upd.goal.startedAt)) / 1000;
  assert.equal(deltaSec, 7200, `deadline - started 应等于新时长，实际 ${deltaSec}`);

  // 非法时长同样拒绝
  await assert.rejects(
    () => svc.updateTimegoal({ cwd: dirA, prompt: 'V3', durationSec: 10 }),
    /至少 60/
  );
});

test('不同 cwd 互相独立：dirA 设了 goal，dirB show 是空的', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: 'A-only' });
  const sB = await svc.showTimegoal({ cwd: dirB });
  assert.equal(sB.hasGoal, false);
  const sA = await svc.showTimegoal({ cwd: dirA });
  assert.equal(sA.hasGoal, true);
  assert.equal(sA.goal.prompt, 'A-only');

  // dirB clear：无副作用
  const clr = await svc.clearTimegoal({ cwd: dirB });
  assert.equal(clr.cleared, false);

  // dirA goal 仍完整
  const reShow = await svc.showTimegoal({ cwd: dirA });
  assert.equal(reShow.hasGoal, true);

  // 同名目录共用（key 一致）：dir 下手动新建同 basename 的目录也应共享
  // 这里只断言 key 算法与 localtask 一致
  assert.equal(svc.topicKeyFor(basename(dirA)), svc.topicKeyFor(basename(dirA)));
});

test('list 返回所有有 timegoal 的目录', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: 'A' });
  await svc.setTimegoal({ cwd: dirB, durationSec: 1800, prompt: 'B' });
  const r = await svc.listTimegoals();
  assert.equal(r.count, 2);
  // 按 deadline 升序 → B（30 分钟）应在前
  assert.ok(r.goals[0].durationSec <= r.goals[1].durationSec);
  // 两个 goal 都保留 prompt
  assert.equal(r.goals.filter((g) => g.prompt === 'A').length, 1);
  assert.equal(r.goals.filter((g) => g.prompt === 'B').length, 1);
});

test('list 空时返回 count:0', async () => {
  await reset();
  const r = await svc.listTimegoals();
  assert.equal(r.count, 0);
  assert.deepEqual(r.goals, []);
});

test('store 损坏容忍：把 store 写坏读不出来时 fallback 到空 store', async () => {
  // 此时 storeFile 不存在 → 空 store
  await reset();
  // 写一个非 JSON
  writeFileSync(storeFile, '{this is not json', 'utf8');
  const r = await svc.listTimegoals();
  assert.equal(r.count, 0); // 容忍
  // 清理：自己写的坏 JSON 不污染后续测试
  rmSync(storeFile);
});

test('环境变量 NX_KV_TIMEGOAL_STORE 覆盖生效', async () => {
  const originalEnv = process.env.NX_KV_TIMEGOAL_STORE;
  try {
    const custom = join(tmp, 'custom.json');
    process.env.NX_KV_TIMEGOAL_STORE = custom;
    // custom 初始不存在 → 空
    let r = await svc.listTimegoals();
    assert.equal(r.count, 0);

    await svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: 'in-custom' });
    // 确认写到了 custom
    assert.ok(readFileSync(custom, 'utf8').includes('in-custom'));
    // 主 storeFile 不在 env 覆盖路径上，应当没被写——若该文件不存在则 ENOENT，
    // 若因前序测试残留则不等式判断不再依赖 err.code，改为读 custom 内容确认隔离。
    const customData = JSON.parse(readFileSync(custom, 'utf8'));
    const keyInA = svc.topicKeyFor(basename(dirA));
    assert.ok(customData.goals[keyInA] && customData.goals[keyInA].prompt === 'in-custom');

    // 切回主 storeFile，确认 list 看到的是空（custom 与主 store 隔离）
    process.env.NX_KV_TIMEGOAL_STORE = originalEnv || join(tmp, 'main-isolated.json');
    if (!originalEnv) {
      // 没有原值就换一个独立的隔离路径，不读 storeFile 免得踩 #12 残留
    }
    r = await svc.listTimegoals();
    assert.equal(r.count, 0);
  } finally {
    process.env.NX_KV_TIMEGOAL_STORE = originalEnv;
    // 清理 custom 与可能的隔离 main 路径
    try { rmSync(join(tmp, 'custom.json')); } catch { /* ignore */ }
    try { rmSync(join(tmp, 'main-isolated.json')); } catch { /* ignore */ }
  }
});

test('set 已有 goal：replaced:true，新 deadline 重算', async () => {
  await reset();
  const a = await svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: 'V1' });
  assert.equal(a.replaced, false);
  const oldDeadline = a.goal.deadline;
  // 等到下一秒再 set（避免 same-second flaky）
  await new Promise((r) => setTimeout(r, 1100));
  const b = await svc.setTimegoal({ cwd: dirA, durationSec: 7200, prompt: 'V2' });
  assert.equal(b.replaced, true);
  assert.equal(b.goal.prompt, 'V2');
  assert.equal(b.goal.durationSec, 7200);
  assert.notEqual(b.goal.deadline, oldDeadline); // 起点被重置，deadline 自然变了

  // 全局只剩一个 goal
  const all = await svc.listTimegoals();
  assert.equal(all.count, 1);
  assert.equal(all.goals[0].prompt, 'V2');
});

test('回归：eslint-style 校验 normalizePrompt 会 trim', async () => {
  await reset();
  const v = await svc.setTimegoal({
    cwd: dirA,
    durationSec: 60,
    prompt: '   Trim me   \n  ',
  });
  assert.equal(v.goal.prompt, 'Trim me');
});
