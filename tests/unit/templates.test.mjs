// 任务模板（templates 模块）单元测试：列表 / 新增 / 设默认 / 删除 / 兜底。
//
// 存储是 templates 表（T06 起进库）：测试用 NX_KV_DB 指到临时库文件，
// 每个用例先关连接再删库文件（Windows 上连接开着 rmSync 必 EBUSY）。
// 在 import 服务模块**之前**设好环境变量（模块读 env 在调用时，但早设无害）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-tpl-test-'));
const dbFile = join(tmp, 'nxkv.db');
process.env.NX_KV_DB = dbFile;
// 凭据文件同样隔离（config 拆分后 preferences 走 settings 表，也在这份库上）
process.env.NX_KV_CONFIG = join(tmp, 'config.json');

const { closeDb } = await import('../../src/core/db/index.js');
const { BUILTIN_ID, listTemplates, addTemplate, removeTemplate, setDefaultTemplate, updateTemplate, reorderTemplates } = await import(
  '../../src/modules/templates/service.js'
);

beforeEach(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      rmSync(dbFile + suffix, { force: true });
    } catch {
      /* Windows 偶发句柄残留：留给下一次 */
    }
  }
});

test.after?.(() => {
  try { closeDb(); } catch { /* 已关 */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

test('空库 → 内置模板不留空（bootstrap seed 一批可选）', async () => {
  const d = await listTemplates();
  assert.equal(d.defaultId, BUILTIN_ID);
  assert.ok(d.templates.length >= 1, '新建任务的内置在列表里');
  assert.ok(d.templates.every((t) => t.builtin), '首次建库列出的应全是内置模板');
  const def = d.templates.find((t) => t.id === BUILTIN_ID);
  assert.equal(def.name, 'ref 生成', '#137：新建任务的内置只剩「ref 生成」');
  assert.ok(def.body.includes('## 本轮问题'), '内置正文是零知识起步的 SOP');
  assert.ok(def.body.includes('docs ref add'), 'SOP 里带着建 ref 的命令');
  // #137：旧的五条内置空骨架下线了
  for (const gone of ['默认模板', '缺陷修复', '功能开发', '调研任务', '文档修订']) {
    assert.ok(!d.templates.some((t) => t.name === gone), `旧内置应已下线：${gone}`);
  }
});

test('新增模板 + 设默认', async () => {
  const before = (await listTemplates()).templates.length;
  const a = await addTemplate({ name: '临时模板', body: '# 临时模板\n\n## 复现步骤' });
  assert.notEqual(a.template.id, BUILTIN_ID);
  let d = await listTemplates();
  assert.equal(d.templates.length, before + 1);
  assert.equal(d.defaultId, BUILTIN_ID, '没给 setDefault 就不该改默认');

  const b = await addTemplate({ name: '周报', body: '# 周报', setDefault: true });
  d = await listTemplates();
  assert.equal(d.defaultId, b.template.id, 'setDefault=true 应把新模板设为默认');
});

test('空正文新增 → 落内置骨架，不存空页', async () => {
  const a = await addTemplate({ name: '空骨架', body: '' });
  assert.ok(a.template.body.includes('## 本轮问题'), '空正文应回退到内置正文（#137：唯一那份 SOP）');
});

test('新增缺名字 → INVALID_INPUT', async () => {
  await assert.rejects(() => addTemplate({ name: '   ', body: 'x' }), /模板名/);
});

test('删除：内置不可删；删自定义默认 → 默认回落内置', async () => {
  const builtinCount = (await listTemplates()).templates.length;
  const b = await addTemplate({ name: '临时', body: '# 临时', setDefault: true });
  await assert.rejects(() => removeTemplate({ id: BUILTIN_ID }), /内置默认模板不可删除/);

  const r = await removeTemplate({ id: b.template.id });
  assert.equal(r.wasDefault, true);
  const d = await listTemplates();
  assert.equal(d.defaultId, BUILTIN_ID, '删掉默认模板后默认应回落到内置');
  assert.equal(d.templates.length, builtinCount, '删掉自定义模板后只剩内置模板');
});

test('删除不存在的模板 → NOT_FOUND', async () => {
  await assert.rejects(() => removeTemplate({ id: 't_nope' }), /没有 id/);
  await assert.rejects(() => setDefaultTemplate({ id: 't_nope' }), /没有 id/);
  await assert.rejects(() => updateTemplate({ id: 't_nope', name: 'x' }), /没有 id/);
});

// T06 起 builtin 的骨架也可编辑（seed 是 INSERT OR IGNORE，用户编辑不被覆盖）——
// 「内置不可改骨架」的旧护栏随 JSON store 一起退役，新的护栏是「不可删」。
test('编辑模板：只改传入字段；builtin 骨架也可改（T06 裁决）', async () => {
  const a = await addTemplate({ name: '旧名', body: '# 旧正文' });
  const u = await updateTemplate({ id: a.template.id, name: '新名' });
  assert.equal(u.template.name, '新名');
  assert.equal(u.template.body, '# 旧正文', '未提供的 body 应保持不变');

  const u2 = await updateTemplate({ id: a.template.id, body: '# 新正文\n\n## 步骤' });
  assert.equal(u2.template.name, '新名', '未提供的 name 应保持不变');
  assert.ok(u2.template.body.includes('## 步骤'));

  // builtin：改名与改骨架现在都放行（下面单独验「重启仍保留」）
  const u3 = await updateTemplate({ id: BUILTIN_ID, name: '我的骨架', body: '# 我的骨架' });
  assert.equal(u3.template.name, '我的骨架');
  assert.equal(u3.template.body, '# 我的骨架');

  await assert.rejects(() => updateTemplate({ id: a.template.id, name: '   ' }), /模板名/);
});

// 模板 = 纯正文骨架，无插槽机制；vars 列只是 DB 兼容位（恒空）。
test('内置模板：出厂正文是纯文字骨架，无 {{content}} 插槽、vars 为空', async () => {
  const builtin = await listTemplates();
  const def = builtin.templates.find((t) => t.id === BUILTIN_ID);
  assert.ok(def, '内置模板在场');
  assert.equal(def.body.includes('{{'), false, '出厂正文不含任何 mustache 标记');
  assert.match(def.body, /## 本轮问题/, '出厂正文 = 零知识 SOP');
  assert.deepEqual(def.values, {}, 'DB vars 兼容位为空对象');

  // 用户模板正文原样存取，不做任何渲染替换
  const t = await addTemplate({ name: '纯正文', body: '# 标题\n\n正文写在这里\n' });
  assert.equal(t.template.body, '# 标题\n\n正文写在这里\n', '正文原样');
});

test('正文可来自文件（--body-file）：多行 Markdown 的实用姿势', async () => {
  const file = join(tmp, 'tpl.md');
  writeFileSync(file, '# 缺陷修复\n\n## 复现步骤\n- 步骤一\n- 步骤二\n', 'utf8');
  const a = await addTemplate({ name: '来自文件', bodyFile: file });
  assert.ok(a.template.body.includes('## 复现步骤'));
  assert.ok(a.template.body.includes('步骤二'));

  // body 优先于文件
  const b = await addTemplate({ name: 'body 优先', body: '# 字面量', bodyFile: file });
  assert.equal(b.template.body, '# 字面量');

  // update 也能从文件改正文
  const u = await updateTemplate({ id: a.template.id, bodyFile: file });
  assert.ok(u.template.body.includes('复现步骤'));

  // 读不到的文件 → 明确报错
  await assert.rejects(() => addTemplate({ name: 'x', bodyFile: join(tmp, 'nope.md') }), /读模板文件失败/);
});

test('设默认 + 落库持久（关连接重开仍在 —— 模拟新进程）', async () => {
  const a = await addTemplate({ name: '持久', body: '# 持久' });
  const s = await setDefaultTemplate({ id: a.template.id });
  assert.equal(s.defaultId, a.template.id);

  // 模拟新进程：关连接再重读（库文件原样）
  closeDb();
  const d = await listTemplates();
  assert.equal(d.defaultId, a.template.id, '重开库默认应保持');
  assert.ok(d.templates.some((t) => t.name === '持久'));
});

test('builtin 的用户编辑在重启后保留（seed 不覆盖用户编辑 —— T06 裁决）', async () => {
  const u = await updateTemplate({ id: BUILTIN_ID, body: '# 用户改过的骨架\n\n自己写的正文' });
  assert.ok(u.template.body.includes('用户改过的骨架'));

  closeDb(); // 模拟重启
  const d = await listTemplates();
  const back = d.templates.find((t) => t.id === BUILTIN_ID);
  assert.ok(back.body.includes('用户改过的骨架'), 'builtin 编辑原样保留');
  assert.equal(back.builtin, true, 'builtin 标记不变（不可删）');
  // 出厂文本没有被 seed 回写
  assert.ok(!back.body.includes('## 本轮问题'));
});

test('builtin 永远在场：内置任务模板只有一个类目（seed 于 bootstrap，#191）', async () => {
  await listTemplates(); // 触发开库 + bootstrap（seed）
  const { openRaw } = await import('../../src/core/db/driver.js');
  const db = openRaw(dbFile, { readOnly: true });
  const rows = db.all('SELECT id, category FROM templates WHERE builtin = 1 ORDER BY category');
  db.close();
  const categories = [...new Set(rows.map((r) => r.category))].sort();
  // #191：任务模板只服务「初始化 task 草稿」——delivery/enhance/context 是提示词段，
  // 走 promptplug 插件的 BUILTIN（独立引擎），不再塞进模板表。
  assert.deepEqual(categories, ['newtask'], '模板表只剩 newtask 内置');
  assert.ok(rows.some((r) => r.id === BUILTIN_ID));
  assert.equal(
    rows.filter((r) => r.category === 'newtask').length,
    1,
    '#137：任务模板内置只留一条「ref 生成」'
  );
});

// ---- 可见域（#128）走 action 层的回归：强转不许把数组压掉 ----
//
// 这条锁的是 runtime/spec.js 的 coerceOne：scope 曾声明成 type:'string'，
// 于是 String([]) === '' ——「把可见域清空」被静默当成「没传」，界面上
// 点「关全局」看着没反应。scope 的值本来就是数组/JSON 串，flag 必须是 raw。
test('action 层：scope 传数组不被强转吞掉（清空可见域要真的写进去）', async () => {
  const { applySpec } = await import('../../src/runtime/spec.js');
  const mod = await import('../../src/modules/templates/index.js');
  const updateAction = mod.default.actions.find((a) => a.id === 'template.update');
  const addAction = mod.default.actions.find((a) => a.id === 'template.add');

  const a = await addAction.run(applySpec(addAction, { name: '域测试', body: '# 域测试' }));
  assert.deepEqual(a.template.scope, [], '新建无 topic/scope 时不默认全局（#131）');
  const ag = await addAction.run(applySpec(addAction, { name: '显式全局', body: '# g', scope: ['*'] }));
  assert.deepEqual(ag.template.scope, ['*'], '显式 --scope * 才全局');

  // 数组形态（HTTP body）：条目与空数组都要原样活到 action 里
  const ctx1 = applySpec(updateAction, { id: a.template.id, scope: ['topic:abc'] });
  assert.deepEqual(ctx1.scope, ['topic:abc'], '数组 scope 不能被 String() 压成串');
  const r1 = await updateAction.run(ctx1);
  assert.deepEqual(r1.template.scope, ['topic:abc']);

  const ctx2 = applySpec(updateAction, { id: a.template.id, scope: [] });
  assert.deepEqual(ctx2.scope, [], '空数组不能变成空串（空串=没传）');
  const r2 = await updateAction.run(ctx2);
  assert.deepEqual(r2.template.scope, [], '清空可见域要真的落库');

  // 字符串形态（CLI）：JSON 数组串与逗号短写都能解析
  const ctx3 = applySpec(updateAction, { id: a.template.id, scope: '["*","topic:abc"]' });
  const r3 = await updateAction.run(ctx3);
  assert.deepEqual(r3.template.scope, ['*', 'topic:abc']);
  const ctx4 = applySpec(updateAction, { id: a.template.id, scope: 'topic:abc,repo:xyz' });
  const r4 = await updateAction.run(ctx4);
  assert.deepEqual(r4.template.scope, ['topic:abc', 'repo:xyz']);
});

// #132：组本身是可见主体——只传 group 也能按域过滤（与 topic/repo 平级）
test('list 可按 group 过滤（项目组是独立可见主体）', async () => {
  const { listTemplatesForTopic, addTemplate } = await import('../../src/modules/templates/service.js');
  const g = await addTemplate({ name: '组专属', body: '# 组', scope: ['group:group/nx'] });
  const other = await addTemplate({ name: '别的组', body: '# 别', scope: ['group:group/other'] });
  const hit = await listTemplatesForTopic({ group: 'group/nx' });
  assert.equal(hit.scoped, true);
  assert.ok(hit.templates.some((t) => t.id === g.template.id), 'group/nx 应看到组专属');
  assert.ok(!hit.templates.some((t) => t.id === other.template.id), '不应看到别的组');
  // 全局模板对任何上下文仍可见
  assert.ok(hit.templates.some((t) => Array.isArray(t.scope) && t.scope.includes('*')));
});

// #151：拖拽排序——只重排传入的 id，未列出的行保持原位（管理页只显示本主题可见模板）
test('reorder：按 ids 重排，未列出的行不被挪到末尾', async () => {
  const a = await addTemplate({ name: '排A', body: '# A' });
  const b = await addTemplate({ name: '排B', body: '# B' });
  const c = await addTemplate({ name: '排C', body: '# C' });
  const ids = [a.template.id, b.template.id, c.template.id];

  // 倒序：C B A
  await reorderTemplates({ ids: [c.template.id, b.template.id, a.template.id] });
  let d = await listTemplates();
  let seen = d.templates.map((t) => t.id).filter((id) => ids.includes(id));
  assert.deepEqual(seen, [c.template.id, b.template.id, a.template.id]);

  // 只传两条（模拟「本主题只看得见两行」）：第三条 c 必须留在原位
  await reorderTemplates({ ids: [a.template.id, b.template.id] });
  d = await listTemplates();
  seen = d.templates.map((t) => t.id).filter((id) => ids.includes(id));
  assert.equal(seen[0], c.template.id, 'c 原本最靠前，没被列出就不该被挤到末尾');
  assert.deepEqual(seen.slice(1), [a.template.id, b.template.id]);

  await assert.rejects(() => reorderTemplates({ ids: ['t_不存在'] }), /没有 id/);
  await assert.rejects(() => reorderTemplates({ ids: [] }), /需要 ids/);
});
