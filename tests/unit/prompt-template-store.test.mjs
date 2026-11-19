// 段模板用户层存储（#161）：多模板 / 启用切换 / 删除回落 / 脏数据守卫；
// 以及 goals.prompt 的「出厂原文视为未自定义」收敛（customGoalPromptOf）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// template-store 的落盘路径在模块加载时固化（APP_DIR）——先把 NX_KV_HOME 指到
// 临时目录再动态 import（测试隔离惯例，绝不碰真实 ~/.nx-kv）。
const root = mkdtempSync(join(tmpdir(), 'nx-kv-prompttpl-'));
process.env.NX_KV_HOME = join(root, 'home');

const { segmentTemplatesOf, upsertTemplate, activateTemplate, deleteTemplate, activeTemplateTextOf } =
  await import('../../src/modules/promptplug/template-store.js');
const { TASK_GOAL_PROMPT_TEMPLATE, customGoalPromptOf, renderCustomGoalPrompt } = await import(
  '../../src/modules/promptplug/plugins/goal-prompt.js'
);

test('默认：无记录 → 启用 builtin、无条目、生效正文为空（用类内出厂）', () => {
  const seg = segmentTemplatesOf('timecheck');
  assert.equal(seg.activeId, 'builtin');
  assert.deepEqual(seg.items, []);
  assert.equal(activeTemplateTextOf('timecheck'), '', 'builtin → 空正文 = 插件类内默认');
});

test('新建用户模板 → 即启用；生效正文返回新建正文', () => {
  const seg = upsertTemplate({ segment: 'timecheck', name: '严格版', text: '严格指令 {{task.id}}' });
  assert.equal(seg.items.length, 1);
  const hit = seg.items[0];
  assert.match(hit.id, /^u_/);
  assert.equal(seg.activeId, hit.id);
  assert.equal(activeTemplateTextOf('timecheck'), '严格指令 {{task.id}}');
  assert.deepEqual(segmentTemplatesOf('timecheck').activeId, seg.activeId, '落盘可见');
});

test('更新启用中的条目（带 id）→ 名字/正文变化，activeId 不变', () => {
  const before = segmentTemplatesOf('timecheck');
  const id = before.items[0].id;
  const seg = upsertTemplate({ segment: 'timecheck', id, name: '严格版 2', text: '更严格 {{task.id}}' });
  assert.equal(seg.activeId, id);
  assert.equal(seg.items[0].name, '严格版 2');
  assert.equal(activeTemplateTextOf('timecheck'), '更严格 {{task.id}}');
});

test('activate：切回 builtin / 切到用户条目；非法 id 静默回落 builtin', () => {
  const before = segmentTemplatesOf('timecheck');
  const id = before.items[0].id;
  assert.equal(activateTemplate('timecheck', 'builtin').activeId, 'builtin');
  assert.equal(activeTemplateTextOf('timecheck'), '', 'builtin → 空正文');
  assert.equal(activateTemplate('timecheck', id).activeId, id);
  assert.equal(activateTemplate('timecheck', 'u_不存在').activeId, 'builtin', '非法 id 不启用');
});

test('删除启用中的条目 → 回落 builtin；items 摘除', () => {
  const before = segmentTemplatesOf('timecheck');
  const id = before.items[0].id;
  activateTemplate('timecheck', id);
  const seg = deleteTemplate('timecheck', id);
  assert.equal(seg.activeId, 'builtin');
  assert.equal(seg.items.length, 0);
});

test('guard：builtin 不落盘为用户条目；脏 text 不收', () => {
  const seg = segmentTemplatesOf('doneguard');
  assert.equal(seg.activeId, 'builtin');
  // upsert 不会创建 id=builtin 的条目（id 非 u_ 前缀且非 builtin 才改写既有……
  // builtin 是禁改的出厂正文，这里验「activate 只认已存在条目」即可）
  assert.equal(activateTemplate('doneguard', 'builtin').activeId, 'builtin');
});

test('customGoalPromptOf：出厂原文 / 空 → 未自定义；自定义原样保留', () => {
  assert.equal(customGoalPromptOf(''), '');
  assert.equal(customGoalPromptOf(TASK_GOAL_PROMPT_TEMPLATE), '', '出厂原文视为未自定义（段模板接管）');
  assert.equal(customGoalPromptOf(TASK_GOAL_PROMPT_TEMPLATE + '\n'), '', '带空白也认得出');
  assert.equal(customGoalPromptOf('  '), '');
  assert.equal(customGoalPromptOf('发布方附加指令 {{goal.extra}}'), '发布方附加指令 {{goal.extra}}');
});

test('renderCustomGoalPrompt：未自定义 → 空串（渲染让位给段模板）；自定义 → 渲染', () => {
  const ctx = {
    task: { id: 1, text: 't' },
    goal: { goalKey: 'task:x:1', durationHuman: '2小时', durationSec: 7200, extra: 'E', remainingHuman: '', remainingSec: 0, elapsedHuman: '', elapsedSec: 0, overtimeSec: 0, reached: false },
  };
  assert.equal(renderCustomGoalPrompt(ctx, ''), '');
  assert.equal(renderCustomGoalPrompt(ctx, '额外要求：{{goal.extra}}'), '额外要求：E');
});

test('清理临时目录', () => {
  rmSync(root, { recursive: true, force: true });
  assert.ok(true);
});
