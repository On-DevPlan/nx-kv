// 出厂模板快照与首启落库（S2/S3，方案 §2/§3/§4）+ 写路径校验（§4.2）。
//
// v6 起模板正文不进 shared 常量——唯一真相是出厂快照（blockTemplates.json）。
// 历史上「常量 ≡ JSON ≡ DB」三角对账改为「运行期常量 ≡ 快照」：三个仍被
// 运行期消费的缺省文本（ack / attachment 内置渲染、getloop 内文）各自归属
// 其消费方文件，这里逐字钉住与快照一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NX_KV_LOCALTASK_STORE = join(mkdtempSync(join(tmpdir(), 'nxkv-ensure-')), 'localtasks.json');
process.env.NX_KV_DB = join(process.env.NX_KV_LOCALTASK_STORE, '..', 'nxkv.db');

const {
  BUILTIN_TEMPLATE_ID,
  BUILTIN_TEMPLATE_NAME,
  PROMPT_BLOCK_IDS,
} = await import('../../src/shared/prompt-blocks.js');
const { templateBundle, BUNDLE_VERSION } = await import('../../src/modules/promptplug/template-bundle.js');
const { ensurePromptTemplates } = await import('../../src/modules/promptplug/ensure.js');
const { LT_PROMPT_TEMPLATES_VERSION, LT_BLOCK_TEMPLATES } = await import('../../src/modules/promptplug/keys.js');
const { readSettingRaw, writeSettingRaw } = await import('../../src/core/db/settings.js');
const { resetLocaltaskStore, db } = await import('../../src/modules/localtask/repo/open.js');
const { closeDb } = await import('../../src/core/db/index.js');
const { getLtSettings, setLtSettings } = await import('../../src/modules/localtask/repo/settings.js');
const { DEFAULT_ACK_PROMPT } = await import('../../src/modules/localtask/task-templates.js');
const { DEFAULT_ATTACH_TEMPLATE } = await import('../../src/modules/tasktool/attach-template.js');
const { DEFAULT_GETLOOP_INSTRUCTION } = await import('../../src/modules/tasktool/plugins/waitgoal-config.js');

const builtinTpl = (id) => templateBundle()[id].list[0].template;

test('快照对账：运行期缺省文本 ≡ 出厂快照（ack / attachment / getloop 内文）', () => {
  assert.equal(DEFAULT_ACK_PROMPT, builtinTpl('ack'),
    'task-templates 的缺省 ack ≡ 快照 ack 内置——改哪份都要同步另一份');
  assert.equal(DEFAULT_ATTACH_TEMPLATE, builtinTpl('attachment'),
    'attach-template 的内置渲染模板 ≡ 快照 attachment 内置');
  assert.ok(builtinTpl('getloop').includes(DEFAULT_GETLOOP_INSTRUCTION),
    'waitgoal 注入的内文是快照 getloop 内置模板的内文');
});

test('首启落库：8 段齐、版本键写入；重启零写', () => {
  resetLocaltaskStore();
  const conn = db();
  const s = getLtSettings();
  assert.deepEqual(s.blockTemplates, templateBundle(), '首启后 DB 行 ≡ 出厂快照');
  assert.equal(readSettingRaw(conn, LT_PROMPT_TEMPLATES_VERSION), BUNDLE_VERSION);
  // 重启（关连接再开）→ ensure 已最新 → 不写
  const before = readSettingRaw(conn, LT_BLOCK_TEMPLATES);
  closeDb();
  const conn2 = db();
  assert.equal(ensurePromptTemplates(conn2), false, '版本相同 → 零写');
  assert.deepEqual(readSettingRaw(conn2, LT_BLOCK_TEMPLATES), before);
});

test('升级只刷 builtin 文本：用户条目 / active / 顺序一律不动', () => {
  resetLocaltaskStore();
  const conn = db();
  // 模拟旧版本库：builtin 是旧文本 + 一个用户条目且 active 指向它 + 版本键归 0
  const lists = JSON.parse(JSON.stringify(readSettingRaw(conn, LT_BLOCK_TEMPLATES)));
  lists.context.list[0].template = '旧版内置文本 {{repo.name}}';
  lists.context.list.push({ id: 'mine', name: '我的', template: '自定义 {{task.id}}', builtin: false });
  lists.context.active = 'mine';
  writeSettingRaw(conn, LT_BLOCK_TEMPLATES, lists);
  writeSettingRaw(conn, LT_PROMPT_TEMPLATES_VERSION, 0);

  ensurePromptTemplates(conn);

  const after = readSettingRaw(conn, LT_BLOCK_TEMPLATES);
  assert.equal(after.context.list[0].template, builtinTpl('context'),
    'builtin 文本被刷成出厂快照');
  assert.equal(after.context.list.find((x) => x.id === 'mine').template, '自定义 {{task.id}}',
    '用户条目原样保留');
  assert.equal(after.context.active, 'mine', 'active 不被升级覆盖');
  assert.equal(readSettingRaw(conn, LT_PROMPT_TEMPLATES_VERSION), BUNDLE_VERSION);
  for (const id of PROMPT_BLOCK_IDS) {
    assert.equal(after[id].list[0].template, builtinTpl(id),
      `${id} 的 builtin 也同步刷新`);
  }
});

test('存量自愈：active 指向空模板条目 → 修回 builtin', () => {
  resetLocaltaskStore();
  const conn = db();
  const lists = JSON.parse(JSON.stringify(readSettingRaw(conn, LT_BLOCK_TEMPLATES)));
  lists.ack.list.push({ id: 'blank', name: '被清空', template: '', builtin: false });
  lists.ack.active = 'blank';
  writeSettingRaw(conn, LT_BLOCK_TEMPLATES, lists);
  writeSettingRaw(conn, LT_PROMPT_TEMPLATES_VERSION, 0);

  ensurePromptTemplates(conn);
  const after = readSettingRaw(conn, LT_BLOCK_TEMPLATES);
  assert.equal(after.ack.active, BUILTIN_TEMPLATE_ID, '空模板 active 自愈回 builtin');
  assert.equal(after.ack.list.find((x) => x.id === 'blank').template, '', '条目本身保留（数据不丢）');
});

test('写路径：内置不可改（patch 的 builtin 条目一律替换回库内现值）', () => {
  resetLocaltaskStore();
  const conn = db();
  const orig = readSettingRaw(conn, LT_BLOCK_TEMPLATES).ack.list[0].template;
  setLtSettings({ blockTemplates: { ack: { active: BUILTIN_TEMPLATE_ID, list: [
    { id: BUILTIN_TEMPLATE_ID, name: '想改名', template: 'hack {{task.id}}', builtin: true },
  ] } } });
  const after = readSettingRaw(conn, LT_BLOCK_TEMPLATES).ack;
  assert.equal(after.list[0].template, orig, 'builtin 文本不被 patch 覆盖');
  assert.equal(after.list[0].name, BUILTIN_TEMPLATE_NAME, 'builtin 名称不被 patch 覆盖');
});

test('写路径：生效模板为空 / 未声明变量被拒；合法自定义模板放行', () => {
  resetLocaltaskStore();
  const builtin = (id) => ({ id: BUILTIN_TEMPLATE_ID, name: BUILTIN_TEMPLATE_NAME, template: builtinTpl(id), builtin: true });
  // 空生效模板
  assert.throws(
    () => setLtSettings({ blockTemplates: { ack: { active: 'blank', list: [
      builtin('ack'),
      { id: 'blank', name: '空', template: '', builtin: false },
    ] } } }),
    /是空的/,
    'active 指向空模板 → 拒绝保存'
  );
  // 未声明变量（全局段白名单下仍拦两类：拼错的段 / 拼错的字段）
  assert.throws(
    () => setLtSettings({ blockTemplates: { ack: { active: 'bad', list: [
      builtin('ack'),
      { id: 'bad', name: '拼错段', template: '看 {{ghoost.count}}', builtin: false },
    ] } } }),
    /未声明的变量/,
    '拼错段名 → 拒绝保存'
  );
  assert.throws(
    () => setLtSettings({ blockTemplates: { ack: { active: 'bad2', list: [
      builtin('ack'),
      { id: 'bad2', name: '拼错字段', template: '看 {{task.ide}} 与 {{goal.remainingHuma}}', builtin: false },
    ] } } }),
    /未声明的变量/,
    '拼错字段名 → 拒绝保存'
  );
  // 合法：ack 段用 task.*
  setLtSettings({ blockTemplates: { ack: { active: 'ok', list: [
    builtin('ack'),
    { id: 'ok', name: '我的', template: '完成 #{{task.id}} 后调用 localtask done 汇报。', builtin: false },
  ] } } });
  const s = getLtSettings();
  assert.equal(s.blockTemplates.ack.active, 'ok');
  // each 目标路径也要已声明：context 段 each 一个不存在的段
  assert.throws(
    () => setLtSettings({ blockTemplates: { context: { active: 'bad3', list: [
      builtin('context'),
      { id: 'bad3', name: 'each 越界', template: '{{#each ghosts}}- {{name}}{{/each}}', builtin: false },
    ] } } }),
    /未声明的变量/,
    'each 目标未声明 → 拒绝保存'
  );
});
