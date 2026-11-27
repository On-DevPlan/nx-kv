// pretask 共享纯函数：槽位抽取 / 渲染 / 旧模板 scope 过滤。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateSlots, renderTemplateBody } from '../../packages/plugin-sdk/src/template.ts';
import { renderTemplateBody as hostRenderTemplateBody } from '../../src/modules/plugin/template.ts';
import { normalizeScope, canUse, isScopeEntry } from '../../packages/plugin-task-template/src/server/scope.ts';

test('templateSlots：首次出现顺序去重，忽略空槽', () => {
  assert.deepEqual(templateSlots('## {{问题}}\n\n{{问题}}\n{{ 背景 }}\n{{}}\n{{   }}'), ['问题', '背景']);
  assert.deepEqual(templateSlots('没有槽位'), []);
});

test('renderTemplateBody：填值替换，没值留空', () => {
  const body = '问题：{{问题}}\n背景：{{背景}}';
  assert.equal(renderTemplateBody(body, { 问题: '怎么扩展附件类型' }), '问题：怎么扩展附件类型\n背景：');
  assert.equal(renderTemplateBody(body, {}), '问题：\n背景：');
  assert.ok(!renderTemplateBody(body, { 问题: 'x' }).includes('{{'), '不留 mustache');
});

test('宿主与插件 SDK 的模板渲染同一口径（发布后宿主不依赖 SDK）', () => {
  const cases = [
    ['正文 {{a}} / {{ b }} / {{}}', { a: 'A', b: 'B' }],
    ['没有槽位', {}],
    ['{{x}}', null],
  ];
  for (const [body, values] of cases) {
    assert.equal(hostRenderTemplateBody(body, values), renderTemplateBody(body, values), body);
  }
});

test('scope：词表校验 / 归一 / 三把钥匙命中', () => {
  assert.equal(isScopeEntry('*'), true);
  assert.equal(isScopeEntry('repo:test/projA'), true);
  assert.equal(isScopeEntry('topic:'), false);
  assert.equal(isScopeEntry('user:abc'), false);
  assert.deepEqual(normalizeScope(['topic:x', '*', 'topic:x', 'garbage']), ['topic:x', '*']);
  const ctx = { topicKey: 't1', repoKey: 'r1', groupKey: 'g1' };
  assert.equal(canUse(['*'], ctx), true);
  assert.equal(canUse(['topic:t1'], ctx), true);
  assert.equal(canUse(['repo:r1'], ctx), true);
  assert.equal(canUse(['group:g1'], ctx), true);
  assert.equal(canUse(['topic:other'], ctx), false);
  assert.equal(canUse([], ctx), false);
  assert.equal(canUse([], {}), true, '管理上下文（三钥皆空）可见');
});
