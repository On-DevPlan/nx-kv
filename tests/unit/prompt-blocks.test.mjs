// 系统上下文渲染单元测试（v5 模型：一份共享 ctx + 每区块独立模板列表 + 薄编排）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  BLOCK_DEFS,
  BUILTIN_TEMPLATE_ID,
  defaultBlockTemplateLists,
  normalizeBlockTemplateLists,
  resolveBlockTemplates,
  wrapXmlBlocks,
} = await import('../../src/shared/prompt-blocks.js');
const { composeSystemBlocks } = await import('../../src/modules/tasktool/system-blocks.js');
const { renderInstruction, validateTemplate } = await import('../../src/core/instruction-template.js');

const defOf = (id) => BLOCK_DEFS.find((d) => d.id === id);
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

test('默认每区块列表：5 个区块，各只含系统内置模板，active=builtin', () => {
  assert.deepEqual(
    BLOCK_DEFS.map((d) => d.id),
    ['context', 'attachment', 'timecheck', 'ack', 'getloop'],
    'rule 已并入 ack，不再作为独立区块'
  );
  const lists = defaultBlockTemplateLists();
  for (const def of BLOCK_DEFS) {
    const b = lists[def.id];
    assert.ok(b, `${def.id} 缺省列表缺失`);
    assert.equal(b.active, BUILTIN_TEMPLATE_ID);
    assert.equal(b.list.length, 1, `${def.id} 默认只有内置一条`);
    const builtin = b.list[0];
    assert.equal(builtin.id, BUILTIN_TEMPLATE_ID);
    assert.equal(builtin.builtin, true);
    assert.ok(builtin.template.trim(), `${def.id} 内置模板不能为空`);
  }
  assert.ok(!('presets' in defOf('context')), '区块 def 不再带 per-block 变量域/预设');
  assert.ok(!('vars' in defOf('context')));
});

test('归一化：内置常驻且不可改；用户条目录入但内置内容不被覆盖；无效 active 回落内置', () => {
  const lists = normalizeBlockTemplateLists({
    context: {
      active: 'gone',
      list: [
        { id: BUILTIN_TEMPLATE_ID, name: '想改内置', template: 'hack', builtin: true },
        { id: 'a', name: '我的', template: 'CTX {{task.id}}' },
        { id: 'a', name: '重复', template: 'dup' },
        { id: '', name: '非法', template: 'x' },
      ],
    },
    unknown: { active: 'x', list: [{ id: 'x', template: 'x' }] },
  });
  const b = lists.context;
  assert.equal(b.list[0].id, BUILTIN_TEMPLATE_ID, '内置始终在第一位');
  assert.equal(b.list[0].template, defOf('context').defaultTemplate, '内置内容固定为默认模板');
  assert.equal(b.list[0].builtin, true);
  assert.equal(b.active, BUILTIN_TEMPLATE_ID, 'active 指向不存在的模板 → 回落内置');
  assert.equal(b.list.length, 2, '内置 + 去重后的一个用户条目');
  assert.equal(b.list[1].template, 'CTX {{task.id}}');
  assert.equal(lists.unknown, undefined, '未知区块丢弃');
});

test('resolveBlockTemplates：取每个区块当前生效的那一条', () => {
  let lists = defaultBlockTemplateLists();
  lists = withActive(lists, 'context', '项目 {{repo.name}}');
  lists = withActive(lists, 'ack', 'ACK {{task.id}}');
  const active = resolveBlockTemplates(lists);
  assert.equal(active.context.template, '项目 {{repo.name}}');
  assert.equal(active.context.builtin, false);
  assert.equal(active.ack.template, 'ACK {{task.id}}');
  assert.equal(active.attachment.template, defOf('attachment').defaultTemplate);
  assert.equal(active.attachment.builtin, true);
  // active 被删掉 → 自动回落内置
  const broken = resolveBlockTemplates({ context: { active: 'none', list: [] } });
  assert.equal(broken.context.template, defOf('context').defaultTemplate);
  assert.equal(broken.context.builtin, true);
});

test('共享 ctx：一个对象同时喂给所有区块的各自生效模板，按固定顺序包标签', () => {
  let lists = defaultBlockTemplateLists();
  lists = withActive(lists, 'context', '项目 {{repo.name}} · 组 {{group.name}}');
  lists = withActive(
    lists,
    'attachment',
    '附件 {{attach.count}} 个：{{#each attach.list}}\n- {{name}}: {{localPath}}{{/each}}'
  );
  lists = withActive(lists, 'ack', '完成之后继续 wait（任务 {{task.id}}）');
  const text = composeSystemBlocks([], {
    mode: 'xml',
    templates: resolveBlockTemplates(lists),
    ctx: {
      repo: { name: 'nx-kv' },
      group: { name: 'nx' },
      attach: { count: 1, list: [{ name: 'a.png', localPath: '/tmp/a.png' }] },
      task: { id: 42 },
    },
  });
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
    '输出顺序由区块 def 固定'
  );
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

test('模板渲染失败：该块回落内置模板 + 告警（不静默、不阻断其它块）', () => {
  let lists = defaultBlockTemplateLists();
  lists = withActive(lists, 'context', '正文 {{repo.name}}');
  lists = withActive(lists, 'attachment', '{{#if}}坏模板'); // 语法错误
  const warnings = [];
  const text = composeSystemBlocks([], {
    mode: 'xml',
    templates: resolveBlockTemplates(lists),
    ctx: { repo: { name: 'nx-kv' }, attach: null },
    warnings,
  });
  assert.equal(warnings.length, 1, '必须留下告警');
  assert.equal(warnings[0].block, 'attachment');
  assert.match(warnings[0].message, /Parse error/i);
  assert.match(text, /<nx-kv\.context>\n正文 nx-kv\n<\/nx-kv\.context>/, '好块照常输出');
  assert.doesNotMatch(text, /<nx-kv\.attachment>/, '坏块回落内置后无附件 → 不出现');
});

test('旧语法模板在运行期同样回落内置（保存校验之外的兜底）', () => {
  let lists = defaultBlockTemplateLists();
  lists = withActive(lists, 'ack', '{{#task}}旧闸门{{/task}}');
  const warnings = [];
  const text = composeSystemBlocks([], {
    mode: 'xml',
    templates: resolveBlockTemplates(lists),
    ctx: { task: { id: 7 } },
    warnings,
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].block, 'ack');
  assert.match(warnings[0].message, /已废弃/);
  assert.match(text, /<nx-kv\.ack>[\s\S]*localtask done --id 7/, 'ack 回落内置模板');
});

test('当前模板为空 → 该块不输出；全空 → 空串', () => {
  const lists = defaultBlockTemplateLists();
  const templates = resolveBlockTemplates(lists);
  templates.context = { template: '', builtin: false, id: 'empty', name: '空' };
  templates.attachment = { template: '', builtin: false, id: 'empty', name: '空' };
  templates.timecheck = { template: '', builtin: false, id: 'empty', name: '空' };
  templates.ack = { template: '', builtin: false, id: 'empty', name: '空' };
  templates.getloop = { template: '', builtin: false, id: 'empty', name: '空' };
  assert.equal(composeSystemBlocks([], { mode: 'xml', templates, ctx: {} }), '');
  assert.equal(composeSystemBlocks([], { mode: 'plain', templates, ctx: {} }), '');
});

test('plain 模式：渲染后按空行直拼、不再包标签', () => {
  let lists = defaultBlockTemplateLists();
  lists = withActive(lists, 'context', '组上下文');
  lists = withActive(lists, 'timecheck', 'check 指令');
  lists = withActive(lists, 'ack', 'ack 指令');
  const templates = resolveBlockTemplates(lists);
  const empty = { template: '', builtin: false, id: 'empty', name: '空' };
  templates.attachment = empty;
  const text = composeSystemBlocks([], { mode: 'plain', templates, ctx: {} });
  assert.equal(text, '组上下文\n\ncheck 指令\n\nack 指令', '顺序 = 区块 def 顺序');
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
