// 「预览 get 提示词」（任务 #65）测试。
//
// 用户诉求是可观测：「当前具体会获得怎么样的字符串？」——所以这里钉三件事：
//   1. **零副作用**：预览不领取、不写盘、不启动任务级 timegoal 计时；
//   2. **所见即所得**：预览出来的 instruction / 排版，与真实 getTask 的交付**逐字一致**
//      （两条路径共用 buildTaskDelivery + delivery-text，任何一边被改都会红）；
//   3. **可追溯**：段来源与开关状态如实（#152 起模板全部内置，开关只剩「哪段出没出」）。
//
// 存储一律指向临时文件，绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';
import { getTask } from '../../src/modules/claim/get.js';
import { previewTaskDelivery } from '../../src/modules/claim/preview.js';
import { deliveryPlainText } from '../../src/modules/claim/delivery-text.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-prev-'));
const storeFile = join(tmp, 'localtasks.json');
const goalFile = join(tmp, 'timegoals.json');
const dir = join(tmp, 'projP');
mkdirSync(dir, { recursive: true });
process.env.NX_KV_DB = join(tmp, 'nxkv.db'); // 显式钉库：防止外部 NX_KV_DB 覆盖隔离
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
  const added = await svc.addTask({ cwd: dir, text: '# 任务甲\n\n正文一段' });

  const pre = await previewTaskDelivery({
    task: added.task,
    cwd: dir,
    key: keyOf(),
    summary: '本轮现状',
  });

  const got = await getTask({ cwd: dir, summary: '本轮现状', open: false });
  assert.ok(got && got.task, '真实领取拿到任务');
  assert.equal(pre.instruction, got.instruction || '', 'instruction 必须逐字一致');
  assert.equal(pre.coversBody, !!got.coversBody, 'coversBody 必须一致');
  assert.equal(pre.rendered, deliveryPlainText(got), '面板原文 = CLI 正文排版');
  assert.equal(got.task.text.includes('本任务包含'), false, '模板不落进任务正文');
});

test('预览是只读的：不领取、不改状态、不动行', async () => {
  const added = await svc.addTask({ cwd: dir, text: '# 任务乙\n\n待领取' });
  const beforeRow = await svc.getTask({ id: added.task.id, cwd: dir });
  const beforeCount = (await svc.listTasks()).topics[0].tasks.length;
  const beforeExt = svc.repo.db().get('SELECT ext, status, claimed_at FROM tasks WHERE seq = :s', {
    s: added.task.id,
  });

  const pre = await previewTaskDelivery({ task: added.task, cwd: dir, key: keyOf(), summary: '' });
  assert.ok(pre.instruction.length > 0, '渲染出了内容');

  // 库里那一行一个字段都不该变（ext / status / claimed_at 三样都验）
  const afterExt = svc.repo.db().get('SELECT ext, status, claimed_at FROM tasks WHERE seq = :s', {
    s: added.task.id,
  });
  assert.deepEqual(afterExt, beforeExt, '预览不许写库');
  assert.equal((await svc.listTasks()).topics[0].tasks.length, beforeCount, '任务数不变');
  const row = await svc.getTask({ id: added.task.id, cwd: dir });
  assert.equal(row.status, 'pending', '任务仍是待领取（预览不等于领取）');
  assert.equal(row.createdAt, beforeRow.createdAt);
});

test('带时间目标的任务：预览会给出 check 指令，但不启动计时', async () => {
  const added = await svc.addTask({
    cwd: dir,
    text: '# 任务丙\n\n带时间目标',
    timegoal: { duration: '2h', prompt: '先写测试' },
  });
  assert.ok(!existsSync(goalFile), '前置：还没有 timegoals.json');

  const pre = await previewTaskDelivery({ task: added.task, cwd: dir, key: keyOf(), summary: '' });
  assert.match(pre.instruction, /timegoal check --task task:/, '预览里带 check 指令');
  assert.match(pre.instruction, /先写测试/, '附加要求也如实渲染');
  assert.ok(!existsSync(goalFile), '预览不得创建 timegoals.json（不起表）');

  const seg = pre.segments.find((s) => s.id === 'goal');
  assert.ok(seg, '段落来源里应有一段「任务级 check 指令」');
});

test('开关状态如实：模板全部内置，开关只回答「这段出没出」', async () => {
  const added = await svc.addTask({ cwd: dir, text: '# 任务丁\n\n干净交付' });

  const pre = await previewTaskDelivery({ task: added.task, cwd: dir, key: keyOf(), summary: '' });
  assert.equal(pre.switches.ack.on, true, 'ack 段照常输出');
  assert.equal(pre.switches.ack.count, 1);
  assert.equal(pre.switches.blockTemplates.ack.custom, false, '模板全部内置：#152 起没有自定义条目');
  assert.equal(pre.switches.blockTemplates.ack.builtin, true);
  assert.equal(pre.segments.some((s) => s.id === 'ack'), true);
  // 每个已注册的段都在 switches.blockTemplates 里有一条只读回显
  assert.ok(Object.keys(pre.switches.blockTemplates).length >= 8);
  for (const [id, b] of Object.entries(pre.switches.blockTemplates)) {
    assert.equal(b.custom, false, `${id} 不该出现自定义模板`);
    assert.equal(b.builtin, true, `${id} 必须是内置`);
  }
  // 时机链也一并回显（get / check / done）
  assert.deepEqual(Object.keys(pre.switches.groups).sort(), ['check', 'done', 'get']);
});

test('模板不再可写：给 updateSettings 传模板字段直接拒绝', async () => {
  await assert.rejects(() => svc.updateSettings({ blockTemplates: {} }), /请至少指定一项/);
  await assert.rejects(() => svc.updateSettings({ ackPrompt: ['x'] }), /请至少指定一项/);
  await assert.rejects(() => svc.updateSettings({ attachTemplate: 'x' }), /请至少指定一项/);
  const s = await svc.getSettings();
  assert.equal(s.blockTemplates, undefined, '设置视图不再有 blockTemplates 这一层');
  assert.equal(s.deliveryTemplate, undefined);
  assert.equal(s.attachTemplate, undefined);
});

test('草稿也能预览（id=0，不读库存）', async () => {
  const pre = await previewTaskDelivery({
    task: { id: 0, text: '# 草稿任务\n\n还没提交', status: 'draft' },
    cwd: dir,
    key: keyOf(),
    summary: '',
  });
  assert.match(pre.rendered, /草稿任务/);
  assert.match(pre.rendered, /还没提交/);
});

test('附件段：内置模板渲染清单与 id（#82 的可配置通道已随 #152 下线）', async () => {
  const added = await svc.addTask({ cwd: dir, text: '# 任务戊\n\n看图 ![截图](abcdef0123456789)' });
  const pre = await previewTaskDelivery({ task: added.task, cwd: dir, key: keyOf(), summary: '' });
  assert.match(pre.instruction, /本任务包含 1 个附件/, '走内置附件段');
  assert.match(pre.instruction, /abcdef0123456789/, '附件 id 在清单里');
  assert.equal(pre.switches.attachTemplate.custom, false);
});
