// #133 · 「添加附件」面板的文件夹支持（kind=folder）。
//
// 后端早就有了 folder（CLI `attach --folder` / HTTP body `folder`），缺的是**面板**：
// 弹窗里没有入口，用户就只能回终端敲命令。这条用例把面板这一侧的线缆钉住：
//   · 请求体字段名必须是 `folder`（不是 path / fileId —— 那样会被当成文件上传）；
//   · 徽标是「文件夹」，别让面板把它显示成「文件」；
//   · 文件夹是**路径指针**（目录内容不在库里），不能给它编一条会 404 的内容链接。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachBodyOf, badgeOf, normAttachment } from '../../src/web/frontend/components/md/attach-common.js';

test('#133 attachBodyOf：文件夹条目发 folder 字段（路径指针，不走文件上传）', () => {
  const item = { source: 'folder', folder: 'D:\\repos\\ref', name: 'ref' };
  assert.deepEqual(attachBodyOf(item, 'task'), { folder: 'D:\\repos\\ref', name: 'ref' });
  assert.deepEqual(attachBodyOf(item, 'doc'), { folder: 'D:\\repos\\ref', name: 'ref' });
  // 绝不能退化成 fileId/url —— 那是「上传文件」的语义
  const body = attachBodyOf(item, 'task');
  assert.equal(body.fileId, undefined);
  assert.equal(body.url, undefined);
  assert.equal(body.path, undefined);
});

test('#133 面板徽标：文件夹就是「文件夹」', () => {
  assert.equal(badgeOf('folder'), '文件夹');
});

test('#133 normAttachment：文件夹是路径指针（href 空，不给内容链接）', () => {
  const a = normAttachment({
    id: 'att_folder_0123456789abcdef',
    kind: 'folder',
    name: 'ref',
    absPath: 'D:\\repos\\ref',
    size: 0,
    role: 'attach',
  });
  assert.equal(a.kind, 'folder');
  assert.equal(a.href, '', '文件夹没有可打开的 URL');
  assert.equal(a.sizeText, '');
  assert.equal(a.absPath, 'D:\\repos\\ref');
});
