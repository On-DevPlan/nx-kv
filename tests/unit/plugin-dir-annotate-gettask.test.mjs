// 目录批注 gettask：目录要求条目（按仓库）+ 启用列表（按主题）+ 插件内部提示词。
//
// 口径（用户确认）：
//   · 默认不启用，由用户按主题勾选；
//   · 启用列表按 topicKey 保留，同一主题下的任务共享；
//   · 条目按仓库保存，组任务用任务所属的具体仓库；
//   · 领取提示词由插件内部生成，全局模板只取 {{prompt}}。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from '../support/test-store.mjs';

const REPO = 'local/demo';
const TOPIC_A = 'topic-a';
const TOPIC_B = 'topic-b';

test('dir-annotate gettask：条目按仓库、启用按主题、默认不启用、提示词内部生成', async () => {
  const s = await createTestStore();
  try {
    // 宿主解析插件上下文时要求仓库已登记（生产里 repo/topic 一定存在）。
    const repos = await import('../../src/modules/repos/service.js');
    await repos.addRepo({ path: s.appDir, key: REPO, name: 'demo', type: 'dev' });

    const { listGetTaskEntries, collectGetTaskBlocks } = await import('../../src/modules/plugin/gettask.ts');
    const { listCandidates } = await import('../../src/modules/plugin/candidates.ts');
    const host = await import('../../src/modules/plugin/host.ts');

    const decl = await listGetTaskEntries({});
    const hit = decl.entries.find((e) => e.segment === 'plugin:dir-annotate:requirements');
    assert.ok(hit, 'dir-annotate 声明了目录要求区块');
    assert.equal(hit.tag, 'nxkv.plugin.dir-annotate.requirements');
    assert.equal(hit.ui.panel, 'requirements');
    assert.equal(hit.icon, 'folder', 'gettask 条目继承插件声明的 icon');
    assert.equal(hit.template, '{{prompt}}', '全局模板只取插件生成的提示词变量');
    assert.ok(hit.fields.some((f) => f.key === 'prompt'), 'prompt 进入变量目录');
    assert.ok(hit.fields.some((f) => f.key === 'entryCount'), 'entryCount 进入变量目录');

    // 条目按仓库保存；同一 repo + dir + title 视为同一条。
    const first = await host.callRpc('dir-annotate', 'requirementsSave', {
      repoKey: REPO,
      dir: 'docs',
      title: 'docs 文档保持最新',
      detail: '代码改动后同步更新 docs/ 下的说明。',
    });
    assert.match(String(first.id), /^req_/);
    const again = await host.callRpc('dir-annotate', 'requirementsSave', {
      repoKey: REPO,
      dir: 'docs',
      title: 'docs 文档保持最新',
      detail: '代码改动后同步更新 docs/ 下的说明；新增命令必须补示例。',
    });
    assert.equal(again.id, first.id, '同仓库同目录同标题是更新，不是新增');
    const second = await host.callRpc('dir-annotate', 'requirementsSave', {
      repoKey: REPO,
      dir: 'src',
      title: 'src 注释与 README 同步',
      detail: '公开函数变更时同步更新 README 的用法段落。',
    });
    assert.notEqual(second.id, first.id);

    const listed = await host.callRpc('dir-annotate', 'requirementsList', { repoKey: REPO });
    assert.equal(listed.entries.length, 2);
    assert.deepEqual(
      listed.entries.map((e) => e.id),
      [first.id, second.id],
      '按 position 稳定排序，更新不改变顺序',
    );

    // 默认不启用：没有主题启用记录时不出区块。
    const empty = await collectGetTaskBlocks(
      { id: 5, text: '更新 docs', topicKey: TOPIC_A, projectKey: REPO },
      { topicKey: TOPIC_A, repoKey: REPO },
    );
    assert.equal(empty.blocks.filter((b) => b.pluginId === 'dir-annotate').length, 0, '默认不启用');

    // 主题 A 只启用第一条：同一仓库的另一条不出现。
    const savedA = await host.callRpc('dir-annotate', 'topicRequirementsSave', {
      topicKey: TOPIC_A,
      ids: [first.id],
    });
    assert.deepEqual(savedA.ids, [first.id]);
    const gotA = await host.callRpc('dir-annotate', 'topicRequirementsGet', { topicKey: TOPIC_A });
    assert.deepEqual(gotA.ids, [first.id]);

    const blocksA = await collectGetTaskBlocks(
      { id: 5, text: '更新 docs', topicKey: TOPIC_A, projectKey: REPO },
      { topicKey: TOPIC_A, repoKey: REPO },
    );
    const annA = blocksA.blocks.find((b) => b.pluginId === 'dir-annotate');
    assert.ok(annA, '主题 A 出目录要求区块');
    assert.equal(annA.data.entryCount, 1);
    assert.match(String(annA.data.prompt), /docs 文档保持最新/);
    assert.match(String(annA.data.prompt), /docs/);
    assert.match(String(annA.data.prompt), /新增命令必须补示例/);
    assert.doesNotMatch(String(annA.data.prompt), /src 注释与 README 同步/);

    // 主题 B 独立：启用第二条不影响 A。
    await host.callRpc('dir-annotate', 'topicRequirementsSave', { topicKey: TOPIC_B, ids: [second.id] });
    const blocksB = await collectGetTaskBlocks(
      { id: 6, text: '改源码', topicKey: TOPIC_B, projectKey: REPO },
      { topicKey: TOPIC_B, repoKey: REPO },
    );
    const annB = blocksB.blocks.find((b) => b.pluginId === 'dir-annotate');
    assert.ok(annB);
    assert.match(String(annB.data.prompt), /src 注释与 README 同步/);
    assert.doesNotMatch(String(annB.data.prompt), /docs 文档保持最新/);

    const againA = await collectGetTaskBlocks(
      { id: 7, text: '再改 docs', topicKey: TOPIC_A, projectKey: REPO },
      { topicKey: TOPIC_A, repoKey: REPO },
    );
    assert.match(String(againA.blocks.find((b) => b.pluginId === 'dir-annotate').data.prompt), /docs 文档保持最新/);

    // 候选列表按仓库给。
    const found = await listCandidates({ pluginId: 'dir-annotate', repoKey: REPO });
    assert.equal(found.warnings.length, 0);
    assert.equal(found.candidates.length, 2);
    assert.ok(found.candidates.every((c) => c.kind === 'dir-requirement'));
    assert.deepEqual(
      found.candidates.map((c) => c.label).sort(),
      ['docs 文档保持最新', 'src 注释与 README 同步'],
    );

    // 删除条目：主题里残留的陈旧 id 读取时被过滤，不再出区块。
    const removed = await host.callRpc('dir-annotate', 'requirementsRemove', { repoKey: REPO, id: first.id });
    assert.equal(removed.entries.length, 1);
    const staleA = await collectGetTaskBlocks(
      { id: 8, text: 'docs 已删除', topicKey: TOPIC_A, projectKey: REPO },
      { topicKey: TOPIC_A, repoKey: REPO },
    );
    assert.equal(staleA.blocks.filter((b) => b.pluginId === 'dir-annotate').length, 0, '陈旧的启用 id 不生效');
    const stillB = await collectGetTaskBlocks(
      { id: 9, text: 'src 还在', topicKey: TOPIC_B, projectKey: REPO },
      { topicKey: TOPIC_B, repoKey: REPO },
    );
    assert.match(String(stillB.blocks.find((b) => b.pluginId === 'dir-annotate').data.prompt), /src 注释与 README 同步/);

    // 交付：插件区块按 tag 包起来，正文就是插件生成的提示词。
    const { assembleDelivery } = await import('../../src/modules/claim/assemble.ts');
    const out = await assembleDelivery({
      task: { id: 9, text: 'src 还在' },
      attachCtx: null,
      goalCtx: null,
      groupCtx: null,
      queueInfo: null,
      gettaskBlocks: stillB.blocks,
    });
    assert.match(out.instruction, /<nxkv\.plugin\.dir-annotate\.requirements>/, '交付里出现插件区块标签');
    assert.match(out.instruction, /〔目录要求 · demo〕/);
    assert.match(out.instruction, /完成本任务后，必须逐条检查并更新/);
    assert.match(out.instruction, /src 注释与 README 同步/);

    // 草稿预览：task.id=0，靠 taskKey + repoKey 仍能取到插件区块（bug 回归）。
    const { previewTaskDelivery } = await import('../../src/modules/claim/preview.ts');
    const draftPreview = await previewTaskDelivery({
      task: { id: 0, key: 'draft-9', text: '草稿正文', status: 'draft' },
      cwd: s.appDir,
      key: TOPIC_B,
      taskKey: 'draft-9',
      repoKey: REPO,
    });
    assert.match(draftPreview.instruction, /<nxkv\.plugin\.dir-annotate\.requirements>/, '草稿预览包含目录要求区块');
    assert.match(draftPreview.instruction, /src 注释与 README 同步/);

    // 提示词开头 / 结尾来自插件设置页；支持 {{repoName}} / {{entryCount}}。
    await host.callRpc('dir-annotate', 'setSettings', {
      promptHead: '自定义开头 {{repoName}} · {{entryCount}} 条：',
      promptTail: '自定义结尾：交付前逐条确认。',
    });
    const custom = await collectGetTaskBlocks(
      { id: 10, text: '自定义提示词', topicKey: TOPIC_B, projectKey: REPO },
      { topicKey: TOPIC_B, repoKey: REPO },
    );
    const customPrompt = String(custom.blocks.find((b) => b.pluginId === 'dir-annotate').data.prompt);
    assert.match(customPrompt, /^自定义开头 demo · 1 条：/);
    assert.match(customPrompt, /自定义结尾：交付前逐条确认。$/);
  } finally {
    s.reset();
  }
});
