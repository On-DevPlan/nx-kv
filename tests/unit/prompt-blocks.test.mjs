// 系统上下文渲染单元测试（S3 纯校验后：normalize 不合成不补齐；模板真相在出厂快照）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  PROMPT_BLOCK_IDS,
  BUILTIN_TEMPLATE_ID,
  normalizeBlockTemplateLists,
  resolveBlockTemplates,
  wrapXmlBlocks,
} = await import('../../src/shared/prompt-blocks.js');
const { templateBundle } = await import('../../src/modules/promptplug/template-bundle.js');
const { compose } = await import('../../src/modules/promptplug/compose.js');
const { buildDeliveryPlugins } = await import('../../src/modules/promptplug/index.js');
const { renderInstruction, validateTemplate } = await import('../../src/core/instruction-template.js');

/** 出厂快照 = 默认每区块列表（active=builtin，只含内置一条）。 */
const defaultLists = () => JSON.parse(JSON.stringify(templateBundle()));
const builtinTpl = (id) => templateBundle()[id].list[0].template;

const withActive = (lists, blockId, template, id = 'custom', name = '自定义') => {
  const next = JSON.parse(JSON.stringify(lists));
  next[blockId] = {
    active: id,
    list: [
      next[blockId].list.find((t) => t.id === BUILTIN_TEMPLATE_ID),
      { id, name, template, builtin: false },
    ],
  };
  return next;
};

/** 与 wait.ts 同构的插件组装：resolved 模板 + 宿主取数结果。 */
const makeCompose = (lists, deps = {}, seed = {}) => {
  const plugins = buildDeliveryPlugins(resolveBlockTemplates(lists), {
    groupCtx: deps.groupCtx ?? null,
    attach: deps.attach ?? null,
    queueInfo: deps.queueInfo ?? null,
    loopText: deps.loopText ?? '',
    waitMinutes: deps.waitMinutes ?? 0,
  });
  return compose({ plugins, seed, mode: deps.mode ?? 'xml' });
};

test('出厂快照：8 个区块，各只含系统内置模板，active=builtin，模板非空', () => {
  assert.deepEqual(
    [...PROMPT_BLOCK_IDS],
    ['context', 'attachment', 'timecheck', 'goalhint', 'doneguard', 'ext', 'ack', 'getloop'],
    'rule 已并入 ack，不再作为独立区块；goalhint 是 #87 / doneguard 是 #90 新增的 timegoal 段'
  );
  const lists = defaultLists();
  for (const id of PROMPT_BLOCK_IDS) {
    const b = lists[id];
    assert.ok(b, `${id} 缺省列表缺失`);
    assert.equal(b.active, BUILTIN_TEMPLATE_ID);
    assert.equal(b.list.length, 1, `${id} 默认只有内置一条`);
    const builtin = b.list[0];
    assert.equal(builtin.id, BUILTIN_TEMPLATE_ID);
    assert.equal(builtin.builtin, true);
    assert.ok(builtin.template.trim(), `${id} 内置模板不能为空`);
  }
});

test('normalize 纯校验：缺段 / 缺 builtin / 重复 id / 超限都抛；active 回落内置；未知区块忽略', () => {
  const base = defaultLists();
  // 合法输入 + active 指空 → 回落内置（唯一的自愈回落）
  const ok = normalizeBlockTemplateLists(
    withActive(base, 'context', 'CTX {{task.id}}', 'a', '我的'),
  );
  assert.equal(ok.context.active, 'a');
  assert.equal(ok.context.list.length, 2);
  const broken = normalizeBlockTemplateLists(
    withActive(base, 'context', 'CTX {{task.id}}', 'a', '我的'),
  );
  broken.context.active = 'gone';
  const healed = normalizeBlockTemplateLists(broken);
  assert.equal(healed.context.active, BUILTIN_TEMPLATE_ID, 'active 指向不存在的模板 → 回落内置');

  const missingBlock = JSON.parse(JSON.stringify(base));
  delete missingBlock.ext;
  assert.throws(() => normalizeBlockTemplateLists(missingBlock), /缺区块/, '缺段即抛（不补齐）');

  const noBuiltin = JSON.parse(JSON.stringify(base));
  noBuiltin.ack.list = noBuiltin.ack.list.filter((t) => t.id !== BUILTIN_TEMPLATE_ID);
  assert.throws(() => normalizeBlockTemplateLists(noBuiltin), /缺内置条目/, 'builtin 不可删');

  const dup = withActive(base, 'ack', 'x', 'a');
  dup.ack.list.push({ id: 'a', name: '重复', template: 'dup', builtin: false });
  assert.throws(() => normalizeBlockTemplateLists(dup), /id 重复/, '用户条目重复抛');

  // 未知区块键忽略（历史 rule 数据不抛）
  assert.doesNotThrow(() =>
    normalizeBlockTemplateLists({ ...base, rule: { active: 'x', list: [{ id: 'x', template: 'x' }] } }),
  '未知区块键忽略');
});

test('resolveBlockTemplates：取每个区块当前生效的那一条', () => {
  let lists = defaultLists();
  lists = withActive(lists, 'context', '项目 {{repo.name}}');
  lists = withActive(lists, 'ack', 'ACK {{task.id}}');
  const active = resolveBlockTemplates(lists);
  assert.equal(active.context.template, '项目 {{repo.name}}');
  assert.equal(active.context.builtin, false);
  assert.equal(active.ack.template, 'ACK {{task.id}}');
  assert.equal(active.attachment.template, builtinTpl('attachment'));
  assert.equal(active.attachment.builtin, true);
});

test('共享 ctx：一个对象同时喂给所有区块的各自生效模板，按插件顺序包标签', async () => {
  let lists = defaultLists();
  lists = withActive(lists, 'context', '项目 {{repo.name}} · 组 {{group.name}}');
  lists = withActive(
    lists,
    'attachment',
    '附件 {{attach.count}} 个：{{#each attach.list}}\n- {{name}}: {{localPath}}{{/each}}'
  );
  lists = withActive(lists, 'ack', '完成之后继续 wait（任务 {{task.id}}）');
  const text = await makeCompose(lists, {
    groupCtx: { repo: { name: 'nx-kv' }, groups: [{ name: 'nx', desc: '组定位' }] },
    attach: { count: 1, list: [{ name: 'a.png', localPath: '/tmp/a.png' }] },
  }, { task: { id: 42 } });
  assert.match(text, /^<nx-kv>\n/);
  assert.match(text, /\n<\/nx-kv>$/);
  assert.match(text, /<nx-kv\.context>\n项目 nx-kv · 组 nx\n<\/nx-kv\.context>/);
  assert.match(
    text,
    /<nx-kv\.attachment>\n附件 1 个：\n- a\.png: \/tmp\/a\.png\n<\/nx-kv\.attachment>/
  );
  assert.match(text, /<nx-kv\.ack>\n完成之后继续 wait（任务 42）\n<\/nx-kv\.ack>/);
  assert.ok(
    text.indexOf('nx-kv.context') < text.indexOf('nx-kv.attachment'),
    '输出顺序由插件 order 固定'
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
    const text = await makeCompose(defaultLists(), { queueInfo }, { task: { id: 64 } });
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
    '运行期也不能让旧闸门按旧语义生效'
  );
});

test('坏模板：运行期不回落——compose 直接抛错（保存期校验是唯一防线，S1 起运行期一条直线）', async () => {
  let lists = defaultLists();
  lists = withActive(lists, 'attachment', '{{#if}}坏模板'); // 语法错误
  await assert.rejects(
    () => makeCompose(lists, {}, { task: { id: 1 } }),
    /Parse error/i,
    '坏模板在渲染时抛出，不再回落内置'
  );
});

test('空模板：构造插件清单即被启动期校验拦下（空段 = 配置错误，不静默消失）', async () => {
  const templates = resolveBlockTemplates(defaultLists());
  templates.ack = { template: '', builtin: false, id: 'empty', name: '空' };
  const plugins = buildDeliveryPlugins(templates, {
    groupCtx: null, attach: null, queueInfo: null, loopText: '', waitMinutes: 0,
  });
  await assert.rejects(
    () => compose({ plugins, seed: {}, mode: 'xml' }),
    /模板不能为空/,
    '空模板在 assertPluginList 抛出'
  );
});

test('plain 模式：渲染后按空行直拼、不再包标签', async () => {
  let lists = defaultLists();
  lists = withActive(lists, 'context', '组上下文');
  lists = withActive(lists, 'timecheck', 'check 指令');
  lists = withActive(lists, 'ack', 'ack 指令');
  const text = await makeCompose(lists, { mode: 'plain' }, {});
  assert.equal(text, '组上下文\n\ncheck 指令\n\nack 指令', '顺序 = 插件 order 顺序');
  assert.doesNotMatch(text, /<nx-kv/);
});

test('wrapXmlBlocks：无段落 / 空文本都不产出空根标签', () => {
  assert.equal(wrapXmlBlocks([]), '');
  assert.equal(wrapXmlBlocks([{ tag: 'nx-kv.ack', text: '   ' }]), '');
  assert.equal(
    wrapXmlBlocks([{ tag: 'nx-kv.ack', text: 'x' }]),
    '<nx-kv>\n<nx-kv.ack>\nx\n</nx-kv.ack>\n</nx-kv>'
  );
});
