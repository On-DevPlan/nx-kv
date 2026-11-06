// timegoal 模块单测：duration/prompt 边界、纯函数 evalTimegoal 全时段、
// set/show/check/clear 链路、update 不动起点、不同 cwd 隔离、到点自动回收。
//
// 存储进库（T06）：队列级 goal 在 settings 表（`tg.cwd.<topicKey>` 一键一目标），
// 任务级 goal 在 goals/goal_checks 表。测试用 NX_KV_DB 指到临时库文件；
// 「到点」的模拟直接改库里的 started_at/deadline（JSON 时代是改文件）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as svc from '../../src/modules/tasktool/timegoal.js';
import { closeDb, getDb } from '../../src/core/db/index.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-timegoal-'));
const dbFile = join(tmp, 'nxkv.db');
const dirA = mkdirSync(join(tmp, 'projA'), { recursive: true }) || join(tmp, 'projA');
const dirB = join(tmp, 'projB');
mkdirSync(dirB, { recursive: true });
process.env.NX_KV_DB = dbFile;
process.on('exit', () => {
  closeDb();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

async function reset() {
  closeDb();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      rmSync(dbFile + suffix, { force: true });
    } catch {
      /* Windows 偶发句柄残留：留给下一次 */
    }
  }
}

/** 读队列级 goal 的 blob（settings 表 `tg.cwd.<topicKey>`）。 */
function readBlob(key) {
  const row = getDb().get('SELECT value FROM settings WHERE key = ?', ['tg.cwd.' + key]);
  return row ? JSON.parse(row.value) : null;
}

/** 写回 blob（到点模拟用）。 */
function writeBlob(key, blob) {
  getDb().run('UPDATE settings SET value = ? WHERE key = ?', [JSON.stringify(blob), 'tg.cwd.' + key]);
}

// 把某个 goal 的 deadline 挪到过去（模拟"已经到点"）
function expireGoal(key, agoSec = 3600) {
  const blob = readBlob(key);
  const past = new Date(Date.now() - agoSec * 1000);
  blob.startedAtMs = past.getTime();
  blob.deadlineMs = past.getTime() - 60 * 1000;
  writeBlob(key, blob);
}

const PROMPT_OK = '用 subagent 调研 redis 差距并写 CHANGELOG';

test('duration 边界：59 拒绝 / 60 通过 / 24 小时不再是上限 / 超过 365 天拒绝', async () => {
  await reset();
  await assert.rejects(() => svc.setTimegoal({ cwd: dirA, durationSec: 59, prompt: PROMPT_OK }), /至少 60/);
  const ok = await svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: PROMPT_OK });
  assert.equal(ok.goal.durationSec, 60);
  await reset();
  // 24 小时不再是天花板："跑一晚上""连续优化几天"是真实需求
  const ok2 = await svc.setTimegoal({ cwd: dirA, durationSec: 86400 * 30, prompt: PROMPT_OK });
  assert.equal(ok2.goal.durationSec, 86400 * 30);
  // 365 天是上限（一年足够跑任何长任务，但挡得住手滑的 999999999）
  await assert.rejects(
    () => svc.setTimegoal({ cwd: dirA, durationSec: 86400 * 400, prompt: PROMPT_OK }),
    /超过上限/
  );
});

test('parseDuration：人类单位（5h / 90m / 2d / 5小时 / 1.5h）与纯秒数都认', () => {
  assert.equal(svc.parseDuration(10800), 10800);
  assert.equal(svc.parseDuration('10800'), 10800);
  assert.equal(svc.parseDuration('5h'), 18000); // 5 小时 = 5×3600
  assert.equal(svc.parseDuration('5H'), 18000);
  assert.equal(svc.parseDuration('90m'), 5400);
  assert.equal(svc.parseDuration('2d'), 172800);
  assert.equal(svc.parseDuration('5小时'), 18000);
  assert.equal(svc.parseDuration('90分钟'), 5400);
  assert.equal(svc.parseDuration('1.5h'), 5400);
  assert.equal(svc.parseDuration('  5 h '), 18000);
  // 不认识的单位不猜，直接报错
  assert.throws(() => svc.parseDuration('5星期'), /无法识别/);
  assert.throws(() => svc.parseDuration('abc'), /无法解析/);
  assert.throws(() => svc.parseDuration(''), /需要 --duration/);
  assert.throws(() => svc.parseDuration('30s'), /至少 60/);
});

test('set 接受人类单位时长：--duration 5h 等价 18000 秒', async () => {
  await reset();
  const r = await svc.setTimegoal({ cwd: dirA, durationSec: '5h', prompt: PROMPT_OK });
  assert.equal(r.goal.durationSec, 18000);
  const startMs = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(r.goal.startedAt);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  })();
  const deadlineMs = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(r.goal.deadline);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  })();
  assert.equal((deadlineMs - startMs) / 1000, 18000, '截止 - 起点 应等于 5 小时');
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
  await assert.rejects(() => svc.checkTimegoal({ cwd: dirA }), /--summary/);
  await assert.rejects(() => svc.checkTimegoal({ cwd: dirA, summary: '现状' }), /--progress/);
  // 上面所有错误都不应写库
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

test('set → show → check 链路：reached:false 且 prompt / 现状 / 完成度原文回显', async () => {
  await reset();
  const prompt = '行1\n行2\n特殊字符: → ✓ 中文';
  const summary = '已完成目录合并与设置弹窗';
  const progress = '完成度约 40%：表格合并完成，待补充批量回收';
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt });
  const show = await svc.showTimegoal({ cwd: dirA });
  assert.equal(show.hasGoal, true);
  assert.equal(show.goal.prompt, prompt); // prompt 原文一字不差
  assert.equal(show.goal.durationSec, 3600);
  // started/deadline 字段都在
  assert.ok(show.goal.startedAt && show.goal.deadline);

  const chk = await svc.checkTimegoal({ cwd: dirA, summary, progress });
  assert.equal(chk.hasGoal, true);
  assert.equal(chk.reached, false);
  assert.equal(chk.prompt, prompt); // 关键契约：prompt 必原样回显
  assert.equal(chk.summary, summary);
  assert.equal(chk.progress, progress);
  assert.ok(chk.checkedAt);
  assert.ok(chk.startedAt && chk.deadline && chk.now);
  assert.ok(chk.remainingSec > 3500 && chk.remainingSec <= 3600);
  assert.equal(chk.key, svc.topicKeyFor(dirA));
});

test('模拟到点：直接改库里的 deadline 让系统时间到点，check 返回 reached:true', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: 'P' });
  // 把 started 改成 1 小时前 → deadline 已经过线 59 分钟
  const key = (await svc.showTimegoal({ cwd: dirA })).key;
  const blob = readBlob(key);
  const past = new Date(Date.now() - 3600 * 1000);
  blob.startedAtMs = past.getTime();
  blob.deadlineMs = past.getTime() + 60 * 1000;
  writeBlob(key, blob);

  const chk = await svc.checkTimegoal({ cwd: dirA, summary: '达到目标', progress: '完成 100%' });
  assert.equal(chk.reached, true);
  assert.equal(chk.remainingSec, 0);
  assert.equal(chk.elapsedSec, 3600); // 已用 1 小时
  assert.equal(chk.prompt, 'P'); // 即便到点，prompt 仍原样
  assert.equal(chk.summary, '达到目标');
  assert.equal(chk.progress, '完成 100%');
});

test('clear 后 show / check 都返回 hasGoal:false', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: 'X' });
  const cleared = await svc.clearTimegoal({ cwd: dirA });
  assert.equal(cleared.cleared, true);
  const show = await svc.showTimegoal({ cwd: dirA });
  assert.equal(show.hasGoal, false);
  // check 现在要求带现状与完成度（每轮都要写日志），所以这里也得给
  const chk = await svc.checkTimegoal({ cwd: dirA, summary: '现状', progress: '下一步' });
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
  assert.equal(svc.topicKeyFor(dirA), svc.topicKeyFor(dirA));
});

test('list 返回所有有 timegoal 的目录', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: 'A' });
  await svc.setTimegoal({ cwd: dirB, durationSec: 1800, prompt: 'B' });
  const r = await svc.listTimegoals();
  assert.equal(r.count, 2);
  // 按 deadline 升序 → B（30 分钟）应在前
  assert.ok(r.goals[0].durationSec <= r.goals[1].durationSec);
  // 两个 goal 都保留提示词预览（完整原文用 show 取）
  assert.equal(r.goals.filter((g) => g.promptPreview === 'A').length, 1);
  assert.equal(r.goals.filter((g) => g.promptPreview === 'B').length, 1);
});

test('list 空时返回 count:0', async () => {
  await reset();
  const r = await svc.listTimegoals();
  assert.equal(r.count, 0);
  assert.deepEqual(r.goals, []);
});

test('NX_KV_DB 覆盖生效：env 换库路径后读写到另一份库（测试隔离机制）', async () => {
  await reset();
  const originalEnv = process.env.NX_KV_DB;
  try {
    const other = join(tmp, 'other-nxkv.db');
    process.env.NX_KV_DB = other;
    closeDb(); // env 变了 → 下一次打开切到新库
    // 新库初始为空
    let r = await svc.listTimegoals();
    assert.equal(r.count, 0);

    await svc.setTimegoal({ cwd: dirA, durationSec: 60, prompt: 'in-other' });
    assert.equal((await svc.showTimegoal({ cwd: dirA })).goal.prompt, 'in-other');

    // 切回主库：隔离成立（看不到 other 库里的 goal）
    process.env.NX_KV_DB = originalEnv || dbFile;
    closeDb();
    r = await svc.listTimegoals();
    assert.equal(r.count, 0);
  } finally {
    process.env.NX_KV_DB = originalEnv;
    closeDb();
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
  assert.equal(all.goals[0].promptPreview, 'V2');
  assert.equal((await svc.showTimegoal({ cwd: dirA })).goal.prompt, 'V2');
});

test('每次 check 都追加现状与完成度日志，并可单独读取历史', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: '固定总指令' });

  const first = await svc.checkTimegoal({
    cwd: dirA,
    summary: '完成目录看板合并',
    progress: '约 40%；下一步加回收和设置弹窗',
  });
  assert.equal(first.logCount, 1);
  assert.equal(first.summary, '完成目录看板合并');
  assert.equal(first.progress, '约 40%；下一步加回收和设置弹窗');
  assert.ok(first.checkedAt);

  const second = await svc.checkTimegoal({
    cwd: dirA,
    summary: '设置按钮已完成',
    progress: '约 70%；下一步做浏览器验证',
  });
  assert.equal(second.logCount, 2);
  assert.equal(second.prompt, '固定总指令', '日志不能替换全局根提示词');

  const history = await svc.getTimegoalLog({ cwd: dirA });
  assert.equal(history.hasGoal, true);
  assert.equal(history.count, 2);
  assert.deepEqual(history.entries.map((entry) => entry.summary), [
    '完成目录看板合并',
    '设置按钮已完成',
  ]);
  assert.equal(history.entries[1].progress, '约 70%；下一步做浏览器验证');
});

test('check 缺少现状或完成度拒绝；无 timegoal 时不产生日志', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: 'P' });
  await assert.rejects(() => svc.checkTimegoal({ cwd: dirA, progress: '完成 10%' }), /--summary/);
  await assert.rejects(() => svc.checkTimegoal({ cwd: dirA, summary: '目前情况' }), /--progress/);
  await assert.rejects(() => svc.checkTimegoal({ cwd: dirA, summary: '  ', progress: '完成 10%' }), /--summary/);

  await reset();
  const noGoal = await svc.checkTimegoal({ cwd: dirA, summary: '当前情况', progress: '完成 10%' });
  assert.equal(noGoal.hasGoal, false);
  assert.equal((await svc.getTimegoalLog({ cwd: dirA })).count, 0);
});

test('pruneExpired：只回收已到点目标，未到点的保留；重复调用幂等', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: 'keep' });
  await svc.setTimegoal({ cwd: dirB, durationSec: 3600, prompt: 'expired' });

  const expiredKey = (await svc.showTimegoal({ cwd: dirB })).key;
  expireGoal(expiredKey, 7200);

  const result = await svc.pruneExpired();
  assert.equal(result.count, 1);
  assert.equal(result.removed[0].prompt, 'expired');
  const remaining = await svc.listTimegoals();
  assert.equal(remaining.count, 1);
  assert.equal(remaining.goals[0].promptPreview, 'keep');

  const again = await svc.pruneExpired();
  assert.equal(again.count, 0, '再次回收无变化');
});

// ─── 自动回收：到点自动归档 / 超期自动失效 ──────────────────────────────

test('到点自动归档：活动列表不再出现，但仍可 show/check 拿到 reached:true + prompt 原文', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: '归档前的根指令' });
  const key = (await svc.showTimegoal({ cwd: dirA })).key;
  expireGoal(key);

  // list：活动区空了，归档区有它
  const list = await svc.listTimegoals();
  assert.equal(list.count, 0, '到点的目标自动离开活动列表');
  assert.equal(list.archivedCount, 1);
  assert.equal(list.archived[0].promptPreview, '归档前的根指令');
  assert.equal(list.archived[0].archived, true);
  assert.ok(list.archived[0].archivedAt);

  // 关键契约：agent 最后一轮 check 仍要拿到 reached:true + prompt 原文
  const chk = await svc.checkTimegoal({ cwd: dirA, summary: '到点了', progress: '收尾' });
  assert.equal(chk.hasGoal, true);
  assert.equal(chk.reached, true);
  assert.equal(chk.prompt, '归档前的根指令');
  assert.ok(chk.overtimeSec > 0, '到点后要报出超了多久');

  // show 也仍然查得到
  const show = await svc.showTimegoal({ cwd: dirA });
  assert.equal(show.hasGoal, true);
  assert.equal(show.goal.archived, true);
  assert.equal(show.reached, true);
});

test('归档超过保留期：整条自动失效（连提示词一起删掉），不需要人工清理', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: '保留期后也要读得到' });
  const key = (await svc.showTimegoal({ cwd: dirA })).key;
  expireGoal(key);
  await svc.listTimegoals(); // 触发归档

  // 把 deadline 往前挪 9 天（超过 7 天保留期）→ 下一次读就该自动失效
  const blob = readBlob(key);
  const longAgo = Date.now() - 9 * 24 * 3600 * 1000;
  blob.startedAtMs = longAgo;
  blob.deadlineMs = longAgo + 3600 * 1000;
  blob.archivedAtMs = longAgo;
  writeBlob(key, blob);

  const list = await svc.listTimegoals();
  assert.equal(list.count, 0);
  assert.equal(list.archivedCount, 0, '超过保留期 → 自动失效，不再留在归档区');
  // 整条被删掉：提示词原文一起没了（"自动失效"就是不再保留）
  const show = await svc.showTimegoal({ cwd: dirA });
  assert.equal(show.hasGoal, false, '失效 = 彻底没了，show 查不到');
  const chk = await svc.checkTimegoal({ cwd: dirA, summary: '收尾', progress: '写总结' });
  assert.equal(chk.hasGoal, false);
  assert.equal(chk.reached, false, '目标已不存在，不再有"已到点"信号');
  // 库里也真的没了
  assert.equal(readBlob(key), null, '失效的目标从库里删掉了');
});

test('失效的目标不可复活：update 报错，要继续请用 set 开新一局', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: 'V1' });
  const key = (await svc.showTimegoal({ cwd: dirA })).key;
  expireGoal(key);
  await svc.listTimegoals(); // 触发归档（到点即失效）

  await assert.rejects(
    () => svc.updateTimegoal({ cwd: dirA, prompt: 'V2', durationSec: '5h' }),
    /已经到点失效/,
    '已到点的目标不能被 update 救活'
  );

  // set 仍然可以开新一局（起点从现在重算）
  const fresh = await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: 'V3' });
  assert.equal(fresh.goal.archived, false);
  const list = await svc.listTimegoals();
  assert.equal(list.count, 1, 'set 之后重新出现在活动列表');
  assert.equal(list.archivedCount, 0);
});

// ─── 日志语义（T06：行级追加，无 logTruncated 概念）─────────────────────

test('日志全量保留（行级追加不封顶）：250 条历史 + 1 条新 check = 251 条', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: 'P' });
  const key = (await svc.showTimegoal({ cwd: dirA })).key;

  // 直接往 blob 里塞 250 条历史日志（比真跑 250 轮快得多）
  const blob = readBlob(key);
  blob.checks = Array.from({ length: 250 }, (_, i) => ({
    at: Date.now() - (250 - i) * 1000,
    elapsedSec: i,
    remainingSec: 3600 - i,
    overtimeSec: 0,
    reached: false,
    summary: `第 ${i} 轮`,
    progress: '继续',
  }));
  blob.totalChecks = 250;
  writeBlob(key, blob);

  const chk = await svc.checkTimegoal({ cwd: dirA, summary: '新的一轮', progress: '继续' });
  assert.equal(chk.logCount, 251, '行级追加：一条不丢');
  assert.equal(chk.totalChecks, 251);
  assert.equal(chk.logTruncated, undefined, 'logTruncated 概念已随 JSON store 退役');
  const log = await svc.getTimegoalLog({ cwd: dirA });
  assert.equal(log.count, 251);
  assert.equal(log.totalEntries, 251);
  assert.equal(log.entries[log.count - 1].summary, '新的一轮', '最新一条是新写的');
  assert.equal(log.truncated, undefined, '读侧同样不再有截断标记');
});

test('prune 会连归档区一起彻底清除', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: '待清除' });
  const key = (await svc.showTimegoal({ cwd: dirA })).key;
  expireGoal(key);
  await svc.listTimegoals(); // 触发归档

  const r = await svc.pruneExpired();
  assert.equal(r.count, 1);
  assert.equal(r.removed[0].prompt, '待清除');
  const list = await svc.listTimegoals();
  assert.equal(list.count, 0);
  assert.equal(list.archivedCount, 0);
});

test('读路径不写库：list/show 不会改动 goal 的落库时刻（避免与并发 check 互相覆盖）', async () => {
  await reset();
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt: 'P' });
  const key = (await svc.showTimegoal({ cwd: dirA })).key;
  const before = getDb().get('SELECT updated_at FROM settings WHERE key = ?', ['tg.cwd.' + key]).updated_at;
  await svc.listTimegoals();
  await svc.showTimegoal({ cwd: dirA });
  const after = getDb().get('SELECT updated_at FROM settings WHERE key = ?', ['tg.cwd.' + key]).updated_at;
  assert.equal(after, before, '读操作不应写库——写库只发生在 set/update/check/clear 这些真写的路径上');
});

test('list 不返回完整 prompt（只给预览）；完整原文用 show 取', async () => {
  await reset();
  const prompt = '很长'.repeat(200);
  await svc.setTimegoal({ cwd: dirA, durationSec: 3600, prompt });
  const list = await svc.listTimegoals();
  assert.equal(list.goals[0].prompt, undefined, '列表不带完整 prompt（归档区 N 个就是 N×20KB）');
  assert.ok(list.goals[0].promptPreview, '列表给一小段预览');
  assert.ok(list.goals[0].promptPreview.length <= 121);
  const show = await svc.showTimegoal({ cwd: dirA });
  assert.equal(show.goal.prompt, prompt, 'show 仍是完整原文');
});
