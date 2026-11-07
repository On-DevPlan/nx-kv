// 任务模板渲染：新建任务正文不得出现裸 {{槽位}} 标记（任务 #32 验收反馈）。
//
// 任务 #87 起：出厂骨架**就是文字**（不再留 {{槽位}} 标记）——「直接文字就是模板」。
// 老模板（库里还留着 {{槽位}} 的正文）仍按 values 渲染成文字——兼容路径不能塌。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEW_TEMPLATE,
  NEW_TEMPLATE_VALUES,
} from '../../src/web/frontend/modules/md/md-parse.js';
import { renderTemplateBody } from '../../src/web/frontend/modules/prompts/placeholders.js';

test('出厂骨架是文字：不含 {{槽位}} 标记', () => {
  assert.equal(NEW_TEMPLATE.includes('{{'), false, '出厂骨架不应再有槽位标记');
  assert.match(NEW_TEMPLATE, /## 背景/);
  assert.match(NEW_TEMPLATE, /一句话说清要改什么/);
  assert.match(NEW_TEMPLATE, /## 验收/);
});

test('renderTemplateBody：用默认值渲染后没有 {{', () => {
  const body = renderTemplateBody(NEW_TEMPLATE, NEW_TEMPLATE_VALUES);
  assert.equal(body.includes('{{'), false, '不应再含 mustache 标记');
  assert.match(body, /一句话说清要改什么/);
  assert.match(body, /## 背景/);
  assert.match(body, /## 验收/);
});

test('renderTemplateBody：老模板（{{槽位}}）仍渲染成文字', () => {
  const old = '## 背景\n\n{{背景}}\n\n## 验收\n- [ ] {{验收}}\n';
  const body = renderTemplateBody(old, { 背景: '要做的事', 验收: '…' });
  assert.equal(body.includes('{{'), false, '老模板也不该把标记露回正文');
  assert.match(body, /要做的事/);
  assert.match(body, /## 背景/);
});

test('renderTemplateBody：缺键 → 空串（不把标记留回正文）', () => {
  const body = renderTemplateBody('A{{背景}}B{{验收}}C', { 背景: 'x' });
  assert.equal(body, 'AxBC');
  assert.equal(body.includes('{{'), false);
});

test('renderTemplateBody：用户显式空串保留为空', () => {
  const body = renderTemplateBody('## 背景\n\n{{背景}}\n', { 背景: '' });
  assert.equal(body.includes('{{'), false);
  assert.equal(body.includes('一句话说清'), false, '不应再填默认值');
  assert.match(body, /## 背景/);
});
