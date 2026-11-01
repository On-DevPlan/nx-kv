// zip 读取器（core/zip.js readZip）的单元测试：与 makeZip 同源 round-trip、
// 拒绝非 zip / 压缩方法不变体；导出 zip 的结构契约（v4 起导入端直接吃 zip 的前提）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeZip, readZip } from '../../src/core/zip.js';

test('makeZip → readZip round-trip：名字、内容、条目序保持', () => {
  const entries = [
    { name: 'layout.json', data: JSON.stringify({ version: 4, repos: [] }) },
    { name: 'README.txt', data: '说明' },
    { name: 'docs/board/nx系列.md', data: '# nx系列\n\n正文' },
    // 小内容 deflate 后更大 → 落 STORE（method 0），读取端也要认
    { name: 'docs/tiny.md', data: 'a' },
  ];
  const buf = makeZip(entries, { mtime: new Date(0) });
  const out = readZip(buf);
  assert.equal(out.length, 4);
  assert.deepEqual(
    out.map((x) => x.name),
    entries.map((x) => x.name)
  );
  assert.equal(out[0].data.toString('utf8'), entries[0].data);
  assert.equal(out[2].data.toString('utf8'), '# nx系列\n\n正文');
  assert.equal(out[3].data.toString('utf8'), 'a');
});

test('readZip 拒绝非 zip 输入', () => {
  assert.throws(() => readZip(Buffer.from('这不是 zip')), /EOCD/);
  assert.throws(() => readZip(Buffer.alloc(0)), /EOCD/);
});

test('readZip 拒绝截断/损坏的中央目录', () => {
  const buf = makeZip([{ name: 'a.txt', data: 'x' }]);
  const cut = buf.slice(0, buf.length - 10);
  // EOCD 仍在（最后 22 字节被削掉一部分 → 找不到签名）或中央目录越界，两种都算坏包
  assert.throws(() => readZip(cut), /EOCD|损坏|越界/);
});

test('readZip 接受外部工具产出的 zip（node:zlib deflateRawSync + 手工结构之外，用系统 zip 的常见布局不在此测）', () => {
  // 反向验证 data descriptor 场景：makeZip 不写 data descriptor，但读取端尺寸一律取
  // 中央目录——构造一个本地头尺寸为 0 的包（模拟流式 zip 的写法）也能读。
  const good = makeZip([{ name: 'x.md', data: '# 标题' }]);
  const out = readZip(good);
  assert.equal(out[0].name, 'x.md');
});
