// 系统上下文渲染单元测试（#152 后：模板正文在插件类里，正文覆盖只经 overrides）。
//
// 覆盖的是**渲染链**本身：共享 ctx / 链内顺序 / 空段省略 / 追加模式 / XML 包裹。
// 「模板从哪来」不再是本文件的主题——那是 prompt-registry.test.mjs 的事。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { wrapXmlBlocks } = await import('../../src/shared/prompt-blocks.js');
const { compose } = await import('../../src/modules/promptplug/compose.js');
const { buildPlugins, templatesOf, PLUGIN_IDS } = await import('../../src/modules/promptplug/index.js');
const { assertPluginList } = await import('../../src/shared/prompt-plugin.js');
const { renderInstruction, validateTemplate } = await import('../../src/core/instruction-template.js');
const { attachTemplateCtx } = await import('../../src/modules/tasktool/attach.js');

/** 附件 ctx 走真实变换（schema 严格到 kind 级别，手写简化对象已不合法）。 */
const attachOf = (rows) => attachTemplateCtx(rows).attach;

/** 某插件的出厂正文（= 类里 templates[0].text）。 */
const builtinTpl = (id) => templatesOf(id)[0].text;

/**
 * 与 wait.ts 同构的组装：get 链 + 宿主取数 + 正文覆盖（overrides）。
 * 覆盖正文是预览/测试的唯一入口（正常流程永远走类里的内置模板）。
 */
const makeCompose = (overrides = {}, deps = {}, seed = {}) => {
  const plugins = buildPlugins(
    'get',
    {
      groupCtx: deps.groupCtx ?? null,
      attach: deps.attach ?? null,
      queueInfo: deps.queueInfo ?? null,
      loopText: deps.loopText ?? '',
      waitMinutes: deps.waitMinutes ?? 0,
    },
    overrides,
  );
  return compose({ plugins, group: 'get', seed, mode: deps.mode ?? 'xml' });
};

test('get 链：五个段（context / attachment / ext / ack / getloop），链内按 order 升序', () => {
  const ids = buildPlugins('get').map((p) => p.id);
  assert.deepEqual(ids, ['context', 'attachment', 'ext', 'ack', 'getloop']);
  for (const id of ids) {
    assert.ok(builtinTpl(id).trim(), `${id} 的内置模板不能为空`);
  }
  // check / done 是另外两条链，不混进来
  assert.deepEqual(buildPlugins('check').map((p) => p.id), ['timecheck', 'goalhint']);
  assert.deepEqual(buildPlugins('done').map((p) => p.id), ['doneguard']);
  assert.equal(new Set(PLUGIN_IDS).size, PLUGIN_IDS.length, '插件 id 全局唯一');
});

test('共享 ctx：一个对象同时喂给链上所有段的模板，按 order 包标签', async () => {
  const text = await makeCompose(
    {
      context: '项目 {{repo.name}} · 组 {{group.name}}',
      attachment: '附件 {{attach.count}} 个：{{#each attach.list}}\n- {{name}}: {{localPath}}{{/each}}',
      ack: '完成之后继续 wait（任务 {{task.id}}）',
    },
    {
      groupCtx: { repo: { name: 'nx-kv' }, groups: [{ name: 'nx', desc: '组定位' }] },
      attach: attachOf([
        { id: 'att-1', kind: 'file', name: 'a.png', localPath: '/tmp/a.png', exists: true, role: 'inline' },
      ]),
    },
    { task: { id: 42 } },
  );
  assert.match(text, /^<nx-kv>\n/);
  assert.match(text, /\n<\/nx-kv>$/);
  assert.match(text, /<nx-kv\.context>\n项目 nx-kv · 组 nx\n<\/nx-kv\.context>/);
  assert.match(text, /<nx-kv\.attachment>\n附件 1 个：\n- a\.png: \/tmp\/a\.png\n<\/nx-kv\.attachment>/);
  assert.match(text, /<nx-kv\.ack>\n完成之后继续 wait（任务 42）\n<\/nx-kv\.ack>/);
  assert.ok(
    text.indexOf('nx-kv.context') < text.indexOf('nx-kv.attachment'),
    '输出顺序由插件 order 固定',
  );
});

test('ext 默认模板：列同主题余量与标题并给优先级；空队列整段省略', async () => {
  const tpl = builtinTpl('ext');
  const withQueue = renderInstruction(tpl, {
    ext: { topic: 'nx-kv', count: 2, list: [{ id: 65, title: '第一条' }, { id: 66, title: '第二条' }] },
    task: { id: 64 },
  });
  assert.match(withQueue, /本队列（nx-kv）还有 2 条待领取任务/);
  assert.match(withQueue, /- #65 第一条/);
  assert.match(withQueue, /- #66 第二条/);
  assert.match(withQueue, /先完成当前任务，再领取下一条/);
  for (const queueInfo of [null, { topic: 'nx-kv', count: 0, list: [] }]) {
    const text = await makeCompose({}, { queueInfo }, { task: { id: 64 } });
    assert.doesNotMatch(text, /nx-kv\.ext/, '空队列不输出 ext 区块');
  }
});

test('旧语法已废弃：保存校验拒绝，运行期不被当作条件/占位符生效', () => {
  const bad = [
    '{{#repo}}项目 {{repo.name}}{{/repo}}',
    '{{#group}}组{{/group}}',
    '{{#attachSync}}同步{{/attachSync}}',
    '{{group.peers}}',
    '{{repo.docs}}',
    '{{attach.list}}',
    '{{attach.sync}}',
    '{{block.content}}',
  ];
  for (const tpl of bad) {
    const r = validateTemplate(tpl);
    assert.equal(r.ok, false, `${tpl} 必须被拒绝`);
    assert.match(r.error, /已废弃/, `${tpl} 错误信息要说明废弃`);
  }
  assert.throws(
    () => renderInstruction('{{#repo}}x{{/repo}}', { repo: { name: 'nx' } }),
    /已废弃/,
    '运行期也不能让旧闸门按旧语义生效',
  );
});

test('坏模板：运行期不回落——compose 直接抛错（没有「渲染失败就用内置」这层兜底）', async () => {
  await assert.rejects(
    () => makeCompose({ attachment: '{{#if}}坏模板' }, {}, { task: { id: 1 } }),
    /Parse error/i,
    '坏模板在渲染时抛出',
  );
});

test('空模板：启动期校验就拦下（空段 = 配置错误，不静默消失）', () => {
  const stub = {
    id: 'stub',
    order: 1,
    group: 'get',
    tag: 'nx-kv.stub',
    label: '占位',
    templates: [{ id: 'builtin', name: '内置', text: '' }],
    writes: [],
    schema: { fields: [], blank: {} },
    get: () => '',
  };
  assert.throws(() => assertPluginList([stub]), /模板不能为空/);
});

test('plain 模式：渲染后按空行直拼、不再包标签', async () => {
  const text = await makeCompose({ context: '组上下文', ack: 'ack 指令' }, { mode: 'plain' }, {});
  assert.equal(text, '组上下文\n\nack 指令', '顺序 = 插件 order 顺序');
  assert.doesNotMatch(text, /<nx-kv/);
});

test('wrapXmlBlocks：无段落 / 空文本都不产出空根标签', () => {
  assert.equal(wrapXmlBlocks([]), '');
  assert.equal(wrapXmlBlocks([{ tag: 'nx-kv.ack', text: '   ' }]), '');
  assert.equal(
    wrapXmlBlocks([{ tag: 'nx-kv.ack', text: 'x' }]),
    '<nx-kv>\n<nx-kv.ack>\nx\n</nx-kv.ack>\n</nx-kv>',
  );
});
