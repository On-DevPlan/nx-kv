// prompt.registry / prompt.order —— 注册表外露（S3，方案 §5.3）。
// 三端同源：CLI / HTTP / 设置页消费同一份 uiDescriptor()；顺序数组是唯一真相。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NX_KV_LOCALTASK_STORE = join(mkdtempSync(join(tmpdir(), 'nxkv-registry-')), 'localtasks.json');
process.env.NX_KV_DB = join(process.env.NX_KV_LOCALTASK_STORE, '..', 'nxkv.db');

const { PromptRegistryAction } = await import('../../src/modules/promptplug/actions/prompt-registry.js');
const { PromptOrderAction } = await import('../../src/modules/promptplug/actions/prompt-order.js');
const { container } = await import('../../src/runtime/container.js');
const { resetLocaltaskStore } = await import('../../src/modules/localtask/repo/open.js');
const { setLtSettings } = await import('../../src/modules/localtask/repo/settings.js');
const { readSettingRaw } = await import('../../src/core/db/settings.js');
const { PROMPT_ORDER_KEY } = await import('../../src/modules/promptplug/keys.js');

const DEFAULT_ORDER = [
  'context', 'attachment', 'timecheck', 'goalhint', 'doneguard', 'ext', 'ack', 'getloop',
];

test('prompt.registry：8 段齐、默认顺序位 ×10、fields 含声明路径、模板为 DB 生效项', async () => {
  resetLocaltaskStore();
  const d = await new PromptRegistryAction(container).run({});
  assert.deepEqual(d.plugins.map((p) => p.id), DEFAULT_ORDER, '无 stored 数组 → 按插件 order 播种默认位');
  assert.deepEqual(d.plugins.map((p) => p.order), DEFAULT_ORDER.map((_, i) => (i + 1) * 10));
  const context = d.plugins.find((p) => p.id === 'context');
  assert.equal(context.tag, 'nx-kv.context');
  assert.ok(context.fields.some((f) => f.key === 'repo.name'), 'fields 由 zod schema 派生');
  assert.ok(context.template.includes('{{repo.name}}'), 'template = DB 生效项（首启 = 出厂快照）');
  assert.deepEqual(context.writableKeys, ['repo', 'group', 'refRepos', 'groups']);
  const timecheck = d.plugins.find((p) => p.id === 'timecheck');
  assert.deepEqual(timecheck.writableKeys, [], '只读段 writes=[]');
});

test('prompt.order：写数组 → registry 顺序跟随；非法数组拒绝', async () => {
  resetLocaltaskStore();
  const order = ['ack', 'context', 'getloop', 'attachment', 'timecheck', 'goalhint', 'doneguard', 'ext'];
  const r = await new PromptOrderAction(container).run({ order });
  assert.deepEqual(r.order, order);
  assert.deepEqual(readSettingRaw((await import('../../src/modules/localtask/repo/open.js')).db(), PROMPT_ORDER_KEY), order);

  const d = await new PromptRegistryAction(container).run({});
  assert.deepEqual(d.plugins.map((p) => p.id), order, 'registry 按 stored 数组输出');
  assert.equal(d.plugins.find((p) => p.id === 'ack').order, 10, '数组下标 ×10，不读插件 order 字段');

  await assert.rejects(
    () => new PromptOrderAction(container).run({ order: ['ack', 'context'] }),
    /缺插件/,
    '缺 id 拒绝'
  );
  await assert.rejects(
    () => new PromptOrderAction(container).run({ order: [...order, 'ghost'] }),
    /未知插件/,
    '未知 id 拒绝'
  );
  await assert.rejects(
    () => new PromptOrderAction(container).run({ order: ['ack', 'ack', ...order.slice(2)] }),
    /重复/,
    '重复 id 拒绝'
  );
});

test('registry 的 template 跟随生效模板（用户条目 active）', async () => {
  resetLocaltaskStore();
  setLtSettings({ blockTemplates: { ack: { active: 'mine', list: [
    { id: 'builtin', name: '系统内置', template: '内置 ack', builtin: true },
    { id: 'mine', name: '我的', template: '收尾要求 {{task.id}}', builtin: false },
  ] } } });
  const d = await new PromptRegistryAction(container).run({});
  assert.equal(d.plugins.find((p) => p.id === 'ack').template, '收尾要求 {{task.id}}');
});
