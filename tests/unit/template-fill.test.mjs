// #191：提示词式任务模板的槽位填写链路（ef449ea 曾整体下线，本轮恢复）。
//
// 钉住三件事：
//   1. templateSlots 按首次出现顺序抽出 {{槽位}}；
//   2. 填好的值渲染进正文，没值的槽位留空（任务正文里绝不出现裸 {{...}}）；
//   3. templateDraftBody 只产出纯文本草稿——模板身份不写进 frontmatter（编辑器零槽位概念），
//      board / project 这类归属字段由 extra 写进 frontmatter。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateSlots, renderTemplatePreview, templateDraftBody } from '../../src/web/frontend/modules/prompts/template-preview.js';
import { renderTemplateBody } from '../../src/web/frontend/modules/prompts/render-template-body.js';

test('templateSlots：按首次出现顺序去重，忽略空槽与纯空白', () => {
  assert.deepEqual(
    templateSlots('## {{问题}}\n\n{{问题}}\n{{ 背景 }}\n{{}}\n{{   }}'),
    ['问题', '背景'],
  );
  assert.deepEqual(templateSlots('没有任何槽位的正文'), []);
});

test('renderTemplateBody：填值替换，没值留空（任务正文不出现裸 {{槽位}}）', () => {
  const body = '问题：{{问题}}\n背景：{{背景}}';
  assert.equal(renderTemplateBody(body, { 问题: '怎么扩展附件类型' }), '问题：怎么扩展附件类型\n背景：');
  assert.equal(renderTemplateBody(body, {}), '问题：\n背景：');
  assert.ok(!renderTemplateBody(body, { 问题: 'x' }).includes('{{'), '不留任何 mustache 标记');
});

test('renderTemplatePreview：没值的槽位显示 〔槽位名〕 占位（与生成语义分开）', () => {
  const body = 'A={{a}} B={{b}}';
  assert.equal(renderTemplatePreview(body, { a: '填了' }), 'A=填了 B=**〔b〕**');
});

test('templateDraftBody：生成纯文本草稿，槽位由 valuesOverride 覆盖，归属写 frontmatter', () => {
  const tpl = { id: 't1', body: '# {{标题}}\n\n{{正文}}', values: { 标题: '默认标题', 正文: '默认正文' } };
  // 不传 override → 用模板自带默认值
  assert.equal(templateDraftBody(tpl), '# 默认标题\n\n默认正文');
  // 传 override → 覆盖默认值（参数页填的值）
  assert.equal(
    templateDraftBody(tpl, {}, { 标题: '我填的', 正文: '我写的' }),
    '# 我填的\n\n我写的',
  );
  const withFm = templateDraftBody(tpl, { board: 'b1', project: 'repo/x' }, { 标题: 'T', 正文: 'B' });
  assert.ok(withFm.startsWith('---\n'), '归属字段写进 frontmatter');
  assert.match(withFm, /board: b1/);
  assert.match(withFm, /project: repo\/x/);
  assert.ok(withFm.includes('# T'), '正文已渲染');
  assert.ok(!withFm.includes('{{'), '编辑器里没有槽位概念');
  assert.ok(!/template:\s*/.test(withFm), '不写 template 身份字段');
});
