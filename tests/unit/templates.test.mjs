// 任务模板（templates 模块）单元测试：列表 / 新增 / 设默认 / 删除 / 兜底。
//
// 存储一律指向临时文件（NX_KV_TEMPLATES_STORE），绝不写脏用户目录。
// 在 import 服务模块**之前**设好环境变量（模块读 env 在调用时，但早设无害）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-tpl-test-'));
process.env.NX_KV_TEMPLATES_STORE = join(tmp, 'templates.json');

const { BUILTIN_ID, listTemplates, addTemplate, removeTemplate, setDefaultTemplate, updateTemplate } = await import(
  '../../src/modules/templates/service.js'
);

beforeEach(() => {
  rmSync(join(tmp, 'templates.json'), { force: true });
});

test('空 store → 内置默认模板兜底', async () => {
  const d = await listTemplates();
  assert.equal(d.defaultId, BUILTIN_ID);
  assert.equal(d.templates.length, 1);
  assert.equal(d.templates[0].builtin, true);
  assert.ok(d.templates[0].body.includes('## 背景'), '内置正文应带骨架');
});

test('新增模板 + 设默认', async () => {
  const a = await addTemplate({ name: '缺陷修复', body: '# 缺陷修复\n\n## 复现步骤' });
  assert.notEqual(a.template.id, BUILTIN_ID);
  let d = await listTemplates();
  assert.equal(d.templates.length, 2);
  assert.equal(d.defaultId, BUILTIN_ID, '没给 setDefault 就不该改默认');

  const b = await addTemplate({ name: '周报', body: '# 周报', setDefault: true });
  d = await listTemplates();
  assert.equal(d.defaultId, b.template.id, 'setDefault=true 应把新模板设为默认');
});

test('空正文新增 → 落内置骨架，不存空页', async () => {
  const a = await addTemplate({ name: '空骨架', body: '' });
  assert.ok(a.template.body.includes('## 验收'), '空正文应回退到内置骨架');
});

test('新增缺名字 → INVALID_INPUT', async () => {
  await assert.rejects(() => addTemplate({ name: '   ', body: 'x' }), /模板名/);
});

test('删除：内置不可删；删自定义默认 → 默认回落内置', async () => {
  const b = await addTemplate({ name: '临时', body: '# 临时', setDefault: true });
  await assert.rejects(() => removeTemplate({ id: BUILTIN_ID }), /内置默认模板不可删除/);

  const r = await removeTemplate({ id: b.template.id });
  assert.equal(r.wasDefault, true);
  const d = await listTemplates();
  assert.equal(d.defaultId, BUILTIN_ID, '删掉默认模板后默认应回落到内置');
  assert.equal(d.templates.length, 1);
});

test('删除不存在的模板 → NOT_FOUND', async () => {
  await assert.rejects(() => removeTemplate({ id: 't_nope' }), /没有 id/);
  await assert.rejects(() => setDefaultTemplate({ id: 't_nope' }), /没有 id/);
  await assert.rejects(() => updateTemplate({ id: 't_nope', name: 'x' }), /没有 id/);
});

test('编辑模板：只改传入字段；内置不可编辑', async () => {
  const a = await addTemplate({ name: '旧名', body: '# 旧正文' });
  const u = await updateTemplate({ id: a.template.id, name: '新名' });
  assert.equal(u.template.name, '新名');
  assert.equal(u.template.body, '# 旧正文', '未提供的 body 应保持不变');

  const u2 = await updateTemplate({ id: a.template.id, body: '# 新正文\n\n## 步骤' });
  assert.equal(u2.template.name, '新名', '未提供的 name 应保持不变');
  assert.ok(u2.template.body.includes('## 步骤'));

  await assert.rejects(() => updateTemplate({ id: BUILTIN_ID, name: '改名' }), /内置默认模板不可编辑/);
  await assert.rejects(() => updateTemplate({ id: a.template.id, name: '   ' }), /模板名/);
});

test('正文可来自文件（--body-file）：多行 Markdown 的实用姿势', async () => {
  const file = join(tmp, 'tpl.md');
  writeFileSync(file, '# 缺陷修复\n\n## 复现步骤\n- 步骤一\n- 步骤二\n', 'utf8');
  const a = await addTemplate({ name: '来自文件', bodyFile: file });
  assert.ok(a.template.body.includes('## 复现步骤'));
  assert.ok(a.template.body.includes('步骤二'));

  // body 优先于文件
  const b = await addTemplate({ name: 'body 优先', body: '# 字面量', bodyFile: file });
  assert.equal(b.template.body, '# 字面量');

  // update 也能从文件改正文
  const u = await updateTemplate({ id: a.template.id, bodyFile: file });
  assert.ok(u.template.body.includes('复现步骤'));

  // 读不到的文件 → 明确报错
  await assert.rejects(() => addTemplate({ name: 'x', bodyFile: join(tmp, 'nope.md') }), /读模板文件失败/);
});

test('设默认 + 落盘持久（重读仍在）', async () => {
  const a = await addTemplate({ name: '持久', body: '# 持久' });
  const s = await setDefaultTemplate({ id: a.template.id });
  assert.equal(s.defaultId, a.template.id);

  // 模拟新进程：清掉模块缓存重读同一份 store 文件
  const svcPath = '../../src/modules/templates/service.js';
  const mod = await import(svcPath + '?fresh=' + Date.now());
  const d = await mod.listTemplates();
  assert.equal(d.defaultId, a.template.id, '重读 store 文件默认应保持');
  assert.ok(d.templates.some((t) => t.name === '持久'));
});

test('损坏的 store 文件 → 出厂态（内置兜底，不抛错）', async () => {
  writeFileSync(join(tmp, 'templates.json'), '{ not json', 'utf8');
  const d = await listTemplates();
  assert.equal(d.defaultId, BUILTIN_ID);
  assert.equal(d.templates.length, 1);
});
