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
const { BUILTIN_ID, listTemplates, addTemplate, removeTemplate, setDefaultTemplate, updateTemplate } = await import(
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
  assert.ok(d.templates.length >= 5, '内置模板应有一批可直接选，而不是只留一个空壳');
  assert.ok(d.templates.every((t) => t.builtin), '首次建库列出的应全是内置模板');
  const def = d.templates.find((t) => t.id === BUILTIN_ID);
  assert.ok(def.body.includes('## 背景'), '内置正文应带骨架');
  assert.equal(def.values['背景'], '（一句话说清要改什么）', '槽位有默认文字');
  assert.ok(d.templates.some((t) => t.name === '缺陷修复'), '应内置缺陷修复模板');
  assert.ok(d.templates.some((t) => t.name === '功能开发'), '应内置功能开发模板');
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
  assert.ok(a.template.body.includes('## 验收'), '空正文应回退到内置骨架');
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

// 槽位（values）：出厂正文已是**文字**（任务 #87：「直接文字就是模板」），
// values 只服务老模板（正文里还留着 {{槽位}} 的那些）。
test('模板正文：出厂是文字；老模板的槽位值仍跟自己存', async () => {
  const builtin = await listTemplates();
  const def = builtin.templates.find((t) => t.id === BUILTIN_ID);
  assert.ok(def, '内置模板在场');
  assert.equal(def.body.includes('{{'), false, '内置正文是文字，不含槽位标记');
  assert.match(def.body, /一句话说清要改什么/, '默认提示语直接写进正文');
  assert.equal(def.values['背景'], '（一句话说清要改什么）', '出厂槽位值仍在（兼容老模板）');

  const upd = await updateTemplate({ id: BUILTIN_ID, values: { 背景: '本轮要做的事' } });
  assert.equal(upd.template.values['背景'], '本轮要做的事');
  assert.equal(upd.template.values['验收'], '…', '没给的槽位保留默认文字');
  assert.equal(upd.template.body, def.body, '只给 values 时不改正文');

  // 用户模板：槽位值跟着自己的模板存
  const t = await addTemplate({ name: '带槽位', body: '# 标题\n\n{{目标}}\n' });
  const t2 = await updateTemplate({ id: t.template.id, values: { 目标: '把事做完' } });
  assert.equal(t2.template.values['目标'], '把事做完');
  assert.equal(t2.template.body, '# 标题\n\n{{目标}}\n', '正文不动');
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
  const u = await updateTemplate({ id: BUILTIN_ID, body: '# 用户改过的骨架\n\n{{目标}}' });
  assert.ok(u.template.body.includes('用户改过的骨架'));

  closeDb(); // 模拟重启
  const d = await listTemplates();
  const back = d.templates.find((t) => t.id === BUILTIN_ID);
  assert.ok(back.body.includes('用户改过的骨架'), 'builtin 编辑原样保留');
  assert.equal(back.builtin, true, 'builtin 标记不变（不可删）');
  // 出厂文本没有被 seed 回写
  assert.ok(!back.body.includes('## 背景'));
});

test('builtin 永远在场：四个类目的内置都在（seed 于 bootstrap）', async () => {
  await listTemplates(); // 触发开库 + bootstrap（seed）
  const { openRaw } = await import('../../src/core/db/driver.js');
  const db = openRaw(dbFile, { readOnly: true });
  const rows = db.all('SELECT id, category FROM templates WHERE builtin = 1 ORDER BY category');
  db.close();
  const categories = [...new Set(rows.map((r) => r.category))].sort();
  assert.deepEqual(categories, ['context', 'delivery', 'enhance', 'newtask'], '四个 tab 的内置模板都在');
  assert.ok(rows.some((r) => r.id === BUILTIN_ID));
  assert.ok(
    rows.filter((r) => r.category === 'newtask').length >= 5,
    '任务模板内置一批可选骨架，不是单一空壳'
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
  const updateAction = mod.default.actions.find((a) => a.id === 'templates.update');
  const addAction = mod.default.actions.find((a) => a.id === 'templates.add');

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
