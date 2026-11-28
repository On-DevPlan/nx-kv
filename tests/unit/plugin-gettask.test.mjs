// gettask（第二生命周期点）：声明聚合 → 候选标准接口 → 按任务取块 → 交付区块 → 模板覆盖。
//
// 用内置 skill-ref 插件当被测实现：扫描临时仓库的 .claude/skills，按 task.id 绑定选中技能。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestStore } from '../support/test-store.mjs';

function writeSkill(root, name, frontmatter, body) {
  const dir = join(root, '.claude', 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `${frontmatter}${body}`, 'utf8');
  return dir;
}

test('gettask：skill-ref 声明 / 候选接口 / 任务取数 / 交付区块 / 模板覆盖', async () => {
  const s = await createTestStore();
  const repoDir = mkdtempSync(join(tmpdir(), 'nxkv-skillrepo-'));
  const extraDir = mkdtempSync(join(tmpdir(), 'nxkv-skillextra-'));
  try {
    writeSkill(
      repoDir,
      'demo-skill',
      '---\nname: "demo-skill"\ndescription: "演示技能：先读 README"\n---\n',
      '# demo\n\n按演示流程执行。\n',
    );
    writeSkill(
      extraDir,
      'extra-skill',
      '---\nname: "extra-skill"\ndescription: "额外目录里的技能"\n---\n',
      '# extra\n',
    );

    // 先 import gettask（模块加载即把外部段声明注册给 promptplug）。
    const { listGetTaskEntries, collectGetTaskBlocks } = await import('../../src/modules/plugin/gettask.ts');
    const { listCandidates } = await import('../../src/modules/plugin/candidates.ts');
    const host = await import('../../src/modules/plugin/host.ts');

    const decl = await listGetTaskEntries({});
    const hit = decl.entries.find((e) => e.segment === 'plugin:skill-ref:skills');
    assert.ok(hit, 'skill-ref 声明了技能引用区块');
    assert.equal(hit.tag, 'nxkv.plugin.skill-ref.skills');
    assert.equal(hit.ui.panel, 'skill-picker');
    assert.equal(hit.icon, 'star', 'gettask 条目继承插件声明的 icon');
    assert.ok(hit.fields.some((f) => f.key === 'skills'), '技能列表进入变量目录');
    assert.ok(hit.fields.some((f) => f.key === 'skillCount'), '技能数量进入变量目录');
    assert.ok(hit.fields.some((f) => f.key === 'task.id'), '任务身份字段自动补齐');

    // 候选条目标准接口：按 cwd 找到仓库技能。
    const found = await listCandidates({ pluginId: 'skill-ref', cwd: repoDir });
    assert.equal(found.warnings.length, 0);
    const demo = found.candidates.find((c) => c.label === 'demo-skill');
    assert.ok(demo, '候选接口返回 .claude/skills 下的技能');
    assert.equal(demo.kind, 'skill');
    assert.equal(demo.meta.source, 'cwd');
    assert.ok(String(demo.path).endsWith('SKILL.md'));

    // 额外目录：配置后同样进入候选。
    await host.callRpc('skill-ref', 'setSettings', { extraDirs: [extraDir] });
    const found2 = await listCandidates({ pluginId: 'skill-ref', cwd: repoDir, q: '额外' });
    assert.ok(found2.candidates.some((c) => c.label === 'extra-skill'), '配置目录进入候选');
    assert.equal(found2.candidates.find((c) => c.label === 'extra-skill').meta.source, 'config');

    // 任务级绑定：选中 -> 取块。
    await host.callRpc('skill-ref', 'taskSkillsSave', { taskKey: '9', ids: [demo.id] });
    const got = await host.callRpc('skill-ref', 'taskSkillsGet', { taskKey: '9' });
    assert.deepEqual(got.ids, [demo.id]);

    // 新建任务即真实实体：只按数字任务号存取。
    await host.callRpc('skill-ref', 'taskSkillsSave', { taskKey: '12', ids: [demo.id] });
    const taskGot = await host.callRpc('skill-ref', 'taskSkillsGet', { taskKey: '12' });
    assert.deepEqual(taskGot.ids, [demo.id], '真实任务号可读写');

    // 历史草稿表只读兼容：模拟升级前留下的 draft 行。
    const { db } = await import('../../src/modules/plugin/repo/db.ts');
    db().run(
      "INSERT INTO plugin_skill_ref_task_drafts (task_key, skills, updated_at) VALUES ('draft-1', ?, ?)",
      [JSON.stringify([demo.id]), Date.now()],
    );
    const legacy = await host.callRpc('skill-ref', 'taskSkillsGet', { taskKey: 'draft-1' });
    assert.deepEqual(legacy.ids, [demo.id], '历史草稿行可回显');
    await assert.rejects(
      () => host.callRpc('skill-ref', 'taskSkillsSave', { taskKey: 'draft-1', ids: [] }),
      /真实任务号/,
      '草稿键不再可写',
    );

    // 预览交付：真实任务号（Web 所有任务从创建起就有实体）。
    const { previewTaskDelivery } = await import('../../src/modules/claim/preview.ts');
    const preview = await previewTaskDelivery({
      task: { id: 9, text: '技能预览', status: 'plan' },
      cwd: repoDir,
    });
    assert.match(preview.instruction, /<nxkv\.plugin\.skill-ref\.skills>/, '预览包含技能区块');
    assert.match(preview.instruction, /demo-skill/);

    const blocks = await collectGetTaskBlocks(
      { id: 9, text: '实现技能引用', cwd: repoDir },
      { cwd: repoDir },
    );
    assert.equal(blocks.blocks.length, 1, '命中 1 个技能区块');
    assert.equal(blocks.blocks[0].data.skillCount, 1);
    assert.equal(blocks.blocks[0].data.skills[0].name, 'demo-skill');

    // 没有选中的任务不出段。
    const empty = await collectGetTaskBlocks(
      { id: 10, text: '另一条任务', cwd: repoDir },
      { cwd: repoDir },
    );
    assert.equal(empty.blocks.length, 0);

    const { assembleDelivery } = await import('../../src/modules/claim/assemble.ts');
    const out = await assembleDelivery({
      task: { id: 9, text: '实现技能引用' },
      attachCtx: null,
      goalCtx: null,
      groupCtx: null,
      queueInfo: null,
      gettaskBlocks: blocks.blocks,
    });
    assert.match(out.instruction, /<nxkv\.plugin\.skill-ref\.skills>/, '交付里出现插件区块标签');
    assert.match(out.instruction, /demo-skill/, '技能名进入交付');
    assert.match(out.instruction, /SKILL\.md/, '技能路径进入交付');

    // 外部段进入 promptplug 注册表；用户模板覆盖走同一套变量白名单。
    const { externalSegments } = await import('../../src/modules/promptplug/external.ts');
    const ext = await externalSegments();
    assert.ok(ext.some((e) => e.id === 'plugin:skill-ref:skills'));

    const { PromptTemplateSaveAction } = await import('../../src/modules/promptplug/actions/prompt-template-save.ts');
    const { container } = await import('../../src/runtime/container.ts');
    const segment = 'plugin:skill-ref:skills';
    await new PromptTemplateSaveAction(container).run({
      segment,
      name: '自定义技能模板',
      text: '任务 #{{task.id}} 需要加载 {{skillCount}} 个技能：\n{{#each skills}}- {{name}} => {{path}}\n{{/each}}',
    });
    const blocks2 = await collectGetTaskBlocks(
      { id: 9, text: '实现技能引用', cwd: repoDir },
      { cwd: repoDir },
    );
    const out2 = await assembleDelivery({
      task: { id: 9, text: '实现技能引用' },
      attachCtx: null,
      goalCtx: null,
      groupCtx: null,
      queueInfo: null,
      gettaskBlocks: blocks2.blocks,
    });
    assert.match(out2.instruction, /任务 #9 需要加载 1 个技能/, '用户模板覆盖出厂模板');
    assert.match(out2.instruction, /demo-skill => .*SKILL\.md/);

    await assert.rejects(
      () =>
        new PromptTemplateSaveAction(container).run({
          segment,
          text: '{{missing.field}}',
        }),
      /没有的变量/,
      '引用未声明变量不许落盘',
    );
  } finally {
    s.reset();
  }
});
