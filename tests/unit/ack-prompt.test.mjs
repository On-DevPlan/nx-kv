// ack 完成总结提示词（settings.ackPrompt）测试 —— 任务 #32「统一收敛提示词/模板」。
//
// 语义：agent 完成任务时写的**完成总结（ack）**该按什么格式——收进 ack 区块的
// 模板列表里，随领取交付的 instruction 一起给到 agent。旧 rule 区块已删除，
// 收尾要求与 done 指令统一由 ack 承载：
//   1. 缺省是**可见、可配置的系统内置汇报指令**（调用 localtask done 回填结果）；
//      显式清空（'' / []）恢复内置，而不是关掉（区块不能渲染成空）；
//   2. 它只进 instruction 字段，不拼进 task.text。
//
// 存储一律指向临时文件（NX_KV_LOCALTASK_STORE），绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';
import { getTask } from '../../src/modules/tasktool/get.js';

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

test('ack 提示词：缺省为默认汇报指令（可见可改）；多条按条存', () => {
  const dflt = svc.clampAckPromptList(undefined);
  assert.equal(dflt.length, 1, '缺省给一条默认 ack');
  assert.ok(dflt[0].includes('localtask done'), '默认 ack = 调用 localtask done 汇报');
  assert.deepEqual(svc.clampAckPromptList(null), dflt);
  assert.deepEqual(svc.clampAckPromptList([]), [], '空数组 → 空存储（保存时恢复内置）');
  assert.deepEqual(svc.clampAckPromptList(''), [], '空串 → 空存储（保存时恢复内置）');
  assert.deepEqual(svc.clampAckPromptList(['  a  ', '', 'b']), ['a', 'b'], '逐条 trim、空条丢弃');
  assert.deepEqual(svc.clampAckPromptList('单条'), ['单条'], '旧单条写法整体算一条');
  const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
  assert.equal(svc.clampAckPromptList(many).length, 10, '条数上限 10');
  const long = 'x'.repeat(5000);
  assert.equal(svc.clampAckPromptList([long])[0].length, 2000, '单条长度截断');
});

test('ack 提示词：写进 settings 后可读回；不传时保持不变', async () => {
  const before = await svc.getSettings();
  assert.equal(before.ackPromptList.length, 1, '出厂态带默认 ack 提示词');
  assert.ok(before.ackPromptList[0].includes('localtask done'), '默认 ack 要求调用 localtask done');

  const saved = await svc.updateSettings({ ackPrompt: ['按「改了什么 · 怎么验证」两段写'] });
  assert.deepEqual(saved.ackPromptList, ['按「改了什么 · 怎么验证」两段写']);
  assert.equal((await svc.getSettings()).ackPromptList.length, 1);

  // 不传 ackPrompt → 原样保留（别把 ack 一起清了）
  const again = await svc.updateSettings({ deliveryTemplate: '只改上下文 {{task.id}}' });
  assert.equal(again.ackPromptList.length, 1, '只改 context 区块不动 ackPrompt');
  assert.equal(again.deliveryTemplate, '只改上下文 {{task.id}}');

  // 恢复内置（不是关掉：ack 区块始终有系统内置模板）
  const off = await svc.updateSettings({ ackPrompt: [] });
  assert.equal(off.ackPromptList.length, 1, '传空数组 = 恢复内置 ack');
  assert.ok(off.ackPromptList[0].includes('localtask done'));
});

test('交付：自定义 ack → instruction 里带渲染后的 ack 段；恢复内置 → 回内置 done 指令', async () => {
  // 排一条任务并领取
  await svc.addTask({ cwd: dir, text: '# 任务甲\n\n正文' });
  await svc.updateSettings({ ackPrompt: ['完成总结按「改了什么 · 怎么验证」两段写，任务 {{task.id}}'] });

  const r = await getTask({ cwd: dir, summary: '本轮现状', open: false });
  assert.ok(r && r.task, '领到任务');
  assert.ok(r.instruction, '交付带 instruction');
  assert.ok(
    r.instruction.includes('完成总结按「改了什么 · 怎么验证」两段写'),
    'instruction 里带 ack 提示词'
  );
  assert.ok(r.instruction.includes(`任务 ${r.task.id}`), 'ack 提示词里的 {{task.id}} 已渲染');

  // 恢复内置 ack → 交付里不再有自定义文本，内置汇报指令仍保留
  await svc.updateSettings({ ackPrompt: [] });
  await svc.addTask({ cwd: dir, text: '# 任务乙\n\n正文' });
  const r2 = await getTask({ cwd: dir, summary: '本轮现状', open: false });
  assert.ok(r2 && r2.task, '领到第二条');
  assert.ok(
    !String(r2.instruction || '').includes('完成总结按'),
    '恢复内置后 instruction 不含自定义 ack 段'
  );
  assert.ok(String(r2.instruction || '').includes('localtask done'), '内置 ack 汇报要求仍在');
});
