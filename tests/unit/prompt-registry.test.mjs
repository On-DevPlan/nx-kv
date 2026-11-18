// prompt.registry —— 注册表外露（#152 重构后）。
//
// 三端同源：CLI / HTTP / 设置页消费同一份 uiDescriptor()。
// #152 起注册表**完全从插件类派生**：没有 JSON 注册表、没有 DB seed、没有顺序数组——
// 段落清单、时机链、链内顺序、模板正文、变量目录全部来自类声明。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NX_KV_LOCALTASK_STORE = join(mkdtempSync(join(tmpdir(), 'nxkv-registry-')), 'localtasks.json');
process.env.NX_KV_DB = join(process.env.NX_KV_LOCALTASK_STORE, '..', 'nxkv.db');

const { PromptRegistryAction } = await import('../../src/modules/promptplug/actions/prompt-registry.js');
const { container } = await import('../../src/runtime/container.js');
const { groupIndex, allPluginIds } = await import('../../src/modules/promptplug/registry.js');

test('prompt.registry：按时机分组、链内按 order 升序、fields 由 schema 派生', async () => {
  const d = await new PromptRegistryAction(container).run({});

  // 三条链都必须有、且合起来正好是全部插件
  assert.deepEqual(Object.keys(d.groups).sort(), ['check', 'done', 'get']);
  assert.deepEqual(d.groups, groupIndex());
  assert.deepEqual(
    d.plugins.map((p) => p.id),
    allPluginIds(),
    'plugins = 按 group 再按 order 的稳定序',
  );

  for (const g of ['get', 'check', 'done']) {
    const chain = d.plugins.filter((p) => p.group === g);
    assert.deepEqual(
      chain.map((p) => p.id),
      d.groups[g],
      `${g} 链的 groups 索引与 plugins 过滤结果必须一致`,
    );
    const orders = chain.map((p) => p.order);
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b), `${g} 链内必须按 order 升序`);
    assert.equal(new Set(orders).size, orders.length, `${g} 链内 order 不允许并列`);
  }

  const context = d.plugins.find((p) => p.id === 'context');
  assert.equal(context.group, 'get');
  assert.equal(context.tag, 'nx-kv.context');
  assert.ok(context.fields.some((f) => f.key === 'repo.name'), 'fields 由 zod schema 派生');
  assert.ok(context.template.includes('{{repo.name}}'), 'template = 类里的内置模板正文');
  assert.deepEqual(
    context.varScope.filter((s) => !['task', 'cwd', 'goal', 'source', 'summary', 'name', 'params'].includes(s)),
    ['repo', 'group', 'refRepos', 'groups'],
    'varScope = seed ∪ 自己的 dataSchema 顶层',
  );
  assert.ok(context.varScope.includes('task'), 'seed 段每段都能用');

  const timecheck = d.plugins.find((p) => p.id === 'timecheck');
  assert.equal(timecheck.group, 'check');
  // goal 本来就是 seed 段（宿主传的），所以它不额外引入任何非 seed 段
  assert.deepEqual(
    timecheck.varScope.filter((s) => !['task', 'cwd', 'goal', 'source', 'summary', 'name', 'params'].includes(s)),
    [],
    '只消费 seed，不暴露别的段',
  );
});

test('registry 的 templates 非空且第一条就是生效正文（#152：正文进代码）', async () => {
  const d = await new PromptRegistryAction(container).run({});
  for (const p of d.plugins) {
    assert.ok(Array.isArray(p.templates) && p.templates.length > 0, `${p.id} 必须提供内置模板列表`);
    assert.equal(p.template, p.templates[0].text, `${p.id}: 生效正文 = templates[0]`);
    assert.ok(p.templates[0].text.trim(), `${p.id}: 内置模板不能为空`);
  }
});

test('promptplug 的 action 面：registry（只读）+ 段模板管理三条（#161）', async () => {
  const { ACTIONS } = await import('../../src/modules/promptplug/actions/_manifest.generated.js');
  const { zodActionsOf } = await import('../../src/runtime/action-decorator.js');
  const ids = ACTIONS.flatMap((C) => zodActionsOf(new C(container))).map((a) => a.id);
  assert.deepEqual(
    [...ids].sort(),
    ['prompt.registry', 'prompt.template.save', 'prompt.template.activate', 'prompt.template.delete'].sort(),
    'promptplug 模块 = 注册表 + 段模板管理（save/activate/delete）',
  );
});
