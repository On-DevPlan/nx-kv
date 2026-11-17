// ack 完成总结段测试（#152 后：正文来自 ack 插件类的内置模板，**不可配置**）。
//
// 历史（任务 #32 / S3）里 ack 是「设置里可增删的多条模板」，随 #152 的「模板唯一真相
// = 插件类」一起下线：现在 ack 段就是 plugins/ack.ts 的 BUILTIN，
// localtask.config 也不再接受 --ack / --ack-list。
//
// 仍要钉住的两件事：
//   1. 交付的 instruction 里必须带 ack 段（任务 {{task.id}} 已渲染）；
//   2. 它只进 instruction，**绝不回写 task.text**（库存原文是用户的字）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';
import { getTask } from '../../src/modules/tasktool/get.js';
import { templatesOf } from '../../src/modules/promptplug/index.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-ackp-'));
const storeFile = join(tmp, 'localtasks.json');
const dir = join(tmp, 'projA');
mkdirSync(dir, { recursive: true });
process.env.NX_KV_LOCALTASK_STORE = storeFile;
process.env.NX_KV_CONFIG = join(tmp, 'config.json');

process.on('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结果 */
  }
});

test('设置视图：ackPromptList 是插件类正文的只读回显（弃用但不断代）', async () => {
  const s = await svc.getSettings();
  assert.equal(s.ackPromptList.length, 1, '恰好一条（内置正文按空行拆出的那条）');
  assert.ok(s.ackPromptList[0].includes('localtask done'), '内置 ack 要求调用 localtask done');
  assert.equal(
    s.ackPromptList[0],
    templatesOf('ack')[0].text,
    '回显与插件类正文逐字同源',
  );
});

test('设置：ack 不再可写——updateSettings 只管超时与追加模式', async () => {
  const before = await svc.getSettings();
  // 只传模板字段 = 没有任何可写项 → 直接拒绝（模板字段已被摘掉，不再被静默忽略）
  await assert.rejects(
    () => svc.updateSettings({ ackPrompt: ['按「改了什么 · 怎么验证」两段写'], deliveryTemplate: '{{task.id}}' }),
    /请至少指定一项/,
    '模板字段不再是可写通道',
  );
  await assert.rejects(() => svc.updateSettings({}), /请至少指定一项/, '空 patch 仍然拒绝');

  const after = await svc.getSettings();
  assert.deepEqual(after.ackPromptList, before.ackPromptList, 'ack 正文不受影响');
});

test('交付：instruction 带 ack 段（{{task.id}} 已渲染），库存原文不被改写', async () => {
  await svc.addTask({ cwd: dir, text: '# 任务甲\n\n正文' });
  const r = await getTask({ cwd: dir, summary: '本轮现状', open: false });
  assert.ok(r && r.task, '领到任务');
  assert.ok(r.instruction, '交付带 instruction');
  assert.ok(r.instruction.includes('localtask done'), 'instruction 里带 ack 段');
  assert.ok(r.instruction.includes(`--id ${r.task.id}`), 'ack 段里的 {{task.id}} 已渲染');
  assert.ok(
    !String(r.task.text).includes('localtask done'),
    'ack 绝不回写库存原文',
  );
});
