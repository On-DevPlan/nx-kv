// 「预览 get 提示词」（任务 #65）测试。
//
// 用户诉求是可观测：「当前具体会获得怎么样的字符串？」——所以这里钉三件事：
//   1. **零副作用**：预览不领取、不写盘、不启动任务级 timegoal 计时；
//   2. **所见即所得**：预览出来的 instruction / 排版，与真实 getTask 的交付**逐字一致**
//      （两条路径共用 buildTaskDelivery + delivery-text，任何一边被改都会红）；
//   3. **可追溯**：段来源与开关状态如实（关掉的模板不会假装存在）。
//
// 存储一律指向临时文件，绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';
import { getTask } from '../../src/modules/tasktool/get.js';
import { previewTaskDelivery } from '../../src/modules/tasktool/preview.js';
import { deliveryPlainText } from '../../src/modules/tasktool/delivery-text.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-prev-'));
const storeFile = join(tmp, 'localtasks.json');
const goalFile = join(tmp, 'timegoals.json');
const dir = join(tmp, 'projP');
mkdirSync(dir, { recursive: true });
process.env.NX_KV_LOCALTASK_STORE = storeFile;
process.env.NX_KV_CONFIG = join(tmp, 'config.json');

process.on('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结果 */
  }
});

const keyOf = () => svc.normalizeCwd(dir).key;

test('预览与真实领取的交付逐字一致（且预览在前、领取在后）', async () => {
  await svc.updateSettings({ taskSuffix: ['收尾：{{task.text}} 之后继续'] });
  const added = await svc.addTask({ cwd: dir, text: '# 任务甲\n\n正文一段' });

  const pre = await previewTaskDelivery({
    task: added.task,
    cwd: dir,
    key: keyOf(),
    summary: '本轮现状' });

  const got = await getTask({ cwd: dir, summary: '本轮现状', open: false });
  assert.ok(got && got.task, '真实领取拿到任务');
  assert.equal(pre.instruction, got.instruction || '', 'instruction 必须逐字一致');
  assert.equal(pre.coversBody, !!got.coversBody, 'coversBody 必须一致');
  assert.equal(pre.rendered, deliveryPlainText(got), '面板原文 = CLI 正文排版');
  assert.equal(got.task.text.includes('{{task.text}}'), false, '模板不落进任务正文');
});

test('预览是只读的：不领取、不改状态、不动行', async () => {
  const added = await svc.addTask({ cwd: dir, text: '# 任务乙\n\n待领取' });
  const beforeRow = await svc.getTask({ id: added.task.id, cwd: dir });
  const beforeCount = (await svc.listTasks()).topics[0].tasks.length;
  const beforeExt = svc.repo.db().get('SELECT ext, status, claimed_at FROM tasks WHERE seq = :s', {
    s: added.task.id });

  const pre = await previewTaskDelivery({ task: added.task, cwd: dir, key: keyOf(), summary: '' });
  assert.ok(pre.instruction.length > 0, '渲染出了内容');

  // 库里那一行一个字段都不该变（ext / status / claimed_at 三样都验）
  const afterExt = svc.repo.db().get('SELECT ext, status, claimed_at FROM tasks WHERE seq = :s', {
    s: added.task.id });
  assert.deepEqual(afterExt, beforeExt, '预览不许写库');
  assert.equal((await svc.listTasks()).topics[0].tasks.length, beforeCount, '任务数不变');
  const row = await svc.getTask({ id: added.task.id, cwd: dir });
  assert.equal(row.status, 'pending', '任务仍是待领取（预览不等于领取）');
  assert.equal(row.createdAt, beforeRow.createdAt);
});

test('带时间目标的任务：预览会给出 check 指令，但不启动计时', async () => {
  // 目录级 goal 先清干净，避免串味
  await svc.updateSettings({ taskSuffix: [] });
  const added = await svc.addTask({
    cwd: dir,
    text: '# 任务丙\n\n带时间目标',
    timegoal: { duration: '2h', prompt: '先写测试' } });
  assert.ok(!existsSync(goalFile), '前置：还没有 timegoals.json');

  const pre = await previewTaskDelivery({ task: added.task, cwd: dir, key: keyOf(), summary: '' });
  assert.match(pre.instruction, /timegoal check --task task:/, '预览里带 check 指令');
  assert.match(pre.instruction, /先写测试/, '附加要求也如实渲染');
  assert.ok(!existsSync(goalFile), '预览不得创建 timegoals.json（不起表）');

  const seg = pre.segments.find((s) => s.id === 'goal');
  assert.ok(seg, '段落来源里应有一段「任务级 check 指令」');
});

test('开关状态如实：关掉的模板不出现，开着的出现', async () => {
  await svc.updateSettings({ taskSuffix: [], ackPrompt: [] });
  const added = await svc.addTask({ cwd: dir, text: '# 任务丁\n\n干净交付' });
  const off = await previewTaskDelivery({ task: added.task, cwd: dir, key: keyOf(), summary: '' });
  assert.equal(off.switches.suffix.on, false);
  assert.equal(off.switches.ack.on, false);
  assert.equal(off.segments.some((s) => s.id === 'ack'), false, '没配 ack 就不该有这一段');

  await svc.updateSettings({ ackPrompt: ['完成总结写「改了什么 / 怎么验证」'] });
  const on = await previewTaskDelivery({ task: added.task, cwd: dir, key: keyOf(), summary: '' });
  assert.equal(on.switches.ack.on, true);
  assert.equal(on.switches.ack.count, 1);
  assert.match(on.instruction, /改了什么 \/ 怎么验证/, 'ack 段进了交付');
  assert.equal(on.segments.some((s) => s.id === 'ack'), true);
});

test('草稿也能预览（id=0，不读库存）', async () => {
  const pre = await previewTaskDelivery({
    task: { id: 0, text: '# 草稿任务\n\n还没提交', status: 'draft' },
    cwd: dir,
    key: keyOf(),
    summary: '' });
  assert.match(pre.rendered, /草稿任务/);
  assert.match(pre.rendered, /还没提交/);
});

test('附件段模板可配：自定义进交付、开关如实、置空回默认（#82）', async () => {
  await svc.updateSettings({ taskSuffix: [], ackPrompt: [] });
  const added = await svc.addTask({ cwd: dir, text: '# 任务戊\n\n看图 ![截图](abcdef0123456789)' });

  const pre0 = await previewTaskDelivery({ task: added.task, cwd: dir, key: keyOf(), summary: '' });
  assert.match(pre0.instruction, /〔附件〕/, '默认走内置附件段');
  assert.equal(pre0.switches.attachTemplate.custom, false);

  await svc.updateSettings({ attachTemplate: '【附件 SOP】共 {{attach.count}} 个：\n{{attach.list}}' });
  const pre1 = await previewTaskDelivery({ task: added.task, cwd: dir, key: keyOf(), summary: '' });
  assert.match(pre1.instruction, /【附件 SOP】共 1 个/, '自定义模板渲染进交付');
  assert.match(pre1.instruction, /abcdef0123456789/, '附件 id 在清单里');
  assert.doesNotMatch(pre1.instruction, /〔附件〕本任务正文引用了附件/, '内置默认不再出现');
  assert.equal(pre1.switches.attachTemplate.custom, true);

  await svc.updateSettings({ attachTemplate: '' });
  const pre2 = await previewTaskDelivery({ task: added.task, cwd: dir, key: keyOf(), summary: '' });
  assert.match(pre2.instruction, /〔附件〕/, '置空 = 回到内置默认（附件段关不掉）');
});

test('模板设置落盘后重读不丢（store-io 白名单回归，#82）', async () => {
  // loadStore cache=false：每次都重读盘并过白名单重建——之前 deliveryTemplate 不在
  // 白名单里，保存成功、下一次 load 即被剥掉（重启即丢），这里钉死两个模板键。
  await svc.updateSettings({ deliveryTemplate: 'DLV-{{task.id}}', attachTemplate: 'ATT-{{attach.count}}' });
  const s = await svc.getSettings();
  assert.equal(s.deliveryTemplate, 'DLV-{{task.id}}');
  assert.equal(s.attachTemplate, 'ATT-{{attach.count}}');
});
