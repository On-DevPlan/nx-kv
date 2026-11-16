// 渲染链消费顺序数组（S4 验收：拖动后 CLI 渲染顺序同步变化，方案 §5.1/§10）。
//
// waitForTask（tasktool/wait.ts）读 settings['prompt.pluginOrder'] 传给 compose 的
// orderIds——顺序数组是唯一真相，运行期 order 位 = 数组下标 × 10（不读插件 order）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-order-'));
const storeFile = join(tmp, 'localtasks.json');
process.env.NX_KV_LOCALTASK_STORE = storeFile;
process.env.NX_KV_CONFIG = join(tmp, 'config.json');

process.on('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch { /* ignore */
  }
});

const { waitForTask } = await import('../../src/modules/tasktool/wait.js');
import * as svc from '../../src/modules/localtask/service.js';
const { writeSettingRaw } = await import('../../src/core/db/settings.js');
const { getDb } = await import('../../src/core/db/index.js');
const { PROMPT_ORDER_KEY } = await import('../../src/modules/promptplug/keys.js');

const dir = join(tmp, 'projO');
mkdirSync(dir, { recursive: true });

test('顺序数组进渲染链：ack 提前到 context 之前，instruction 的区块顺序跟随数组', async () => {
  svc.resetLocaltaskStore();
  await svc.addTask({ cwd: dir, text: '顺序任务' });

  // ack 两个变量都命中的最小说置：让 context 与 ack 都输出
  await svc.updateSettings({ deliveryTemplate: 'CTX-MARK' });
  await svc.updateSettings({ ackPrompt: 'ACK-MARK {{task.id}}' });

  // 等价于设置页拖动后的 PUT /api/prompt/order：ack 提到最前
  writeSettingRaw(getDb(), PROMPT_ORDER_KEY, [
    'ack', 'context', 'getloop', 'attachment', 'timecheck', 'goalhint', 'doneguard', 'ext',
  ]);

  const r = await waitForTask({ cwd: dir, summary: 's', timeoutSec: 5, open: false });
  assert.equal(r.status, 'ok');
  const inst = String(r.instruction || '');
  const ackAt = inst.indexOf('<nx-kv.ack>');
  const ctxAt = inst.indexOf('<nx-kv.context>');
  assert.ok(ackAt >= 0 && ctxAt >= 0, `两段都输出：${JSON.stringify(inst).slice(0, 200)}`);
  assert.ok(ackAt < ctxAt, '拖动后的顺序（ack 前）进渲染链');

  // 恢复默认顺序 → context 回到 ack 之前（先补一条任务：上一条已被消费）
  writeSettingRaw(getDb(), PROMPT_ORDER_KEY, [
    'context', 'attachment', 'timecheck', 'goalhint', 'doneguard', 'ext', 'ack', 'getloop',
  ]);
  await svc.addTask({ cwd: dir, text: '顺序任务二' });
  const r2 = await waitForTask({ cwd: dir, summary: 's', timeoutSec: 5, open: false });
  assert.equal(r2.status, 'ok');
  const inst2 = String(r2.instruction || '');
  assert.ok(inst2.indexOf('<nx-kv.context>') < inst2.indexOf('<nx-kv.ack>'), '默认顺序恢复');
});
