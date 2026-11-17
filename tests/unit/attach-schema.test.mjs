// attachment 插件的 schema 契约（#152 补全）：**schema 必须与 ctxItemOf 的真实形状一致**。
//
// 为什么值得单独一个测试文件：
//   - 这段 schema 是变量目录（`GET /api/prompt/registry` 的 fields）的唯一来源。
//     曾经写成 `z.array(z.looseObject({}))` —— 校验形同虚设、目录里一个附件字段都没有，
//     模板作者只能靠翻源码猜 `{{file.localPath}}` 存不存在。
//   - 附件有 6 种 kind，形状各不相同（file / url / task / ref / mdfile / folder）。
//     这里逐个 kind 拿**真实变换产物**（attachTemplateCtx）去校验，顺带钉住「kind 决定形状」：
//     未知 kind、kind 与字段不自洽都必须报错，而不是被宽松对象吞掉。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { attachTemplateCtx } = await import('../../src/modules/tasktool/attach.js');
const { buildPlugins, fieldCatalogOf, globalTemplateVarScope } = await import(
  '../../src/modules/promptplug/index.js'
);
const { undeclaredTemplateVars } = await import('../../src/shared/prompt-plugin.js');

/** 六种 kind 各一条（形状取自真实调用方：attach --file / --url / 任务引用 / 文档绑定 / mdfile / folder）。 */
const ROWS = [
  { id: 'f1', kind: 'file', name: '报告.pdf', localPath: 'D:/att/报告.pdf', exists: true, size: 1024, mime: 'application/pdf', role: 'attach' },
  { id: 'u1', kind: 'url', name: '设计稿', url: 'https://example.com/a', role: 'attach' },
  {
    id: 't1', kind: 'task', name: '#82 修复附件命名', role: 'attach',
    taskId: 82, topicKey: 'nx-kv', seq: 82, title: '修复附件命名', status: 'done',
    address: 'nx-kv:82', showCmd: 'nx-kv localtask show --id 82 --key nx-kv',
  },
  {
    id: 'r1', kind: 'ref', name: '附件规范', role: 'attach',
    refId: 'ref_1', title: '附件规范', desc: '附件与文档的约定',
    readCmd: 'nx-kv docs get --ref ref_1', docContent: '正文', docTruncated: false,
  },
  { id: 'm1', kind: 'mdfile', name: 'plan.md', role: 'attach', absPath: 'D:/x/plan.md', anchorDir: 'D:/x', mdContent: '# 计划', mdTruncated: false, mdStale: false },
  { id: 'd1', kind: 'folder', name: 'assets', role: 'attach', absPath: 'D:/x/assets', exists: true, missing: false },
];

/** 用 attachment 插件（get 链第二段）跑一次结构态校验。 */
const pluginOf = (attach) => buildPlugins('get', { attach })[1];

test('六种 kind 的真实 ctx 都能过 schema（shape 与 ctxItemOf 逐字段对齐）', async () => {
  const { attach } = attachTemplateCtx(ROWS);
  assert.equal(attach.list.length, 6);
  assert.deepEqual(
    attach.list.map((a) => a.kind),
    ['file', 'url', 'task', 'ref', 'mdfile', 'folder'],
  );
  const data = await pluginOf(attach).get('data');
  assert.equal(data.attach.list.length, 6);
  // 各 kind 的子对象必须在（模板靠 {{#if x}} 分支）
  assert.ok(data.attach.list[0].file.localPath, 'file 子对象');
  assert.equal(data.attach.list[1].url.host, 'example.com', 'url 子对象');
  assert.equal(data.attach.list[2].task.showCmd, 'nx-kv localtask show --id 82 --key nx-kv', 'task 子对象');
  assert.equal(data.attach.list[3].ref.refId, 'ref_1', 'ref 子对象');
  assert.equal(data.attach.list[4].mdfile.readCmd, 'nx-kv docs mdfile m1', 'mdfile 子对象（含取用命令）');
  assert.equal(data.attach.list[5].folder.readCmd, 'nx-kv file content d1', 'folder 子对象（含取用命令）');
});

test('每个 kind 单独也要过（避免「混在一起才碰巧合法」）', async () => {
  for (const row of ROWS) {
    const { attach } = attachTemplateCtx([row]);
    assert.equal(attach.list.length, 1);
    const data = await pluginOf(attach).get('data');
    assert.equal(data.attach.list[0].kind, row.kind);
    assert.equal(data.attach.count, 1);
    // 夹具都是 role='attach'（附件区）；正文内嵌看 role=inline
    assert.equal(data.attach.areaCount, 1);
    assert.equal(data.attach.inlineCount, 0);
  }
});

test('无附件 → attach 为 null（整段不输出，不是空清单）', async () => {
  const data = await pluginOf(null).get('data');
  assert.equal(data.attach, null);
});

test('kind 与形状不自洽必须报错（宽松对象吞掉脏数据的时代结束了）', async () => {
  const base = attachTemplateCtx(ROWS.slice(1, 2)).attach; // 只有一条 url
  const cases = [
    ['未知 kind', { ...base, list: [{ ...base.list[0], kind: 'ghost' }] }, /Invalid discriminator value.*file/],
    ['kind=file 但缺 file 子对象', { ...base, list: [{ ...base.list[0], kind: 'file' }] }, /list\.0\.(localPath|fileId)/],
    ['list 不是数组', { ...base, list: 'x' }, /list\.\d*.*expected array|attach\.list.*expected array/],
    ['count 写错类型', { ...base, count: '1' }, /count.*expected number/],
  ];
  for (const [name, attach, re] of cases) {
    await assert.rejects(() => pluginOf(attach).get('data'), re, `${name} 必须被拒`);
  }
});

test('变量目录：6 种 kind 的关键字段都在（这是设置页「可使用变量」的全部来源）', () => {
  // fieldCatalogOf 给的是键名数组（FieldDecl 在注册表的 schema.fields 里）
  const { fields } = fieldCatalogOf('attachment');
  const keys = new Set(fields);
  const need = [
    // 公共清单字段
    'attach.count', 'attach.inlineCount', 'attach.areaCount', 'attach.hasInline', 'attach.hasArea',
    'attach.list', 'attach.list[].kind', 'attach.list[].kindLabel', 'attach.list[].name',
    'attach.list[].sizeText', 'attach.list[].originLabel', 'attach.list[].usage', 'attach.list[].note',
    // 各 kind 的取用方式 / 子对象
    'attach.list[].file.localPath', 'attach.list[].file.exists',
    'attach.list[].url.href', 'attach.list[].url.host',
    'attach.list[].task.showCmd', 'attach.list[].task.statusLabel', 'attach.list[].task.address',
    'attach.list[].ref.readCmd', 'attach.list[].ref.content', 'attach.list[].refId',
    'attach.list[].mdfile.readCmd', 'attach.list[].mdfile.absPath', 'attach.list[].mdfile.content',
    'attach.list[].folder.readCmd', 'attach.list[].folder.absPath', 'attach.list[].folder.missing',
  ];
  const missing = need.filter((k) => !keys.has(k));
  assert.deepEqual(missing, [], '目录里缺这些附件变量（模板作者会以为不能写）');
  assert.ok(fields.length >= 90, `附件字段数量级不对：${fields.length}`);
});

test('目录的 [] 记法 ↔ 模板实写：each 内部用相对路径不被误判为未声明', () => {
  const { allowedSegments, fieldKeys } = globalTemplateVarScope();
  const tpl = [
    '{{#each attach.list}}',
    '- {{kindLabel}} {{name}}',
    '{{#if file}}{{file.localPath}}{{/if}}',
    '{{#if url}}{{url.href}}{{/if}}',
    '{{#if task}}{{task.showCmd}}{{/if}}',
    '{{#if ref}}{{ref.readCmd}}{{/if}}',
    '{{#if mdfile}}{{mdfile.readCmd}}{{/if}}',
    '{{#if folder}}{{folder.readCmd}}{{/if}}',
    '{{/each}}',
  ].join('\n');
  assert.deepEqual(undeclaredTemplateVars(tpl, allowedSegments, fieldKeys), []);

  // each 目标本身必须在目录里，否则是拼错段名
  assert.deepEqual(
    undeclaredTemplateVars('{{#each attach.ilst}}{{name}}{{/each}}', allowedSegments, fieldKeys),
    ['attach.ilst'],
  );
});
