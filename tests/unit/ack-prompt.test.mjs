// ack 完成总结提示词（settings.ackPrompt）测试 —— 任务 #32「统一收敛提示词/模板」。
//
// 语义：agent 完成任务时写的**完成总结（ack）**该按什么格式——收进设置里，
// 随领取交付的 instruction 一起给到 agent。与收尾指令（taskSuffix）同款多条
// 列表、同款占位符语法，但两点不同：
//   1. 缺省为空 —— 没配置就不往交付里追加任何东西（默认交付逐字不变）；
//   2. 它只进 instruction 字段，不拼进 task.text（那是收尾指令的旧行为）。
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

test('ack 提示词：缺省为空（不配置 = 交付里不追加）；多条按条存', () => {
  assert.deepEqual(svc.clampAckPromptList(undefined), [], '缺省为空数组');
  assert.deepEqual(svc.clampAckPromptList(null), []);
  assert.deepEqual(svc.clampAckPromptList([]), [], '空数组 = 关闭');
  assert.deepEqual(svc.clampAckPromptList(''), [], '空串 = 关闭');
  assert.deepEqual(svc.clampAckPromptList(['  a  ', '', 'b']), ['a', 'b'], '逐条 trim、空条丢弃');
  assert.deepEqual(svc.clampAckPromptList('单条'), ['单条'], '旧单条写法整体算一条');
  const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
  assert.equal(svc.clampAckPromptList(many).length, 10, '条数上限 10');
  const long = 'x'.repeat(5000);
  assert.equal(svc.clampAckPromptList([long])[0].length, 2000, '单条长度截断');
});

test('ack 提示词：写进 settings 后可读回；不传时保持不变', async () => {
  const before = await svc.getSettings();
  assert.deepEqual(before.ackPromptList, [], '出厂态没有 ack 提示词');

  const saved = await svc.updateSettings({ ackPrompt: ['按「改了什么 · 怎么验证」两段写'] });
  assert.deepEqual(saved.ackPromptList, ['按「改了什么 · 怎么验证」两段写']);
  assert.equal((await svc.getSettings()).ackPromptList.length, 1);

  // 不传 ackPrompt → 原样保留（别把回调提示词一起清了）
  const again = await svc.updateSettings({ taskSuffix: ['收尾语'] });
  assert.equal(again.ackPromptList.length, 1, '只改 taskSuffix 不动 ackPrompt');
  assert.deepEqual(again.taskSuffixList, ['收尾语']);

  // 关掉
  const off = await svc.updateSettings({ ackPrompt: [] });
  assert.deepEqual(off.ackPromptList, [], '传空数组 = 关闭');
});

test('交付：配了 ack 提示词 → instruction 里带渲染后的 ack 段；没配 → 不带', async () => {
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

  // 关掉 ack → 交付里不再有这段（其余指令不受影响）
  await svc.updateSettings({ ackPrompt: [] });
  await svc.addTask({ cwd: dir, text: '# 任务乙\n\n正文' });
  const r2 = await getTask({ cwd: dir, summary: '本轮现状', open: false });
  assert.ok(r2 && r2.task, '领到第二条');
  assert.ok(
    !String(r2.instruction || '').includes('完成总结按'),
    '关掉后 instruction 不含 ack 段'
  );
});
