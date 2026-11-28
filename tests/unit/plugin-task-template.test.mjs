// 内部插件宿主 + 任务模板插件：入口、草稿、模板 CRUD、可见性、全局开关。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createTestStore } from '../support/test-store.mjs';
import { migrate } from '../../src/core/db/migrator.ts';

test('插件宿主与 task-template：入口/草稿/CRUD/可见性/开关', async () => {
  const s = await createTestStore();
  try {
    const host = await import('../../src/modules/plugin/host.ts');

    const plugins = await host.listPlugins();
    const taskPlugin = plugins.find((p) => p.id === 'task-template');
    assert.ok(taskPlugin, 'task-template 插件已加载');
    assert.equal(taskPlugin.enabled, true, '默认启用');
    assert.equal(taskPlugin.entryCount, 1, '只有内置 ref 入口（管理页走侧栏，不进下拉）');

    let entries = await host.listEntries({});
    assert.deepEqual(
      entries.entries.map((e) => e.id),
      ['task-template:ref'],
      '初始只有内置声明入口',
    );
    // #286：未显式配置 = 不指定（空白任务页），插件声明不再驱动主按钮
    assert.equal(entries.defaultEntryId, '');
    assert.equal(entries.defaultExplicit, false);

    const builtin = await host.buildDraft({ entryId: 'task-template:ref', values: {} });
    assert.ok(builtin.body.includes('## 本轮问题'), '内置 ref 生成正文');
    assert.ok(builtin.body.includes('docs ref add'), 'SOP 里有建 ref 命令');

    const added = await host.callRpc('task-template', 'addTemplate', {
      name: '测试模板',
      body: '# 测试\n\n问题：{{问题}}',
    });
    const entryId = added.template.id;
    assert.match(entryId, /^task-template:t_/);
    assert.deepEqual(added.template.slots.map((x) => x.key), ['问题']);

    entries = await host.listEntries({});
    assert.ok(entries.entries.some((e) => e.id === entryId), '新模板出现在入口列表');
    const draft = await host.buildDraft({ entryId, values: { 问题: '你好' } });
    assert.equal(draft.body, '# 测试\n\n问题：你好');

    // 每 topic 可见性：隐藏后普通列表不出现，all=true 仍能看到（管理页用）
    await host.setVisibility('topic:abc', [{ entryId, visible: false, sortOrder: 0 }]);
    const hidden = await host.listEntries({ topicKey: 'abc' });
    assert.ok(!hidden.entries.some((e) => e.id === entryId), '本主题隐藏');
    const admin = await host.listEntries({ topicKey: 'abc', all: true });
    const hiddenRow = admin.entries.find((e) => e.id === entryId);
    assert.equal(hiddenRow.visible, false, 'all=true 给出 visible=false');
    const other = await host.listEntries({ topicKey: 'other' });
    assert.ok(other.entries.some((e) => e.id === entryId), '其他主题仍可见（opt-out）');

    // 主题级「新建页」默认入口：配置优先于插件声明；保存可见性不清默认
    const defaulted = await host.setDefaultEntry('topic:abc', entryId);
    assert.equal(defaulted.defaultEntryId, entryId);
    const scoped = await host.listEntries({ topicKey: 'abc' });
    assert.equal(scoped.defaultEntryId, '', '配置的默认项被隐藏时视同未配置（#286）');
    assert.equal(scoped.defaultExplicit, false);
    await host.setVisibility('topic:abc', [{ entryId, visible: true, sortOrder: 0 }]);
    const shown = await host.listEntries({ topicKey: 'abc' });
    assert.equal(shown.defaultEntryId, entryId, '恢复可见后主题默认生效');
    assert.equal((await host.getVisibility('topic:abc')).defaultEntryId, entryId, '可见性接口回读默认项');
    const cleared = await host.setDefaultEntry('topic:abc', '');
    assert.equal(cleared.defaultEntryId, '', '空 entryId = 不指定（空白任务页，#286）');

    // 默认入口 + 删除回落
    const def = await host.callRpc('task-template', 'setDefault', { id: entryId });
    assert.equal(def.defaultId, entryId);
    entries = await host.listEntries({});
    // #286：插件级声明不再驱动主按钮（未显式配置 = 空白任务页）
    assert.equal(entries.defaultEntryId, '');
    assert.equal(entries.defaultExplicit, false);
    const removed = await host.callRpc('task-template', 'removeTemplate', { id: entryId });
    assert.equal(removed.defaultId, 'task-template:ref', '删默认回落内置');

    // 全局开关
    await host.setPluginEnabled('task-template', false);
    const off = await host.listEntries({});
    assert.equal(off.entries.length, 0, '全局关闭后没有入口');
    await host.setPluginEnabled('task-template', true);
    const on = await host.listEntries({});
    assert.ok(on.entries.some((e) => e.id === 'task-template:ref'), '重新启用后入口回来');
  } finally {
    s.reset();
  }
});

test('v18 存量用户模板：v19 暂存 → v20 drop → 插件激活导入并保留默认/值', async () => {
  const s = await createTestStore({ open: false, importLegacy: false });
  try {
    const raw = s.core.openRaw(s.dbPath);
    migrate(raw, {
      from: 0,
      to: 18,
      context: {
        attachmentsRoot: join(s.appDir, 'attachments'),
        docsDir: join(s.appDir, 'docs'),
      },
    });
    const at = Date.now();
    raw.run(
      `INSERT INTO templates
         (id, category, name, slot, body, vars_schema, vars, is_default, enabled, sort_order,
          builtin, state, version, deleted_at, created_at, updated_at, scope, origin_topic)
       VALUES
         ('t_old', 'newtask', '旧模板', 'suffix', '# 旧模板\n\n目标：{{目标}}', '[]', '{"目标":"旧值"}',
          1, 1, 0, 0, '', 0, NULL, :at, :at, '["*"]', '')`,
      { at },
    );
    raw.run("INSERT OR REPLACE INTO meta (key, value, updated_at) VALUES ('store_kind', 'sqlite', :at)", { at });
    raw.close();

    s.open();
    assert.equal(
      s.db.get("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'templates'").c,
      0,
      'v20 已删除 templates',
    );
    const staged = JSON.parse(
      s.db.get("SELECT payload_json FROM plugin_legacy_data WHERE plugin_id='task-template'").payload_json,
    );
    assert.deepEqual(staged.rows.map((r) => r.id), ['t_old']);
    assert.equal(staged.defaultId, 't_old');

    const host = await import('../../src/modules/plugin/host.ts');
    const data = await host.callRpc('task-template', 'listTemplates');
    const old = data.templates.find((t) => t.id === 'task-template:t_old');
    assert.ok(old, '旧用户模板已进插件表');
    assert.equal(old.default, true, '旧默认入口保留');
    assert.equal(old.vars.目标, '旧值', '旧槽位值保留');
    const draft = await host.buildDraft({ entryId: old.id, values: { 目标: '新值' } });
    assert.ok(draft.body.includes('新值'), '旧模板仍可生成草稿');
  } finally {
    s.reset();
  }
});
