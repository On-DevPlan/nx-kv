import { test } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import * as svc from '../../src/modules/localtask/service.js';

// env 先行（模块导入前钉住独立 store/config/附件根）——标注会真读台账、真写任务队列，
// 不能落到用户的真实 ~/.nx-kv 上。默认 autoSyncAttachments=false（配置文件不存在即缺省），
// 全程不碰网络。
const sb = mkdtempSync(join(tmpdir(), 'nx-kv-attach-'));
process.env.NX_KV_LOCALTASK_STORE = join(sb, 'localtasks.json');
process.env.NX_KV_CONFIG = join(sb, 'config.json'); // 不落盘 → 默认设置（自动下载关）
process.env.NX_KV_ATTACHMENTS = join(sb, 'att');
process.env.NX_KV_DOCS_DIR = join(sb, 'docs');
process.env.NX_KV_REPOS_STORE = join(sb, 'repos.json');

const service = await import('../../src/modules/localtask/service.js');
const { annotateTaskDelivery, attachmentInstruction, attachToTask, listTaskAttachments } = await import(
  '../../src/modules/tasktool/attach.js'
);
const { getTask: claimTask } = await import('../../src/modules/tasktool/get.js');
const mod = (await import('../../src/modules/localtask/index.js')).default;

const IMG_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // 32 位 hex（合法 fileId）
const DOC_ID = '0f9e8d7c6b5a493827160514d3c2b1a0.docx'; // 带扩展名的合法 fileId
const LOCAL_ID = 'c3d4e5f60718293a4b5c6d7e8f90a1b2'; // 32 位 hex（本机附件仓条目用）
const URL_ID = 'https://example.com/a.png'; // URL 不是 fileId——不得当附件

// 收尾指令关闭：隔离出「instruction 里只有〔附件〕段」的断言环境
await service.updateSettings({ taskSuffix: [] });

test('annotateTaskDelivery：正文没有附件引用 → null（载荷逐字节不变的前提）', async () => {
  const added = await service.addTask({ text: '# 普通任务\n只有一条链接 https://example.com/x 和 [文字](./相对路径)' });
  assert.equal(await annotateTaskDelivery(added.task), null);
});

test('annotateTaskDelivery：正文引用附件（自动下载关）→ 清单齐、未标注本地路径', async () => {
  const added = await service.addTask({
    text: `# 带附件\n\n![设计稿.png](${IMG_ID})\n\n[需求文档](${DOC_ID})\n\n外链 [说明](https://example.com/a.png) 不是附件`,
  });
  const att = await annotateTaskDelivery(added.task);
  assert.ok(att, '有引用就必须标注');
  assert.deepEqual(
    att.task.attachments.map((a) => ({ id: a.id, kind: a.kind, name: a.name, synced: a.synced })),
    [
      { id: IMG_ID, kind: 'image', name: '设计稿.png', synced: false },
      { id: DOC_ID, kind: 'file', name: '需求文档', synced: false },
    ]
  );
  assert.equal(att.sync, null, '自动下载关 → 不跑同步');
  // URL / 相对路径没有被误判成附件（URL_ID 那条外链留在正文原样）
  const ids = att.task.attachments.map((a) => a.id);
  assert.ok(!ids.includes(URL_ID), '外链不得被当成附件');
  assert.ok(!JSON.stringify(att.task.attachments).includes('example.com'));
});

test('attachmentInstruction：零附件 → 空串；有附件 → 给出 id 与拉取提示', () => {
  assert.equal(attachmentInstruction([], null), '');
  const seg = attachmentInstruction([{ id: IMG_ID, kind: 'image', name: '设计稿.png', localPath: '', synced: false }], null);
  assert.ok(seg.includes('〔附件〕'));
  assert.ok(seg.includes(IMG_ID));
  assert.ok(seg.includes('file sync --ids'));
  // 本地已同步 → 给绝对路径而不是提示
  const seg2 = attachmentInstruction([{ id: IMG_ID, kind: 'image', name: '设计稿.png', localPath: 'D:\\x\\设计稿.png', synced: true }], null);
  assert.ok(seg2.includes('D:\\x\\设计稿.png'));
  assert.ok(!seg2.includes('未同步'));
});

test('annotateTaskDelivery：本地台账已有副本 → synced + 绝对路径进标注与指令段', async () => {
  // 伪造台账：同 file sync 落盘的 manifest.json 形状（core/attachstore 的契约）
  const dir = join(sb, 'att', 'default');
  mkdirSync(dir, { recursive: true });
  const fileName = '设计稿.png';
  writeFileSync(join(dir, fileName), 'png');
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ groupId: 0, dir, updatedAt: 'x', files: { [IMG_ID]: { name: fileName, size: 3, contentType: 'image/png', syncedAt: 'x' } } })
  );
  const added = await service.addTask({ text: `# 再看一眼\n![设计稿.png](${IMG_ID})` });
  const att = await annotateTaskDelivery(added.task);
  const a = att.task.attachments[0];
  assert.equal(a.synced, true);
  assert.ok(a.localPath.endsWith(fileName), `localPath 应为台账绝对路径（实际 ${a.localPath}）`);
  assert.ok(existsSync(a.localPath));
  const seg = attachmentInstruction(att.task.attachments, att.sync);
  assert.ok(seg.includes(a.localPath), '指令段应带本地绝对路径（agent 直接读文件）');
});

test('attachToTask：--fileId 追加嵌入到正文末尾（不替换正文）', async () => {
  const added = await service.addTask({ text: '# 原始任务\n原始正文' });
  const r = await attachToTask({ id: added.task.id, fileId: DOC_ID, name: '需求.docx', kind: 'file' });
  assert.equal(r.fileId, DOC_ID);
  assert.ok(r.task.text.startsWith('# 原始任务\n原始正文'), '原文保留');
  assert.ok(r.task.text.endsWith(`[需求.docx](${DOC_ID})`), `末尾是嵌入（实际 ${JSON.stringify(r.task.text.slice(-60))}）`);
  const listed = await listTaskAttachments({ id: added.task.id });
  assert.equal(listed.count, 1);
  assert.equal(listed.attachments[0].id, DOC_ID);
});

test('attachToTask：--path 落本机附件仓（零云端）→ 嵌入 + 清单直接标注本地路径', async () => {
  const src = join(sb, 'src-图.png');
  writeFileSync(src, 'fake-png');
  const added = await service.addTask({ text: '# 路径附件' });
  const r = await attachToTask({ id: added.task.id, path: src });
  assert.match(r.fileId, /^[0-9a-f]{32}$/, '--path 也要给 32 位 hex id（正文语法零分叉）');
  assert.ok(r.task.text.endsWith(`![src-图.png](${r.fileId})`), `末尾是图片嵌入（实际 ${JSON.stringify(r.task.text.slice(-60))}）`);
  // 本机仓台账里真的有这个 id（任务 #15 口径：本地附件不碰云端）
  const man = JSON.parse(readFileSync(join(sb, 'att', 'local', 'manifest.json'), 'utf8'));
  assert.ok(man.files[r.fileId], '本机仓台账记录了这次上传');
  const listed = await listTaskAttachments({ id: added.task.id });
  assert.equal(listed.count, 1);
  assert.equal(listed.attachments[0].synced, true, '本机仓命中 → 直接视为已同步');
  assert.equal(listed.attachments[0].storage, 'local');
  assert.ok(existsSync(listed.attachments[0].localPath), 'localPath 是真实在盘的绝对路径');
});

test('annotateTaskDelivery：本机仓命中 → 零云端标注绝对路径；未命中的 id 才走云端镜像语义', async () => {
  // 本机仓条目（同 core/localatt 落盘形状）
  const dir = join(sb, 'att', 'local');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '仓图.png'), 'png');
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ dir, updatedAt: 'x', files: { [LOCAL_ID]: { name: '仓图.png', size: 3, contentType: 'image/png', createdAt: 'x' } } })
  );
  const added = await service.addTask({ text: `# 本机仓直读\n![仓图.png](${LOCAL_ID})` });
  const att = await annotateTaskDelivery(added.task);
  const a = att.task.attachments[0];
  assert.equal(a.synced, true);
  assert.equal(a.storage, 'local');
  assert.ok(a.localPath.endsWith('仓图.png'));
  assert.equal(att.sync, null, '本机仓全命中 → 一次网都不碰（sync 为 null）');
  const seg = attachmentInstruction(att.task.attachments, att.sync);
  assert.ok(seg.includes(a.localPath));
});

test('attachToTask：参数校验——缺参 / id 不合法 / kind 非法 → 报错', async () => {
  const added = await service.addTask({ text: '# 校验' });
  await assert.rejects(() => attachToTask({ id: added.task.id }), /需要 --path|--fileId/u);
  await assert.rejects(() => attachToTask({ id: added.task.id, fileId: 'not-a-hash' }), /id 不合法/u);
  await assert.rejects(() => attachToTask({ id: added.task.id, fileId: IMG_ID, kind: 'video' }), /--kind/u);
});

test('listTaskAttachments：无引用 → count 0；台账目录与开关如实透出', async () => {
  const added = await service.addTask({ text: '# 干净任务' });
  const d = await listTaskAttachments({ id: added.task.id });
  assert.equal(d.count, 0);
  assert.equal(d.autoSync, false, '配置文件不存在 → 自动下载默认关');
  assert.ok(d.localDir.startsWith(join(sb, 'att')));
});

test('claim 交付（tasktool/get）：task.attachments 进载荷、〔附件〕段进 instruction', async () => {
  const dir = join(sb, 'claim-dir');
  mkdirSync(dir, { recursive: true });
  await service.addTask({ cwd: dir, text: `# 领取侧交付\n![设计稿.png](${IMG_ID})` });
  const r = await claimTask({ cwd: dir, summary: '测试领取', open: false });
  assert.equal(r.status, 'ok');
  assert.ok(Array.isArray(r.task.attachments) && r.task.attachments.length === 1, '交付任务带附件清单');
  assert.ok(r.instruction.includes('〔附件〕'), 'instruction 带〔附件〕段');
  // 指令段必须带「去哪读」：本地已同步 → 绝对路径；未同步 → 图床 id + 拉取命令
  const a0 = r.task.attachments[0];
  assert.ok(r.instruction.includes(a0.localPath || a0.id));
  // 库存原文不被标注改写
  const shown = await service.getTask({ cwd: dir, id: r.task.id });
  assert.ok(!shown.attachments, '库存任务本体不带运行时标注字段');
});

test('localtask.attachments / localtask.attach 动作齐备且委托 tasktool/attach.js', async () => {
  const ids = mod.actions.map((a) => a.id);
  assert.ok(ids.includes('localtask.attach'));
  assert.ok(ids.includes('localtask.attachments'));
  const att = mod.actions.find((a) => a.id === 'localtask.attachments');
  const added = await service.addTask({ text: `# 经 action\n[需求文档](${DOC_ID})` });
  const d = await att.run({ id: added.task.id });
  assert.equal(d.count, 1);
  assert.equal(d.attachments[0].id, DOC_ID);
  // render 不因形状缺失而崩
  assert.ok(att.render(d).includes(DOC_ID));
});

test('清理', () => {
  try { svc.closeDb(); console.error('[DBG cleanup] closed'); } catch (e) { console.error('[DBG cleanup] close threw:', e.message); }
  try { rmSync(sb, { recursive: true, force: true }); } catch (e) { console.error('[DBG cleanup] rm fail:', e.message); }
});
