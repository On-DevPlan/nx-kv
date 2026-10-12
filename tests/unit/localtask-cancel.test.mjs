// 「关闭等待」测试：面板上「等待中」勋章旁的「关闭」按钮做什么。
//
// 语义（重要）：关闭**只关等待**——让阻塞中的 wait 立即收尾，走与超时同一条出口
// （status:"timeout" + cancelled:true），agent 照常结束本轮；**不删主题、不删任务**。
// 覆盖三件事：
//   1. 非等待中的主题点关闭 = 无操作（不报错、不动数据）；
//   2. 阻塞中的 wait 被关闭时会**立即**返回（远快于 timeoutMs），且等待态复位、任务保留；
//   3. 关闭标记只生效一次：不会误杀下一轮 wait（setWaiting 会清掉残留标记）。
//
// 存储一律指向临时文件（NX_KV_LOCALTASK_STORE），绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-cancel-'));
const storeFile = join(tmp, 'localtasks.json');
const dir = join(tmp, 'projC');
mkdirSync(dir, { recursive: true });
process.env.NX_KV_LOCALTASK_STORE = storeFile;
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

async function reset() {
  rmSync(storeFile, { force: true });
}

test('cancelWait：主题不在等待中时是无操作（cancelled:false，不报错、不动数据）', async () => {
  await reset();
  await svc.addTask({ cwd: dir, text: '排队中的任务' });

  const r = await svc.cancelWait({ cwd: dir });
  assert.equal(r.cancelled, false);
  assert.equal(r.reason, 'not_waiting');

  const d = await svc.listTasks();
  assert.equal(d.topics.length, 1);
  assert.equal(d.topics[0].total, 1, '任务必须原样保留');
  assert.equal(d.topics[0].waiting, false);
});

test('cancelWait：阻塞中的 wait 立即收尾（timeout + cancelled），等待态复位、任务保留', async () => {
  await reset();
  await svc.addTask({ cwd: dir, text: '历史任务' });
  await svc.consumeFirstPending(key); // 领走，让队列空出来 → wait 才会真阻塞

  let during = null;
  const t0 = Date.now();
  const p = svc.waitForTask({
    cwd: dir,
    summary: '等用户关闭',
    timeoutMs: 60_000, // 远大于实际耗时：能证明是「被关闭」而不是「等到超时」
    open: false,
    onReady: async () => {
      during = (await svc.listTasks()).topics[0];
      const ok = await svc.cancelWait({ cwd: dir });
      assert.equal(ok.cancelled, true, '等待中的主题应能关闭');
      assert.equal(ok.name, 'projC');
    },
  });

  const r = await p;
  const cost = Date.now() - t0;

  // 等待中：模型带上起点，面板据此显示「已等多久」
  assert.equal(during.waiting, true);
  assert.ok(during.waitingSince, '等待中必须记录 waitingSince（起点）');
  assert.match(during.waitingSince, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  // 结果：与超时同一条出口，另加 cancelled 标记（agent 侧不必认识新状态）
  assert.equal(r.status, 'timeout');
  assert.equal(r.cancelled, true);
  assert.ok(cost < 5000, `关闭应远快于 60s 超时，实际 ${cost}ms`);

  // 关闭只关等待：主题、现状、任务都在
  const d = await svc.listTasks();
  assert.equal(d.waiting, 0, '等待态应已复位');
  assert.equal(d.topics[0].waiting, false);
  assert.equal(d.topics[0].cancelRequested, false);
  assert.equal(d.topics[0].total, 1, '任务必须原样保留');
  assert.equal(d.topics[0].tasks[0].text, '历史任务');
});

test('关闭标记只生效一次：正常超时不带 cancelled，且不会瞬间收尾', async () => {
  await reset();
  const t0 = Date.now();
  // 注意用 timeoutSec:1（秒级）；timeoutMs 会先 ÷1000 再 floor，传 800 会变成 0 秒立即超时
  const r = await svc.waitForTask({ cwd: dir, summary: '没人点关闭', timeoutSec: 1, open: false });
  assert.equal(r.status, 'timeout');
  assert.notEqual(r.cancelled, true, '正常超时不应带 cancelled');
  assert.ok(Date.now() - t0 >= 900, '应当是等满 1s 超时，而不是被误收尾');
});

test('setWaiting 清掉残留关闭标记：新一轮 wait 不会被上一轮的关闭请求误杀', async () => {
  await reset();
  await svc.addTask({ cwd: dir, text: '占位' });
  await svc.consumeFirstPending(key); // 队列必须空，否则 wait 会立刻取走任务而不是阻塞
  // 模拟「用户点关闭」与「上一轮 wait 收尾」撞在一起：标记落在 store 里但已无 wait 在跑
  const raw = JSON.parse(readFileSync(storeFile, 'utf8'));
  raw.topics[key].cancelRequested = true;
  raw.topics[key].waiting = false;
  writeFileSync(storeFile, JSON.stringify(raw, null, 2), 'utf8');

  const t0 = Date.now();
  const r = await svc.waitForTask({ cwd: dir, summary: '新一轮等待', timeoutSec: 1, open: false });
  assert.equal(r.status, 'timeout');
  assert.notEqual(r.cancelled, true, '残留标记不该杀掉新一轮等待');
  assert.ok(Date.now() - t0 >= 900, '应当正常等到超时');
});

test('cancelWait：缺少 cwd/key 直接报错（与其他主题级命令一致）', async () => {
  await assert.rejects(() => svc.cancelWait({}), /--cwd/);
});
