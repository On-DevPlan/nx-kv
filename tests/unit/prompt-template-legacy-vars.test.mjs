// #183：旧提示词模板（引用已删除的 group.note）不升级会拖垮整条提示词链。
// 回归：读时惰性迁移 + 装配前兜底，模板功能不再「完全不可用」。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nxkv-tpl-legacy-'));
  process.env.NX_KV_HOME = join(root, 'home');
  process.env.NX_KV_DB = join(root, 'db.sqlite');
});

const OLD_TEXT = `# 组上下文
{{#if group.note}}本项目在组里的位置：{{group.note}}{{/if}}
旧别名：{{group.position}}
{{#each group.peers}}- {{name}} {{#if hasNote}}({{note}}){{/if}} {{/each}}`;

test('读旧模板：废弃变量被迁移为合法字段，并一次性回写 settings', async () => {
  const { openStore } = await import('../../src/core/db/index.js');
  const { writeSettingRaw, readSettingRaw } = await import('../../src/core/db/settings.js');
  const { segmentTemplatesOf, activeTemplateTextOf } = await import('../../src/modules/promptplug/template-store.js');
  const db = openStore();
  writeSettingRaw(db, 'prompt.tpl.context', {
    activeId: 'u_legacy',
    items: [{ id: 'u_legacy', name: '旧模板', text: OLD_TEXT, createdAt: 1 }],
  });

  const seg = segmentTemplatesOf('context');
  const text = seg.items[0].text;
  assert.ok(!text.includes('group.note'), 'group.note 已清');
  assert.ok(!text.includes('group.position'), '旧别名已清');
  assert.ok(!/\{\{\s*(?:this\.)?(?:note|hasNote)\s*\}\}/.test(text), '成员 note 引用已清');
  assert.ok(text.includes('group.introDesc'), '换成组一句话描述');

  // 回写落盘：下次读到的就是升级后的数据
  const onDisk = readSettingRaw(db, 'prompt.tpl.context');
  assert.ok(!onDisk.items[0].text.includes('group.note'));

  // 迁移后的模板可以通过本段变量白名单
  const { assertPluginList } = await import('../../src/shared/prompt-plugin.js');
  const { buildPlugins } = await import('../../src/modules/promptplug/factory.js');
  const chain = buildPlugins('get', {}, {});
  assert.doesNotThrow(() => assertPluginList(chain), '整条链校验通过');
  assert.ok(activeTemplateTextOf('context').includes('group.introDesc'));
});

test('兜底：用户层模板仍含未知变量时装配回退内置（显式 overrides 仍严格报错）', async () => {
  const { openStore } = await import('../../src/core/db/index.js');
  const { writeSettingRaw } = await import('../../src/core/db/settings.js');
  const { buildPlugins } = await import('../../src/modules/promptplug/factory.js');
  const { assertPluginList } = await import('../../src/shared/prompt-plugin.js');
  const db = openStore();
  writeSettingRaw(db, 'prompt.tpl.context', {
    activeId: 'u_bad',
    items: [{ id: 'u_bad', name: '坏模板', text: '{{repo.unknownField}} 未知变量', createdAt: 1 }],
  });
  const chain = buildPlugins('get', {});
  assert.doesNotThrow(() => assertPluginList(chain));
  const ctx = chain.find((p) => p.id === 'context');
  assert.ok(!ctx.get().includes('repo.unknownField'), '回退出厂内置模板');
  // #153 契约：开发者显式传入的跨段引用必须仍然报错
  assert.throws(() => assertPluginList(buildPlugins('get', {}, { context: '{{group.note}} 旧模板' })));
});

test('#185 副本未自定义时跟随内置更新（内置随代码发布变，副本不卡旧版）', async () => {
  const { openStore } = await import('../../src/core/db/index.js');
  const { writeSettingRaw } = await import('../../src/core/db/settings.js');
  const { activeTemplateTextOf, builtinTemplateTextOf } = await import('../../src/modules/promptplug/template-store.js');
  const builtin = builtinTemplateTextOf('context');
  assert.ok(builtin.length > 0, '内置模板存在');
  const db = openStore();
  // 用户「复制为新模板」但没改：文本 == 内置（只是多了空白差异）
  writeSettingRaw(db, 'prompt.tpl.context', {
    activeId: 'u_copy',
    items: [{ id: 'u_copy', name: '副本', text: builtin.replace(/\n/g, '\n'), createdAt: 1 }],
  });
  assert.equal(activeTemplateTextOf('context'), '', '未改动的副本直接跟随内置');

  // 真正自定义过的副本仍然优先
  writeSettingRaw(db, 'prompt.tpl.context', {
    activeId: 'u_mine',
    items: [{ id: 'u_mine', name: '我的', text: '自定义：{{repo.name}}', createdAt: 2 }],
  });
  assert.equal(activeTemplateTextOf('context'), '自定义：{{repo.name}}');
});

test('#185 组主篇正文内嵌进 context 内置模板（repo 无主篇也照样加载组主篇）', async () => {
  const { builtinTemplateTextOf } = await import('../../src/modules/promptplug/template-store.js');
  const text = builtinTemplateTextOf('context');
  assert.match(text, /\{\{#if group\.intro\}\}/, '组主篇正文块');
  assert.match(text, /\{\{group\.intro\}\}/, '内嵌组主篇');
  assert.match(text, /组介绍文档：/, '无标题/描述时也给出 ref 取用');
});
