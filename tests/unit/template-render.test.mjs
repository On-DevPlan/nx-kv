// 任务模板渲染：新建任务正文不得出现裸 {{槽位}} 标记（任务 #32 验收反馈）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEW_TEMPLATE,
  NEW_TEMPLATE_VALUES,
} from '../../src/web/frontend/modules/md/md-parse.js';
import { renderTemplateBody, slotsOf } from '../../src/web/frontend/modules/prompts/placeholders.js';

test('slotsOf：扫出内置骨架槽位', () => {
  assert.deepEqual(slotsOf(NEW_TEMPLATE), ['背景', '验收', '约束']);
});

test('renderTemplateBody：用默认值渲染后没有 {{', () => {
  const body = renderTemplateBody(NEW_TEMPLATE, NEW_TEMPLATE_VALUES);
  assert.equal(body.includes('{{'), false, '不应再含 mustache 标记');
  assert.match(body, /一句话说清要改什么/);
  assert.match(body, /## 背景/);
  assert.match(body, /## 验收/);
});

test('renderTemplateBody：缺键 → 空串（不把标记留回正文）', () => {
  const body = renderTemplateBody('A{{背景}}B{{验收}}C', { 背景: 'x' });
  assert.equal(body, 'AxBC');
  assert.equal(body.includes('{{'), false);
});

test('renderTemplateBody：用户显式空串保留为空', () => {
  const body = renderTemplateBody(NEW_TEMPLATE, { ...NEW_TEMPLATE_VALUES, 背景: '' });
  assert.equal(body.includes('{{'), false);
  assert.equal(body.includes('一句话说清'), false, '不应再填默认值');
  assert.match(body, /## 背景/);
  assert.match(body, /## 验收/);
});
