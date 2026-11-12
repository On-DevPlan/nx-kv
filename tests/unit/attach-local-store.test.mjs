// 本地任务贴图的**前端**链路（components/md/attachments.js → cloud/upload.js）。
//
// 口径（任务 #15）：本地任务贴图走本机附件仓——请求体必须带 local: true，
// 后端才落 ~/.nx-kv/attachments/local/ 而不是云端图床。这条断言的价值：
// 前端少传/错传一个 flag，附件就又跑回云端（云端不可达时界面看着有图、
// agent 领取却 count 0——用户验收反馈的原症状）。
//
// 无 DOM 依赖：桩掉 fetch 与 FileReader 即可在 Node 里直测。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const LOCAL_ID = 'd'.repeat(32);

// ── 桩：fetch 记录请求体并回一个「本机仓上传成功」的形状 ──────────────
const calls = [];
globalThis.fetch = async (path, init) => {
  const body = JSON.parse(init.body);
  calls.push({ path, body });
  return {
    status: 200,
    json: async () => ({
      ok: true,
      data: {
        fileId: LOCAL_ID,
        name: body.name,
        size: 3,
        contentType: body.contentType,
        isImage: true,
        storage: body.local ? 'local' : 'cloud',
        localPath: body.local ? 'C:\\att\\local\\x.png' : '',
        url: `/api/file/content/${LOCAL_ID}`,
        markdown: { image: `![${body.name}](${LOCAL_ID})`, file: `[${body.name}](${LOCAL_ID})` },
      },
    }),
  };
};

// FileReader 在 Node 里没有——贴图走 dataURL 读取，桩成直接给 data URL
globalThis.FileReader = class {
  readAsDataURL() {
    this.onload({ result: 'data:image/png;base64,iVBORw0KGgo=' });
  }
};

const { filesToAttachments } = await import('../../src/web/frontend/components/md/attachments.js');

test('filesToAttachments：本机贴图上传落本机附件仓（无云端开关）', async () => {
  calls.length = 0;
  const r = await filesToAttachments([{ name: '设计稿.png', type: 'image/png', size: 3 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/file', '上传走同一条 action');
  assert.equal(calls[0].body.local, undefined, '不再传云端/本地开关');
  assert.equal(calls[0].body.name, '设计稿.png');
  // 正文嵌入片段用后端给的 id
  assert.deepEqual(r.imageInserts, [`\n![设计稿.png](${LOCAL_ID})\n`]);
  assert.equal(r.items[0].id, LOCAL_ID);
  assert.equal(r.items[0].url, `/api/file/content/${LOCAL_ID}`);
});

test('filesToAttachments：多张图按序各发一次，嵌入片段保序', async () => {
  calls.length = 0;
  const r = await filesToAttachments([
    { name: 'a.png', type: 'image/png', size: 1 },
    { name: 'b.png', type: 'image/png', size: 1 },
  ]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.body.local === undefined));
  assert.equal(r.imageInserts.length, 2);
});
