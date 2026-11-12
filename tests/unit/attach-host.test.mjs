// 附件宿主口径（#183）：host 只有 task / doc 两种，字段名与端点都按宿主分。
//
// 文档页此前把 host 写成 'ref' 强转，落进 else 分支 → 「挂文档」发的是任务侧
// 的 `ref` 键（docs.attach 只认 `doc`）→ 静默 400；「改说明」打的是任务端点。
// 这条用例把两个宿主的线缆形状钉住。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachBodyOf, endpointOf } from '../../src/web/frontend/components/md/attach-common.js';

test('attachBodyOf：文档宿主挂文档用 doc 键（任务宿主才用 ref）', () => {
  const item = { source: 'ref', docRef: 'rel:notes/design.md', name: '设计笔记', note: '说明', inline: true };
  assert.deepEqual(attachBodyOf(item, 'doc'), {
    doc: 'rel:notes/design.md',
    name: '设计笔记',
    note: '说明',
  });
  assert.deepEqual(attachBodyOf(item, 'task'), {
    ref: 'rel:notes/design.md',
    name: '设计笔记',
    note: '说明',
    inline: true,
  });
});

test('attachBodyOf：文件 / URL / 任务三类不受宿主影响', () => {
  assert.deepEqual(attachBodyOf({ source: 'file', fileId: 'f_1', name: 'a.png' }, 'doc'), { fileId: 'f_1', name: 'a.png' });
  assert.deepEqual(attachBodyOf({ source: 'url', url: 'https://x.y', name: 'x' }, 'task'), { url: 'https://x.y', name: 'x' });
  assert.deepEqual(attachBodyOf({ source: 'task', seq: 12, name: '#12 t' }, 'task'), { task: '12', name: '#12 t' });
});

test('endpointOf：文档宿主三件套走 /api/docs/*，请求体按 ref 定位', async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push([String(url), init && init.body ? String(init.body) : '']);
    return new Response(JSON.stringify({ ok: true, data: { attachments: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const ep = endpointOf('doc', { refId: 'rel:notes/design.md' });
    await ep.list();
    await ep.attach({ doc: 'rel:y.md', name: 'y' });
    await ep.detach('att_1', false);
  } finally {
    globalThis.fetch = orig;
  }
  assert.equal(calls[0][0], '/api/docs/attachments?ref=rel%3Anotes%2Fdesign.md');
  assert.deepEqual(JSON.parse(calls[1][1]), { ref: 'rel:notes/design.md', doc: 'rel:y.md', name: 'y', noEmbed: true });
  assert.deepEqual(JSON.parse(calls[2][1]), { ref: 'rel:notes/design.md', attachment: 'att_1', purge: false });
});
