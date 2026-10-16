// 浏览器侧上传入口的纯逻辑：粘贴/拖入取文件、给截图起名、结果拼成 markdown。
//
// 这三件事没有 DOM 依赖（只读 file.name / file.type / file.size），所以能在 Node 里直测。
// 值得测的理由：**粘贴来的图往往没有可用文件名**，而这个名字会一路用下去
// （正文里的说明文字 + 落盘时的文件名）—— 退化成 image.png 就再也认不出是哪张图。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipboardFiles, droppedFiles, readableName, snippetsOf,
} from '../../src/modules/todo/upload.js';

const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);

test('readableName：正常文件名原样保留', () => {
  assert.equal(readableName({ name: '架构图.png', type: 'image/png' }), '架构图.png');
  assert.equal(readableName({ name: '需求说明.docx', type: '' }), '需求说明.docx');
});

test('readableName：截图这种无名/通用名换成可认的名字', () => {
  const one = readableName({ name: 'image.png', type: 'image/png' });
  assert.match(one, /^粘贴图片-\d{8}-\d{6}\.png$/, one);

  const noName = readableName({ name: '', type: 'image/jpeg' });
  assert.match(noName, /^粘贴图片-\d{8}-\d{6}\.jpg$/, noName);

  const blob = readableName({ name: 'blob', type: 'image/webp' });
  assert.match(blob, /^粘贴图片-\d{8}-\d{6}\.webp$/, blob);
});

test('readableName：一次粘多张时带序号，避免同名', () => {
  const first = readableName({ name: 'image.png', type: 'image/png' }, 0);
  const second = readableName({ name: 'image.png', type: 'image/png' }, 1);
  assert.notEqual(first, second);
  assert.match(second, /-2\.png$/, second);
});

test('readableName：认不出类型时兜底 .bin，不产生没有扩展名的文件', () => {
  assert.match(readableName({ name: '', type: '' }), /\.bin$/);
});

test('clipboardFiles：只取 kind=file 的项（剪贴板里常同时有 text/html）', () => {
  const png = { name: 'image.png', type: 'image/png', size: 12 };
  const e = {
    clipboardData: {
      items: [
        { kind: 'string', getAsFile: () => null },
        { kind: 'file', getAsFile: () => png },
        { kind: 'file', getAsFile: () => null }, // 偶尔拿不到 blob，别把它算成文件
      ],
    },
  };
  assert.deepEqual(clipboardFiles(e), [png]);
  assert.deepEqual(clipboardFiles({}), []);
  assert.deepEqual(clipboardFiles({ clipboardData: { items: [{ kind: 'string', getAsFile: () => null }] } }), []);
});

test('clipboardFiles：没有 items 时退回 files（老浏览器/部分来源）', () => {
  const f = { name: 'a.pdf', type: 'application/pdf', size: 3 };
  const e = { clipboardData: { files: [f] } };
  assert.deepEqual(clipboardFiles(e), [f]);
});

test('droppedFiles：丢掉空文件（拖目录时会混进来）', () => {
  const ok = { name: 'x.png', size: 10 };
  const emptied = { name: 'dir', size: 0 };
  assert.deepEqual(droppedFiles({ dataTransfer: { files: [ok, emptied] } }), [ok]);
  assert.deepEqual(droppedFiles({}), []);
});

test('snippetsOf：图片用图片语法，其他用链接语法', () => {
  const md = snippetsOf([
    { isImage: true, markdown: { image: `![图](${ID_A})`, file: `[图](${ID_A})` } },
    { isImage: false, markdown: { image: `![报告](${ID_B})`, file: `[报告](${ID_B})` } },
  ]);
  assert.equal(md, `![图](${ID_A}) [报告](${ID_B})`);
});
