// 本地附件仓（core/localatt.js）——本地任务贴图的存储层。
//
// 口径（任务 #15 验收反馈）：本地任务的贴图走本地存储，与云端零关联——
// 上传不发网、id 与云端 fileId 同构（32 位 hex，正文语法零分叉）、
// resolve/index 给 agent 直接读的绝对路径。这里把存储契约钉死。
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// env 先行（模块导入前钉住独立附件根）——不落到用户的真实 ~/.nx-kv 上
const sb = mkdtempSync(join(tmpdir(), 'nx-kv-localatt-'));
process.env.NX_KV_HOME = sb;
process.env.NX_KV_DB = join(sb, 'nxkv.db');
process.env.NX_KV_ATTACHMENTS = join(sb, 'att');
process.env.NX_KV_CONFIG = join(sb, 'config.json'); // 不落盘 → 默认设置

const {
  localDir, localUpload, localResolve, localIndex, localReadStream, LOCAL_STORE_DIRNAME,
} = await import('../../src/core/localatt.js');
const fileService = await import('../../src/modules/file/service.js');
const fileMod = (await import('../../src/modules/file/index.js')).default;

test('localUpload：落盘 + 台账 + id 与云端 fileId 同构（32 位 hex）', async () => {
  const dir = localDir();
  assert.ok(dir.includes(join('att', LOCAL_STORE_DIRNAME)), `目录应在附件根的 local/ 下（实际 ${dir}）`);
  const rec = await localUpload({ name: '设计稿.png', buffer: Buffer.from('png-bytes'), contentType: 'image/png' });
  assert.match(rec.fileId, /^[0-9a-f]{32}$/, 'id 必须是 32 位 hex（looksLikeFileId 才认）');
  assert.equal(rec.storage, 'local');
  assert.ok(existsSync(rec.path), '文件已落盘');
  assert.equal(readFileSync(rec.path, 'utf8'), 'png-bytes');
  const hit = await localResolve(rec.fileId);
  assert.equal(hit.path, rec.path);
  assert.equal(hit.name, '设计稿.png');
  assert.equal(hit.contentType, 'image/png');
  // index 一并可见
  const { index } = await localIndex();
  assert.ok(index.has(rec.fileId));
});

test('localUpload：缺扩展名按 contentType 补（Windows 双击要能打开）', async () => {
  const rec = await localUpload({ name: '截图-无扩展名', buffer: Buffer.from('x'), contentType: 'image/png' });
  assert.equal(rec.name, '截图-无扩展名.png');
});

test('localUpload：重名给「名字 (2).ext」，台账条目互不覆盖', async () => {
  const a = await localUpload({ name: '报告.docx', buffer: Buffer.from('a'), contentType: 'application/msword' });
  const b = await localUpload({ name: '报告.docx', buffer: Buffer.from('b'), contentType: 'application/msword' });
  assert.notEqual(a.fileId, b.fileId);
  assert.notEqual(a.name, b.name, '同一台账里两个 id 不得共用一个落盘名');
  assert.match(b.name, /报告 \(2\)\.docx$/u);
  assert.equal((await localResolve(a.fileId)).name, a.name);
  assert.equal((await localResolve(b.fileId)).name, b.name);
});

test('localUpload：空内容 / 空名字拒绝', async () => {
  await assert.rejects(() => localUpload({ name: 'x.png', buffer: Buffer.from('') }), /内容为空/u);
  await assert.rejects(() => localUpload({ buffer: Buffer.from('x') }), /文件名/u);
});

test('localResolve：没传过的 id → null；台账在而文件被手删 → null', async () => {
  assert.equal(await localResolve('f'.repeat(32)), null);
  assert.equal(await localResolve(''), null);
});

test('localReadStream：按 resolve 出的绝对路径读出原字节', async () => {
  const rec = await localUpload({ name: '流.png', buffer: Buffer.from('stream-bytes'), contentType: 'image/png' });
  const hit = await localResolve(rec.fileId);
  const chunks = [];
  for await (const c of localReadStream(hit.path)) chunks.push(c);
  assert.equal(Buffer.concat(chunks).toString('utf8'), 'stream-bytes');
});

test('file.upload：action 层返回 storage=local + 本地路径（零网络路径）', async () => {
  const act = fileMod.actions.find((a) => a.id === 'file.upload');
  const content = Buffer.from('web-bytes').toString('base64');
  const d = await fileService.uploadFileAction({ name: '面板贴图.png', content, contentType: 'image/png' });
  assert.equal(d.storage, 'local');
  assert.match(d.fileId, /^[0-9a-f]{32}$/);
  assert.ok(existsSync(d.localPath));
  assert.equal(d.markdown.image, `![面板贴图.png](${d.fileId})`);
  assert.equal(d.url, `/api/file/content/${d.fileId}`, '预览仍走同一条 content 路由');
  assert.ok(act.render(d).includes('本机附件仓'), '人读输出交代落点');
});

test('file.get：查本机附件记录', async () => {
  const rec = await localUpload({ name: '查询.png', buffer: Buffer.from('q'), contentType: 'image/png' });
  const d = await fileService.getFileAction(rec.fileId);
  assert.equal(d.storage, 'local');
  assert.equal(d.localPath, rec.path);
  assert.equal(d.isImage, true);
});

test('清理', async () => {
  // Windows 上连接开着删库必 EPERM：先关进程级连接再删目录
  const { closeDb } = await import('../../src/core/db/index.js');
  closeDb();
  rmSync(sb, { recursive: true, force: true, maxRetries: 3 });
});
